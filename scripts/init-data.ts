/**
 * Initialize TLD dataset from local files (for environments without network access).
 * Uses the files downloaded earlier: /tmp/tlds.txt and /tmp/rootdb.html
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { parseDelegatedList, parseRootZoneDb, normalizeType, categoryForType, letterFor, isPunycodeLabel, toUnicodeLabel } from '../src/lib/iana.js';
import type { TldRecord, TldDataset, SyncMeta, TldReference } from '../src/lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveProjectRoot(): string {
  const candidates = [resolve(__dirname, '..'), process.cwd()];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
  }
  return resolve(__dirname, '..');
}

const PROJECT_ROOT = resolveProjectRoot();
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const RECORDS_PATH = resolve(DATA_DIR, 'tlds.json');
const META_PATH = resolve(DATA_DIR, 'meta.json');

function nowIso(): string {
  return new Date().toISOString();
}

function buildDefaultDescription(label: string, normalizedType: string | null, manager: string | null): string {
  const typeLabel = normalizedType === 'country-code' ? 'country-code' : normalizedType ?? 'top-level';
  const mgr = manager ? ` managed by ${manager}` : '';
  return `.${label} is a ${typeLabel} top-level domain${mgr}.`;
}

async function main() {
  console.log('[init] Initializing TLD dataset from local files...');

  const delegatedText = await readFile('/tmp/tlds.txt', 'utf-8');
  const dbHtml = await readFile('/tmp/rootdb.html', 'utf-8');

  const delegated = parseDelegatedList(delegatedText);
  const dbRows = parseRootZoneDb(dbHtml);

  console.log(`[init] Delegated list: ${delegated.labels.length} TLDs (version ${delegated.version})`);
  console.log(`[init] Root Zone DB: ${dbRows.length} rows`);

  const dbByAscii = new Map<string, (typeof dbRows)[0]>();
  for (const row of dbRows) {
    dbByAscii.set(row.ascii, row);
  }

  const delegatedSet = new Set(delegated.labels);

  const records: TldRecord[] = [];
  for (const label of delegated.labels) {
    const dbRow = dbByAscii.get(label) ?? null;
    const isIdn = isPunycodeLabel(label);
    const unicodeName = dbRow?.unicode ?? (isIdn ? toUnicodeLabel(label) : null);
    const sourceType = dbRow?.type ?? 'unknown';
    const normalizedType = normalizeType(sourceType);
    const managerName = dbRow?.manager ?? null;

    const hasEditorial = false; // No editorial notes yet

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
      official_url: null,
      whois_server: null,
      rdap_server: null,
      references: [],
      description: buildDefaultDescription(label, normalizedType, managerName),
      registration_restrictions: null,
      last_verified_at: nowIso(),
      source_updated_at: null,
      delegated_since: null,
      is_active: true,
      iana_status: dbRow?.status ?? null,
      iana_status_note: dbRow?.status_note ?? null,
      is_idn: isIdn,
      has_editorial: hasEditorial,
      data_quality_status: dataQuality,
      letter: letterFor(label),
    });
  }

  console.log(`[init] Built ${records.length} records`);

  const typeCounts: Record<string, number> = {};
  for (const r of records) {
    const t = r.normalized_type ?? 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  await mkdir(DATA_DIR, { recursive: true });

  const dataset: TldDataset = {
    schema_version: 1,
    generated_at: nowIso(),
    sources: {
      delegated_list: {
        url: 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt',
        version: delegated.version,
        last_updated: delegated.lastUpdated,
      },
      root_zone_db: {
        url: 'https://www.iana.org/domains/root/db',
        last_modified: new Date().toISOString(),
      },
    },
    records,
  };

  const meta: SyncMeta = {
    last_success_at: nowIso(),
    last_attempt_at: nowIso(),
    status: 'success',
    last_error: null,
    counts: {
      total: records.length,
      by_type: typeCounts,
      idn: records.filter(r => r.is_idn).length,
      editorial: records.filter(r => r.has_editorial).length,
    },
    last_changes: { added: records.map(r => r.suffix), removed: [] },
    history: [
      { at: nowIso(), status: 'success', total: records.length, added: records.length, removed: 0, note: `Initial dataset from IANA version ${delegated.version}` },
    ],
  };

  await writeFile(RECORDS_PATH, JSON.stringify(dataset, null, 2), 'utf-8');
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');

  console.log('[init] Dataset written to', RECORDS_PATH);
  console.log('[init] Meta written to', META_PATH);
}

main().catch(e => {
  console.error('[init] Fatal:', e);
  process.exit(1);
});