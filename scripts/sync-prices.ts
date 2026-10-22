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
import { buildReport, diffPrices, renderMarkdown, type SourceReport } from './pricing/report.js';
import { purchaseUrlFor } from '../src/config/registrars.js';
import { applyTrustPolicy, quarantineReason } from './pricing/trust.js';
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

type SourceOutcome = {
  info: PriceSourceInfo;
  offers: RawOffer[];
  rejections: Record<string, number>;
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
  previousFetchedAt: Map<string, string>,
  now: Date,
): Promise<SourceOutcome> {
  const fetchedAt = now.toISOString();
  const base: PriceSourceInfo = {
    id: adapter.id,
    name: adapter.name,
    url: adapter.url,
    license: adapter.license,
    attribution: adapter.attribution,
    verification_status: adapter.verificationStatus,
    rows: 0,
    fetched_at: fetchedAt,
    oldest_observed_at: null,
    status: 'ok',
  };
  const previous = previousBySource.get(adapter.id) ?? [];
  // When we keep previous rows we must NOT claim this run's fetch time for
  // them — the old rows keep whatever fetch timestamp they were written with.
  const keptFetchedAt = previousFetchedAt.get(adapter.id) ?? fetchedAt;

  const keepPrevious = (status: PriceSourceInfo['status'], error: string, rejections: Record<string, number> = {}): SourceOutcome => {
    const dates = previous
      .map(o => effectiveEvidenceDate(o))
      .filter((d): d is string => typeof d === 'string')
      .sort();
    return {
      info: {
        ...base,
        status,
        rows: previous.length,
        fetched_at: keptFetchedAt,
        oldest_observed_at: dates[0] ?? null,
        error,
        rejections,
      },
      offers: previous,
      rejections,
    };
  };

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

  // Empty/garbage results must never overwrite a working dataset.
  if (valid.length === 0) {
    log(`${adapter.id}: 0 valid rows (raw=${raw.length})`);
    return keepPrevious(previous.length > 0 ? 'kept-previous' : 'failed', 'no valid rows returned', rejectionCounts);
  }

  // Sudden shrinkage usually means a broken payload — keep known-good data.
  if (previous.length > 0 && valid.length < previous.length * SHRINK_RATIO) {
    log(`${adapter.id}: suspicious shrink ${previous.length} → ${valid.length} — keeping previous rows`);
    return keepPrevious(
      'shrunk-kept-previous',
      `shrink ${previous.length} → ${valid.length} (< ${SHRINK_RATIO * 100}%)`,
      rejectionCounts,
    );
  }

  const dates = valid
    .map(o => effectiveEvidenceDate(o))
    .filter((d): d is string => typeof d === 'string')
    .sort();

  const rejectedTotal = Object.values(rejectionCounts).reduce((a, b) => a + b, 0);
  log(
    `${adapter.id}: ${valid.length} valid rows (${rejectedTotal} rejected: ${JSON.stringify(rejectionCounts)}), ` +
      `oldest observation ${dates[0] ?? 'unknown'}`,
  );
  return {
    info: {
      ...base,
      rows: valid.length,
      oldest_observed_at: dates[0] ?? null,
      rejections: rejectionCounts,
    },
    offers: valid,
    rejections: rejectionCounts,
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
  const previousFetchedAt = new Map<string, string>();
  for (const offer of previous?.offers ?? []) {
    const list = previousBySource.get(offer.source_id) ?? [];
    list.push(offer);
    previousBySource.set(offer.source_id, list);
  }
  for (const source of previous?.sources ?? []) {
    if (source.fetched_at) previousFetchedAt.set(source.id, source.fetched_at);
  }

  log(
    `starting: ${sourceAdapters.length} sources, catalog ${knownTlds.size} TLDs, previous ${previous?.offers.length ?? 0} offers`,
  );

  const outcomes: SourceOutcome[] = [];
  for (const adapter of sourceAdapters) {
    outcomes.push(await runSource(adapter, knownTlds, previousBySource, previousFetchedAt, now));
  }

  const anyRows = outcomes.some(o => o.offers.length > 0);
  if (!anyRows) {
    await writeFailureMeta(nowIso, 'all sources failed — data/prices.json untouched');
    log('FATAL: every source failed; dataset left untouched');
    process.exit(1);
  }

  // Resolve purchase links: source-provided → verified registry pattern → homepage.
  const finalizedSourceOffers: RawOffer[] = [];
  for (const outcome of outcomes) {
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
      source_fetched_at:
        outcomes.find(o => o.info.id === raw.source_id)?.info.fetched_at ?? nowIso,
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

  const bySource: Record<string, number> = {};
  const tldsSeen = new Set<string>();
  const registrarsSeen = new Set<string>();
  const byVerification: Record<VerificationStatus, number> = {
    verified: 0,
    source_snapshot: 0,
    model_derived: 0,
    unverified: 0,
  };
  let recent = 0;
  let aging = 0;
  let stale = 0;
  let unknown = 0;
  for (const offer of offers) {
    bySource[offer.source_id] = (bySource[offer.source_id] ?? 0) + 1;
    byVerification[offer.verification_status] = (byVerification[offer.verification_status] ?? 0) + 1;
    tldsSeen.add(offer.tld);
    registrarsSeen.add(offer.registrar_id);
    if (offer.freshness === 'recent') recent++;
    else if (offer.freshness === 'aging') aging++;
    else if (offer.freshness === 'stale') stale++;
    else unknown++;
  }
  // "verified_offers" counts first-party reads specifically; freshness is
  // reported separately by recent/aging/stale/unknown.
  const verified = byVerification.verified;

  const dataset: PriceDataset = {
    schema_version: 2,
    generated_at: nowIso,
    currency: 'USD',
    sources: outcomes.map(o => o.info),
    offers,
  };

  const allStatuses = outcomes.map(o => o.info.status);
  const metaStatus: PriceMeta['status'] = allStatuses.every(s => s === 'ok')
    ? 'ok'
    : outcomes.some(o => o.info.status === 'ok' || o.info.status === 'kept-previous')
      ? 'partial'
      : 'failed';
  const errors = outcomes
    .filter(o => o.info.error)
    .map(o => `${o.info.id}: ${o.info.error}`);

  // Report: what we stand behind, not just what we downloaded.
  const sourceReports: SourceReport[] = outcomes.map(o => ({
    source_id: o.info.id,
    source_name: o.info.name,
    status: o.info.status,
    verification_status: o.info.verification_status,
    rows: o.info.rows,
    rejected: Object.values(o.info.rejections ?? {}).reduce((a, b) => a + b, 0),
    rejections: o.info.rejections ?? {},
    fetched_at: o.info.fetched_at,
    oldest_observed_at: o.info.oldest_observed_at,
    error: o.info.error ?? null,
  }));
  const changes = diffPrices(previous, dataset);
  const report = buildReport({ runAt: nowIso, dataset, sources: sourceReports, changes, now });

  const previousMeta = await loadJson<PriceMeta>(PRICES_META_PATH);
  const meta: PriceMeta = {
    last_success_at: metaStatus === 'failed' ? previousMeta?.last_success_at ?? null : nowIso,
    last_attempt_at: nowIso,
    status: metaStatus,
    last_error: errors.length ? errors.join(' | ') : null,
    counts: {
      offers: offers.length,
      tlids: tldsSeen.size,
      registrars: registrarsSeen.size,
      verified_offers: verified,
      stale_offers: stale + unknown,
      recent_offers: recent,
      aging_offers: aging,
      unknown_offers: unknown,
      by_source: bySource,
      by_verification: byVerification,
    },
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
    `done: ${offers.length} offers across ${tldsSeen.size} TLDs and ${registrarsSeen.size} registrars ` +
      `(verified=${byVerification.verified}, snapshot=${byVerification.source_snapshot}, ` +
      `model=${byVerification.model_derived}, unverified=${byVerification.unverified}; ` +
      `recent=${recent}, aging=${aging}, stale=${stale}, unknown=${unknown}${supersededNote}), status=${metaStatus}`,
  );
  for (const o of outcomes) {
    log(
      `  source ${o.info.id} [${o.info.verification_status}]: ${o.info.status}` +
        `${o.info.error ? ` (${o.info.error})` : ''} rows=${o.info.rows} oldest=${o.info.oldest_observed_at ?? 'unknown'}`,
    );
  }
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