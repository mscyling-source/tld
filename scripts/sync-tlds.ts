/**
 * IANA TLD synchronisation script.
 *
 * Runs in GitHub Actions (weekly) and can be run locally with:
 *   npm run sync:tlds
 *
 * Steps:
 *  1. Fetch the authoritative delegated list (tlds-alpha-by-domain.txt)
 *  2. Fetch the Root Zone Database HTML table
 *  3. Parse + validate both sources
 *  4. Merge into a canonical dataset
 *  5. Compare with the previous dataset (if any)
 *  6. Write new dataset + updated meta
 *  7. Exit non-zero on any validation failure
 *
 * Safety guards:
 *  - Refuses to overwrite if the new dataset is implausibly small
 *  - Refuses to overwrite if the sources are unavailable/malformed
 *  - Keeps the previous dataset on any error
 *  - All network requests have timeouts
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DELEGATED_LIST_URL, ROOT_ZONE_DB_URL, MIN_EXPECTED_TLDS, parseDelegatedList, parseRootZoneDb, parseDetailPage, normalizeType, categoryForType, letterFor, isPunycodeLabel, toUnicodeLabel } from '../src/lib/iana.js';
import type { TldRecord, TldDataset, SyncMeta, SyncChange, TldReference } from '../src/lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the project root robustly.
 *
 * `import.meta.url` is the most reliable anchor (`<root>/scripts/sync-tlds.ts`),
 * but tsx/esbuild can materialise a different path in some environments, so we
 * validate the result and fall back to `process.cwd()` when `package.json`
 * is not where we expect it.
 */
function resolveProjectRoot(): string {
  const candidates = [
    resolve(__dirname, '..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
  }
  return resolve(__dirname, '..');
}

const PROJECT_ROOT = resolveProjectRoot();
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const RECORDS_PATH = resolve(DATA_DIR, 'tlds.json');
const META_PATH = resolve(DATA_DIR, 'meta.json');
const EDITORIAL_DIR = resolve(PROJECT_ROOT, 'src/content/notes');

const FETCH_TIMEOUT_MS = 30000;
const MAX_CONCURRENT_DETAIL_FETCHES = 6;
const DETAIL_FETCH_TIMEOUT_MS = 15000;

interface FetchResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** Response headers, when available (used for the Last-Modified date). */
  headers: Headers | null;
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchResult<string>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'TLDDirectory/1.0 (+https://tlddirectory.com)' } });
    clearTimeout(id);
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status} ${res.statusText}`, headers: null };
    const text = await res.text();
    return { ok: true, data: text, error: null, headers: res.headers };
  } catch (e: any) {
    clearTimeout(id);
    return { ok: false, data: null, error: e.name === 'AbortError' ? 'Timeout' : String(e), headers: null };
  }
}

async function loadPreviousMeta(): Promise<SyncMeta | null> {
  try {
    const txt = await readFile(META_PATH, 'utf-8');
    return JSON.parse(txt) as SyncMeta;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function loadPreviousDataset(): Promise<TldDataset | null> {
  try {
    const txt = await readFile(RECORDS_PATH, 'utf-8');
    return JSON.parse(txt) as TldDataset;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeChange(prev: TldRecord[] | undefined, curr: TldRecord[]): SyncChange {
  const prevSet = new Set(prev?.map(r => r.suffix) ?? []);
  const currSet = new Set(curr.map(r => r.suffix));
  const added = [...currSet].filter(s => !prevSet.has(s)).sort();
  const removed = [...prevSet].filter(s => !currSet.has(s)).sort();
  return { added, removed };
}

async function fetchDetailPage(ascii: string): Promise<{ ascii: string; detail: Awaited<ReturnType<typeof parseDetailPage>> | null; error: string | null }> {
  const url = `https://www.iana.org/domains/root/db/${ascii}.html`;
  const res = await fetchWithTimeout(url, DETAIL_FETCH_TIMEOUT_MS);
  if (!res.ok || !res.data) return { ascii, detail: null, error: res.error ?? 'No data' };
  try {
    const detail = parseDetailPage(res.data);
    return { ascii, detail, error: null };
  } catch (e: any) {
    return { ascii, detail: null, error: String(e) };
  }
}

async function main(): Promise<void> {
  console.log('[sync] Starting TLD synchronisation...');
  const startedAt = nowIso();

  // 1. Load previous state for comparison.
  const prevMeta = await loadPreviousMeta();
  const prevDataset = await loadPreviousDataset();
  const prevRecords = prevDataset?.records ?? [];

  // 2. Fetch the two core IANA sources in parallel.
  console.log('[sync] Fetching IANA delegated list...');
  const listRes = await fetchWithTimeout(DELEGATED_LIST_URL);
  if (!listRes.ok || !listRes.data) {
    const err = `Failed to fetch delegated list: ${listRes.error}`;
    console.error('[sync]', err);
    await writeFailedMeta(prevMeta, startedAt, err);
    process.exit(1);
  }

  console.log('[sync] Fetching IANA Root Zone Database...');
  const dbRes = await fetchWithTimeout(ROOT_ZONE_DB_URL);
  if (!dbRes.ok || !dbRes.data) {
    const err = `Failed to fetch Root Zone DB: ${dbRes.error}`;
    console.error('[sync]', err);
    await writeFailedMeta(prevMeta, startedAt, err);
    process.exit(1);
  }

  // 3. Parse sources.
  let delegated: Awaited<ReturnType<typeof parseDelegatedList>>;
  let dbRows: Awaited<ReturnType<typeof parseRootZoneDb>>;
  try {
    delegated = parseDelegatedList(listRes.data);
    dbRows = parseRootZoneDb(dbRes.data);
  } catch (e: any) {
    const err = `Parse error: ${e.message}`;
    console.error('[sync]', err);
    await writeFailedMeta(prevMeta, startedAt, err);
    process.exit(1);
  }

  console.log(`[sync] Delegated list: ${delegated.labels.length} TLDs (version ${delegated.version})`);
  console.log(`[sync] Root Zone DB: ${dbRows.length} rows`);

  // 4. Safety guard: dataset must be plausibly large.
  if (delegated.labels.length < MIN_EXPECTED_TLDS) {
    const err = `Delegated list implausibly small (${delegated.labels.length} < ${MIN_EXPECTED_TLDS}) — refusing to overwrite.`;
    console.error('[sync]', err);
    await writeFailedMeta(prevMeta, startedAt, err);
    process.exit(1);
  }

  // 5. Build a lookup map from Root Zone DB rows (by ASCII label).
  const dbByAscii = new Map<string, (typeof dbRows)[0]>();
  for (const row of dbRows) {
    dbByAscii.set(row.ascii, row);
  }

  // 6. For every delegated TLD, we have a row in the DB table — but some
  //    TLDs in the DB are "Not assigned" (reserved / not yet delegated).
  //    We only create records for TLDs that are *actually delegated*.
  const delegatedSet = new Set(delegated.labels);

  // 7. Fetch detail pages for TLDs that don't have editorial notes yet.
  //    We limit concurrency to be polite to IANA.
  const detailCache = new Map<string, Awaited<ReturnType<typeof parseDetailPage>> | null>();
  const pending: string[] = [];
  for (const label of delegated.labels) {
    const dbRow = dbByAscii.get(label);
    const needsDetail = dbRow && !dbRow.manager && !isEditorialAvailable(label);
    if (needsDetail) pending.push(label);
  }

  console.log(`[sync] Fetching ${pending.length} detail pages (max ${MAX_CONCURRENT_DETAIL_FETCHES} concurrent)...`);
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_DETAIL_FETCHES) {
    const batch = pending.slice(i, i + MAX_CONCURRENT_DETAIL_FETCHES);
    const results = await Promise.all(batch.map(fetchDetailPage));
    for (const r of results) {
      detailCache.set(r.ascii, r.detail);
      if (r.error) console.warn(`[sync] Detail fetch failed for ${r.ascii}: ${r.error}`);
    }
  }

  // 8. Build canonical records.
  const records: TldRecord[] = [];
  for (const label of delegated.labels) {
    const dbRow = dbByAscii.get(label) ?? null;
    const isIdn = isPunycodeLabel(label);
    const unicodeName = dbRow?.unicode ?? (isIdn ? toUnicodeLabel(label) : null);
    const sourceType = dbRow?.type ?? 'unknown';
    const normalizedType = normalizeType(sourceType);

    // Prefer detail page info when the DB row says "Not assigned".
    const detail = detailCache.get(label) ?? null;
    const managerName = dbRow?.manager ?? detail?.sponsoringOrganisation ?? null;
    const officialUrl = detail?.registrationServicesUrl ?? null;
    const whoisServer = detail?.whoisServer ?? null;
    const rdapServer = detail?.rdapServer ?? null;
    const references = detail?.references ?? [];

    // Use IANA's record dates if available.
    const sourceUpdatedAt = detail?.recordLastUpdated ?? null;
    const delegatedSince = detail?.registrationDate ?? null;

    const hasEditorial = isEditorialAvailable(label);
    const dataQuality: TldRecord['data_quality_status'] = hasEditorial
      ? 'verified-editorial'
      : managerName
        ? 'verified'
        : 'incomplete';

    records.push({
      suffix: `.${label}`,
      ascii_name: label,
      unicode_name: unicodeName,
      source_type: sourceType,
      normalized_type: normalizedType,
      manager_name: managerName,
      source_url: `https://www.iana.org/domains/root/db/${label}.html`,
      official_url: officialUrl,
      whois_server: whoisServer,
      rdap_server: rdapServer,
      references,
      description: buildDefaultDescription(label, normalizedType, managerName),
      registration_restrictions: null, // filled from editorial notes at build time
      last_verified_at: nowIso(),
      source_updated_at: sourceUpdatedAt,
      delegated_since: delegatedSince,
      is_active: true,
      // Verbatim IANA status, so `is_active` above stays auditable.
      iana_status: dbRow?.status ?? null,
      iana_status_note: dbRow?.status_note ?? null,
      is_idn: isIdn,
      has_editorial: hasEditorial,
      data_quality_status: dataQuality,
      letter: letterFor(label),
    });
  }

  // 9. Sanity check: every delegated label must have a record.
  if (records.length !== delegated.labels.length) {
    const err = `Record count mismatch (${records.length} vs ${delegated.labels.length})`;
    console.error('[sync]', err);
    await writeFailedMeta(prevMeta, startedAt, err);
    process.exit(1);
  }

  // 9b. Cross-check: IANA's index page publishes a status per row. When it is
  // present, "Active" must match the authoritative delegated list. A mismatch
  // means one of the two sources changed shape — surface it instead of
  // silently trusting one side.
  const activeLabels = new Set(
    dbRows.filter(r => (r.status ?? '').toLowerCase() === 'active').map(r => r.ascii),
  );
  if (activeLabels.size > 0) {
    const inListNotActive = delegated.labels.filter(l => !activeLabels.has(l));
    const activeNotInList = [...activeLabels].filter(l => !delegatedSet.has(l));
    if (inListNotActive.length > 0 || activeNotInList.length > 0) {
      console.warn(
        `[sync] Status cross-check mismatch: `
        + `${inListNotActive.length} delegated labels not marked Active `
        + `(${inListNotActive.slice(0, 5).join(', ')}), `
        + `${activeNotInList.length} Active labels not in the delegated list `
        + `(${activeNotInList.slice(0, 5).join(', ')}). `
        + 'The delegated list remains authoritative for `is_active`.',
      );
    } else {
      console.log(`[sync] Status cross-check OK: ${activeLabels.size} Active rows match the delegated list`);
    }
  }

  // 9c. Category summary (for the run log).
  const typeSummary = records.reduce<Record<string, number>>((acc, r) => {
    const t = r.normalized_type ?? 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  console.log('[sync] Type summary:', JSON.stringify(typeSummary));

  // 10. Compare with previous dataset.
  const change = computeChange(prevRecords, records);
  console.log(`[sync] Changes: +${change.added.length} -${change.removed.length}`);

  // 11. Write new dataset + meta atomically (write temp then rename).
  await mkdir(DATA_DIR, { recursive: true });

  const dataset: TldDataset = {
    schema_version: 1,
    generated_at: nowIso(),
    sources: {
      delegated_list: {
        url: DELEGATED_LIST_URL,
        version: delegated.version,
        last_updated: delegated.lastUpdated,
      },
      root_zone_db: {
        url: ROOT_ZONE_DB_URL,
        last_modified: dbRes.headers?.get('last-modified') ?? '',
      },
    },
    records,
  };

  const meta: SyncMeta = {
    last_success_at: nowIso(),
    last_attempt_at: startedAt,
    status: 'success',
    last_error: null,
    counts: {
      total: records.length,
      by_type: countByType(records),
      idn: records.filter(r => r.is_idn).length,
      editorial: records.filter(r => r.has_editorial).length,
    },
    last_changes: change,
    history: [
      ...(prevMeta?.history ?? []),
      {
        at: nowIso(),
        status: 'success' as const,
        total: records.length,
        added: change.added.length,
        removed: change.removed.length,
        note: `IANA version ${delegated.version}`,
      },
    ].slice(-50),
  };

  await writeFile(`${RECORDS_PATH}.tmp`, JSON.stringify(dataset, null, 2), 'utf-8');
  await writeFile(`${META_PATH}.tmp`, JSON.stringify(meta, null, 2), 'utf-8');
  await Promise.all([
    rename(`${RECORDS_PATH}.tmp`, RECORDS_PATH),
    rename(`${META_PATH}.tmp`, META_PATH),
  ]);

  console.log('[sync] Done. Dataset written to', RECORDS_PATH);
  console.log('[sync] Meta written to', META_PATH);
}

async function writeFailedMeta(prevMeta: SyncMeta | null, startedAt: string, error: string): Promise<void> {
  const meta: SyncMeta = {
    last_success_at: prevMeta?.last_success_at ?? null,
    last_attempt_at: startedAt,
    status: 'failed',
    last_error: error,
    counts: prevMeta?.counts ?? { total: 0, by_type: {}, idn: 0, editorial: 0 },
    last_changes: { added: [], removed: [] },
    history: [
      ...(prevMeta?.history ?? []),
      { at: startedAt, status: 'failed' as const, total: 0, added: 0, removed: 0, note: error },
    ].slice(-50),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(`${META_PATH}.tmp`, JSON.stringify(meta, null, 2), 'utf-8');
  await rename(`${META_PATH}.tmp`, META_PATH);
}

function countByType(records: TldRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    const t = r.normalized_type ?? 'unknown';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

function isEditorialAvailable(label: string): boolean {
  // Check if we have a markdown note for this TLD.
  // Editorial notes are stored as `src/content/notes/<label>.md`.
  // We'll check synchronously at build time — async check would require fs.
  try {
    // Note: this runs in the sync script (Node), not in Astro build.
    // We'll just check the filesystem.
    const notePath = resolve(EDITORIAL_DIR, `${label}.md`);
    return require('node:fs').existsSync(notePath);
  } catch {
    return false;
  }
}

function buildDefaultDescription(label: string, normalizedType: string | null, manager: string | null): string {
  const typeLabel = normalizedType === 'country-code' ? 'country-code' : normalizedType ?? 'top-level';
  const mgr = manager ? ` managed by ${manager}` : '';
  return `.${label} is a ${typeLabel} top-level domain${mgr}.`;
}



main().catch(e => {
  console.error('[sync] Fatal:', e);
  process.exit(1);
});