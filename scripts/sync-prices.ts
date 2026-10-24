/**
 * scripts/sync-prices.ts — registrar price sync pipeline.
 *
 * Design rules (docs/PRICING-DATA.md):
 *   - Authorized sources only: official public APIs, officially published
 *     pricing pages that permit automated read-only access, and openly
 *     licensed datasets. No authentication bypass, no CAPTCHA solving, no
 *     anti-bot evasion.
 *   - Three timestamps, never conflated: when we FETCHED a source, when the
 *     source OBSERVED a price, and when we VERIFIED it against the registrar.
 *     A fetch never promotes a price to "verified".
 *   - Validate before replace: a source that fails, returns zero valid rows,
 *     or shrinks by >50% keeps its previous rows untouched.
 *   - Empty results never overwrite good data; total failure exits 1 and
 *     leaves data/prices.json byte-for-byte unchanged.
 *   - Atomic writes: tmp file + rename.
 *   - data/tlds.json (IANA catalog) is read-only here; this script never
 *     writes it.
 *
 * Exit codes: 0 = dataset written (possibly partial), 1 = failure.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sourceAdapters, missingEnvFor, type SourceAdapter } from './pricing/sources/index.js';
import { validateOffers, countRejections } from './pricing/validate.js';
import { mergeBatches } from './pricing/merge.js';
import { migrateDataset } from './pricing/migrate.js';
import { buildReport, buildMetaCounts, diffPrices, renderMarkdown, type SourceReport } from './pricing/report.js';
import { purchaseUrlFor } from '../src/config/registrars.js';
import { applyTrustPolicy, quarantineReason } from './pricing/trust.js';
import {
  buildCoverage,
  buildSourceLifecycle,
  newestEvidenceDate,
} from './pricing/sourceState.js';
import {
  calcThreeYear,
  effectiveEvidenceDate,
  effectiveFreshness,
  freshnessToQuality,
} from '../src/lib/pricingCalc.js';
import type {
  PriceDataset,
  PriceMeta,
  PriceOffer,
  PriceSourceInfo,
  RawOffer,
  SourceBatch,
  VerificationStatus,
} from '../src/lib/pricingTypes.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');
const TLDS_PATH = resolve(PROJECT_ROOT, 'data', 'tlds.json');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const PRICES_PATH = resolve(DATA_DIR, 'prices.json');
const PRICES_META_PATH = resolve(DATA_DIR, 'prices-meta.json');
const REPORT_JSON_PATH = resolve(DATA_DIR, 'price-sync-report.json');
const REPORT_MD_PATH = resolve(DATA_DIR, 'price-sync-report.md');

/** A source must produce at least this fraction of its previous rows. */
const SHRINK_RATIO = 0.5;

/**
 * What one adapter produced this run.
 *
 * Deliberately separated from `PriceSourceInfo`: the published source record
 * needs `published_rows`, which is only known after the cross-source merge, so
 * the record is assembled in `main()` rather than here.
 */
type SourceRun = {
  adapter: SourceAdapter;
  status: PriceSourceInfo['status'];
  error?: string;
  /** Rows the adapter returned before validation (0 when it never ran). */
  attempted: number;
  /** Rows that passed validation. */
  parsed: number;
  rejectedTotal: number;
  rejections: Record<string, number>;
  /** Rows carried over from the previous dataset because the fetch was unusable. */
  retainedFromPrevious: number;
  /** Rows to feed into the merge. */
  offers: RawOffer[];
  previousSuccessfulFetchAt: string | null;
  previousPriceEvidenceAt: string | null;
};

function log(msg: string): void {
  console.log(`[sync-prices] ${msg}`);
}

async function loadJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tmp, path);
}

/** Run one adapter with all guards; never throws. */
async function runSource(
  adapter: SourceAdapter,
  knownTlds: Set<string>,
  previousBySource: Map<string, PriceOffer[]>,
  previousSources: Map<string, PriceSourceInfo>,
  now: Date,
): Promise<SourceRun> {
  const attemptedAt = now.toISOString();
  const previous = previousBySource.get(adapter.id) ?? [];
  const previousInfo = previousSources.get(adapter.id);

  // A previous dataset written before this field existed only has `fetched_at`,
  // which was already defined as a *successful* fetch time. Fall back to it
  // rather than inventing a value.
  const previousSuccessfulFetchAt =
    previousInfo?.last_successful_fetch_at ?? previousInfo?.fetched_at ?? null;
  // Same for the evidence date: derive it from the rows themselves when the
  // previous file predates the per-source field.
  const previousPriceEvidenceAt =
    previousInfo?.price_evidence_at ?? newestEvidenceDate(previous);

  const keepPrevious = (
    status: PriceSourceInfo['status'],
    error: string,
    extra: { attempted?: number; parsed?: number; rejectedTotal?: number; rejections?: Record<string, number> } = {},
  ): SourceRun => ({
    adapter,
    status,
    error,
    attempted: extra.attempted ?? 0,
    parsed: extra.parsed ?? 0,
    rejectedTotal: extra.rejectedTotal ?? 0,
    rejections: extra.rejections ?? {},
    retainedFromPrevious: previous.length,
    offers: previous,
    previousSuccessfulFetchAt,
    previousPriceEvidenceAt,
  });

  const missingEnv = missingEnvFor(adapter);
  if (missingEnv.length > 0) {
    log(`${adapter.id}: missing env ${missingEnv.join(', ')} — ${previous.length ? `keeping ${previous.length} previous rows` : 'source skipped'}`);
    return keepPrevious('kept-previous', `missing env: ${missingEnv.join(', ')}`);
  }

  let raw: RawOffer[];
  try {
    raw = await adapter.fetchOffers(now);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`${adapter.id}: fetch failed (${message})`);
    return keepPrevious(previous.length > 0 ? 'kept-previous' : 'failed', message);
  }

  const { valid, rejected } = validateOffers(raw, knownTlds);
  const rejectionCounts = countRejections(rejected);
  const rejectedTotal = Object.values(rejectionCounts).reduce((a, b) => a + b, 0);

  // Empty/garbage results must never overwrite a working dataset.
  if (valid.length === 0) {
    log(`${adapter.id}: 0 valid rows (raw=${raw.length})`);
    return keepPrevious(previous.length > 0 ? 'kept-previous' : 'failed', 'no valid rows returned', {
      attempted: raw.length,
      parsed: 0,
      rejectedTotal,
      rejections: rejectionCounts,
    });
  }

  // Sudden shrinkage usually means a broken payload — keep known-good data.
  if (previous.length > 0 && valid.length < previous.length * SHRINK_RATIO) {
    log(`${adapter.id}: suspicious shrink ${previous.length} → ${valid.length} — keeping previous rows`);
    return keepPrevious(
      'shrunk-kept-previous',
      `shrink ${previous.length} → ${valid.length} (< ${SHRINK_RATIO * 100}%)`,
      { attempted: raw.length, parsed: valid.length, rejectedTotal, rejections: rejectionCounts },
    );
  }

  const dates = valid
    .map(o => effectiveEvidenceDate(o))
    .filter((d): d is string => typeof d === 'string')
    .sort();

  log(
    `${adapter.id}: ${valid.length} valid rows (${rejectedTotal} rejected: ${JSON.stringify(rejectionCounts)}), ` +
      `oldest observation ${dates[0] ?? 'unknown'}`,
  );
  return {
    adapter,
    status: 'ok',
    attempted: raw.length,
    parsed: valid.length,
    rejectedTotal,
    rejections: rejectionCounts,
    retainedFromPrevious: 0,
    offers: valid,
    previousSuccessfulFetchAt,
    previousPriceEvidenceAt,
  };
}

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  // The IANA catalog is the authority for which TLDs exist — price rows for
  // anything else are rejected, not linked.
  const tldDataset = await loadJson<{ records?: Array<{ ascii_name: string }> }>(TLDS_PATH);
  if (!tldDataset || !Array.isArray(tldDataset.records) || tldDataset.records.length === 0) {
    await writeFailureMeta(nowIso, 'data/tlds.json missing or empty — IANA catalog required');
    log('FATAL: data/tlds.json missing or empty');
    process.exit(1);
  }
  const knownTlds = new Set(tldDataset.records.map(r => r.ascii_name.toLowerCase()));

  // Read and migrate whatever schema the repository currently holds.
  const rawPrevious = await loadJson<unknown>(PRICES_PATH);
  let previous: PriceDataset | null = null;
  if (rawPrevious) {
    try {
      const { dataset, changed } = migrateDataset(rawPrevious);
      previous = dataset;
      if (changed) log('previous dataset migrated to schema v2 in memory');
    } catch (e) {
      log(`previous dataset unreadable (${e instanceof Error ? e.message : String(e)}) — treating as absent`);
      previous = null;
    }
  }

  const previousBySource = new Map<string, PriceOffer[]>();
  const previousSources = new Map<string, PriceSourceInfo>();
  for (const offer of previous?.offers ?? []) {
    const list = previousBySource.get(offer.source_id) ?? [];
    list.push(offer);
    previousBySource.set(offer.source_id, list);
  }
  for (const source of previous?.sources ?? []) {
    if (source.id) previousSources.set(source.id, source);
  }

  log(
    `starting: ${sourceAdapters.length} sources, catalog ${knownTlds.size} TLDs, previous ${previous?.offers.length ?? 0} offers`,
  );

  const runs: SourceRun[] = [];
  for (const adapter of sourceAdapters) {
    runs.push(await runSource(adapter, knownTlds, previousBySource, previousSources, now));
  }

  const anyRows = runs.some(o => o.offers.length > 0);
  if (!anyRows) {
    await writeFailureMeta(nowIso, 'all sources failed — data/prices.json untouched');
    log('FATAL: every source failed; dataset left untouched');
    process.exit(1);
  }

  /**
   * The fetch timestamp written onto each offer. Only a successful fetch may
   * stamp this run's clock; a fallback keeps the previous success time so a
   * failed run cannot make old rows look freshly downloaded.
   */
  const fetchedAtBySource = new Map<string, string>();
  for (const run of runs) {
    const succeeded = run.status === 'ok';
    fetchedAtBySource.set(
      run.adapter.id,
      succeeded ? nowIso : (run.previousSuccessfulFetchAt ?? nowIso),
    );
  }

  // Resolve purchase links: source-provided → verified registry pattern → homepage.
  const finalizedSourceOffers: RawOffer[] = [];
  for (const outcome of runs) {
    for (const offer of outcome.offers) {
      const resolved = offer.purchase_url ?? purchaseUrlFor(offer.registrar_id, offer.tld);
      finalizedSourceOffers.push({ ...offer, purchase_url: resolved || null });
    }
  }

  // Merge across sources: one offer per (registrar, TLD), best evidence wins.
  const batches: SourceBatch[] = sourceAdapters
    .map(adapter => ({
      sourceId: adapter.id,
      priority: adapter.priority,
      offers: finalizedSourceOffers.filter(o => o.source_id === adapter.id),
    }))
    .filter(b => b.offers.length > 0);
  const merge = mergeBatches(batches);

  const mapped: PriceOffer[] = merge.merged.map(raw => {
    const evidenceDate = effectiveEvidenceDate(raw);
    const verificationStatus: VerificationStatus = raw.verification_status ?? 'source_snapshot';
    const freshness = effectiveFreshness(
      {
        price_verified_at: raw.price_verified_at ?? null,
        price_observed_at: raw.price_observed_at,
        verification_status: verificationStatus,
        source_status_stale: raw.source_status_stale,
      },
      now,
    );
    return {
      tld: raw.tld,
      registrar_id: raw.registrar_id,
      registrar_name: raw.registrar_name,
      currency: 'USD',
      register_usd: raw.register_usd,
      renewal_usd: raw.renewal_usd,
      transfer_usd: raw.transfer_usd,
      promotional: raw.promotional,
      promo_code: raw.promo_code,
      promo_restrictions: raw.promo_restrictions,
      promotion_expires_at: raw.promotion_expires_at ?? null,
      three_year_usd: calcThreeYear(raw.register_usd, raw.renewal_usd),
      source_id: raw.source_id,
      source_name: sourceNameFor(raw.source_id),
      source_url: raw.source_url,
      purchase_url: raw.purchase_url,
      source_fetched_at: fetchedAtBySource.get(raw.source_id) ?? nowIso,
      price_observed_at: raw.price_observed_at,
      price_verified_at: raw.price_verified_at ?? null,
      verification_status: verificationStatus,
      last_checked: evidenceDate ?? '',
      freshness,
      quality: freshnessToQuality(freshness),
      source_status_stale: raw.source_status_stale,
    };
  });

  // Placeholder pricing (see UNTRUSTED_REGISTRAR_PRICES) is kept but stripped
  // of every trust signal, so it can never be presented as a current quote.
  const trust = applyTrustPolicy(mapped);
  const offers = trust.offers;
  if (trust.quarantined.length > 0) {
    log(
      `quarantined as unverified: ${trust.quarantined
        .map(id => `${id} — ${quarantineReason(id) ?? 'placeholder data'}`)
        .join('; ')}`,
    );
  }

  if (offers.length === 0) {
    await writeFailureMeta(nowIso, 'merge produced zero offers — data/prices.json untouched');
    log('FATAL: merge produced zero offers; dataset left untouched');
    process.exit(1);
  }

  // Counters for prices-meta.json — one counter per band, built by a pure
  // function so the rule is testable (see buildMetaCounts).
  const counts = buildMetaCounts(offers);

  /**
   * Assemble each source's published record.
   *
   * Evidence is measured over the rows this source actually contributes to the
   * dataset, not over everything the adapter returned: a source whose freshest
   * rows are all superseded by a better-verified copy is not, in any useful
   * sense, keeping that registrar current.
   */
  const sources: PriceSourceInfo[] = runs.map(run => {
    const published = offers.filter(o => o.source_id === run.adapter.id);
    // Fall back to the candidate rows when nothing survived the merge, so a
    // source that read fine but lost every row still reports its evidence
    // rather than appearing undated.
    const evidenceRows = published.length > 0 ? published : run.offers;
    const lifecycle = buildSourceLifecycle({
      status: run.status,
      attempted: run.attempted,
      parsed: run.parsed,
      rejectedTotal: run.rejectedTotal,
      retainedFromPrevious: run.retainedFromPrevious,
      published: evidenceRows,
      previousSuccessfulFetchAt: run.previousSuccessfulFetchAt,
      previousPriceEvidenceAt: run.previousPriceEvidenceAt,
      attemptedAt: nowIso,
      now,
    });
    return {
      id: run.adapter.id,
      name: run.adapter.name,
      url: run.adapter.url,
      license: run.adapter.license,
      attribution: run.adapter.attribution,
      verification_status: run.adapter.verificationStatus,
      rows: run.offers.length,
      status: run.status,
      error: run.error,
      rejections: run.rejections,
      published_rows: published.length,
      ...lifecycle,
    };
  });

  const coverage = buildCoverage(sources, offers, now);

  const dataset: PriceDataset = {
    schema_version: 2,
    generated_at: nowIso,
    currency: 'USD',
    sources,
    offers,
  };

  const allStatuses = runs.map(o => o.status);
  const metaStatus: PriceMeta['status'] = allStatuses.every(s => s === 'ok')
    ? 'ok'
    : runs.some(o => o.status === 'ok' || o.status === 'kept-previous')
      ? 'partial'
      : 'failed';
  const errors = runs
    .filter(o => o.error)
    .map(o => `${o.adapter.id}: ${o.error}`);

  // Report: what we stand behind, not just what we downloaded.
  const sourceReports: SourceReport[] = sources.map(s => ({
    source_id: s.id,
    source_name: s.name,
    status: s.status,
    verification_status: s.verification_status,
    rows: s.rows,
    attempted: s.attempted,
    published_rows: s.published_rows,
    rejected: s.rejected_total,
    rejections: s.rejections ?? {},
    fetched_at: s.last_successful_fetch_at,
    last_attempt_at: s.last_attempt_at,
    last_successful_fetch_at: s.last_successful_fetch_at,
    price_evidence_at: s.price_evidence_at,
    previous_price_evidence_at: s.previous_price_evidence_at,
    evidence_advanced: s.evidence_advanced,
    evidence_state: s.evidence_state,
    retained_from_previous: s.retained_from_previous,
    oldest_observed_at: s.oldest_observed_at,
    error: s.error ?? null,
  }));
  const changes = diffPrices(previous, dataset);
  const report = buildReport({ runAt: nowIso, dataset, sources: sourceReports, changes, now, previous });

  const previousMeta = await loadJson<PriceMeta>(PRICES_META_PATH);
  const meta: PriceMeta = {
    last_success_at: metaStatus === 'failed' ? previousMeta?.last_success_at ?? null : nowIso,
    last_attempt_at: nowIso,
    status: metaStatus,
    last_error: errors.length ? errors.join(' | ') : null,
    coverage,
    counts,
    history: [
      {
        at: nowIso,
        status: metaStatus,
        offers: offers.length,
        note: errors.length ? errors.join(' | ') : undefined,
      },
      ...(previousMeta?.history ?? []),
    ].slice(0, 50),
  };

  await atomicWrite(PRICES_PATH, dataset);
  await atomicWrite(PRICES_META_PATH, meta);
  await atomicWrite(REPORT_JSON_PATH, report);
  await writeFile(REPORT_MD_PATH, renderMarkdown(report), 'utf-8');

  const supersededNote =
    merge.superseded > 0
      ? `, ${merge.superseded} superseded (${merge.upgradedByVerification} by better verification)`
      : '';
  log(
    `done: ${offers.length} offers across ${counts.tlids} TLDs and ${counts.registrars} registrars ` +
      `(verified=${counts.by_verification.verified}, snapshot=${counts.by_verification.source_snapshot}, ` +
      `model=${counts.by_verification.model_derived}, unverified=${counts.by_verification.unverified}; ` +
      `recent=${counts.recent_offers}, aging=${counts.aging_offers}, stale=${counts.stale_offers}, ` +
      `unknown=${counts.unknown_offers}${supersededNote}), status=${metaStatus}`,
  );
  for (const s of sources) {
    const moved = s.evidence_advanced ? 'advanced' : 'no new evidence';
    log(
      `  source ${s.id} [${s.verification_status}]: ${s.status}` +
        `${s.error ? ` (${s.error})` : ''} attempted=${s.attempted} parsed=${s.parsed} ` +
        `rejected=${s.rejected_total} published=${s.published_rows} ` +
        `evidence=${s.price_evidence_at ?? 'none'} [${s.evidence_state}, ${moved}] ` +
        `last_success=${s.last_successful_fetch_at ?? 'never'}`,
    );
  }
  log(`coverage: ${coverage.complete ? 'complete' : 'incomplete'} — ${coverage.note}`);
  if (changes.length > 0) {
    log(`significant price changes: ${changes.length} (see data/price-sync-report.md)`);
  }
}

/** Display name for a source id, used on `source_name`. */
function sourceNameFor(sourceId: string): string {
  return sourceAdapters.find(a => a.id === sourceId)?.name ?? sourceId;
}

/** Write failure metadata without touching the price dataset. */
async function writeFailureMeta(nowIso: string, error: string): Promise<void> {
  const previousMeta = await loadJson<PriceMeta>(PRICES_META_PATH);
  const meta: PriceMeta = {
    last_success_at: previousMeta?.last_success_at ?? null,
    last_attempt_at: nowIso,
    status: 'failed',
    last_error: error,
    coverage: {
      complete: false,
      current_sources: [],
      frozen_sources: [],
      stale_sources: [],
      registrars_without_current_evidence: [],
      note: 'Collection failed; the published dataset was not updated.',
    },
    counts: previousMeta?.counts ?? {
      offers: 0,
      tlids: 0,
      registrars: 0,
      verified_offers: 0,
      stale_offers: 0,
      recent_offers: 0,
      aging_offers: 0,
      unknown_offers: 0,
      by_source: {},
      by_verification: { verified: 0, source_snapshot: 0, model_derived: 0, unverified: 0 },
    },
    history: [
      { at: nowIso, status: 'failed', offers: previousMeta?.counts.offers ?? 0, note: error },
      ...(previousMeta?.history ?? []),
    ].slice(0, 50),
  };
  await atomicWrite(PRICES_META_PATH, meta);
}

main().catch(e => {
  console.error('[sync-prices] unexpected error:', e);
  process.exit(1);
});