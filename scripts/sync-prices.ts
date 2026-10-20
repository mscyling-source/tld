/**
 * scripts/sync-prices.ts — registrar price sync pipeline.
 *
 * Design rules (docs/PRICING-DATA.md):
 *   - Authorized sources only: official public APIs and openly-licensed
 *     datasets. No registrar scraping, no anti-bot bypasses.
 *   - Validate before replace: a source that fails, returns zero valid
 *     rows, or shrinks by >50% keeps its previous rows untouched.
 *   - Empty results never overwrite good data; total failure exits 1 and
 *     leaves data/prices.json byte-for-byte unchanged.
 *   - Freshness comes from source timestamps (`last_checked`), never from
 *     "when we rebuilt the site".
 *   - Atomic writes: tmp file + rename.
 *   - data/tlds.json (IANA catalog) is read-only here; this script never
 *     writes it.
 *
 * Exit codes: 0 = dataset written (possibly partial), 1 = failure.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sourceAdapters, missingEnvFor, type SourceAdapter } from './pricing/sources/index.js';
import { validateOffers, countRejections } from './pricing/validate.js';
import { mergeBatches } from './pricing/merge.js';
import { purchaseUrlFor } from '../src/config/registrars.js';
import { calcThreeYear, effectiveQuality } from '../src/lib/pricingCalc.js';
import type {
  PriceDataset,
  PriceMeta,
  PriceOffer,
  PriceSourceInfo,
  RawOffer,
  SourceBatch,
} from '../src/lib/pricingTypes.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..');
const TLDS_PATH = resolve(PROJECT_ROOT, 'data', 'tlds.json');
const PRICES_PATH = resolve(PROJECT_ROOT, 'data', 'prices.json');
const PRICES_META_PATH = resolve(PROJECT_ROOT, 'data', 'prices-meta.json');

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
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tmp, path);
}

/** Run one adapter with all guards; never throws. */
async function runSource(
  adapter: SourceAdapter,
  knownTlds: Set<string>,
  previousBySource: Map<string, PriceOffer[]>,
  now: Date,
): Promise<SourceOutcome> {
  const base: PriceSourceInfo = {
    id: adapter.id,
    name: adapter.name,
    url: adapter.url,
    license: adapter.license,
    attribution: adapter.attribution,
    rows: 0,
    fetched_at: now.toISOString(),
    status: 'ok',
  };
  const previous = previousBySource.get(adapter.id) ?? [];

  const missingEnv = missingEnvFor(adapter);
  if (missingEnv.length > 0) {
    if (previous.length > 0) {
      log(`${adapter.id}: missing env ${missingEnv.join(', ')} — keeping ${previous.length} previous rows`);
      return {
        info: { ...base, status: 'kept-previous', error: `missing env: ${missingEnv.join(', ')}` },
        offers: previous,
        rejections: {},
      };
    }
    log(`${adapter.id}: missing env ${missingEnv.join(', ')} — source skipped`);
    return {
      info: { ...base, status: 'failed', error: `missing env: ${missingEnv.join(', ')}` },
      offers: [],
      rejections: {},
    };
  }

  let raw: RawOffer[];
  try {
    raw = await adapter.fetchOffers();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (previous.length > 0) {
      log(`${adapter.id}: fetch failed (${message}) — keeping ${previous.length} previous rows`);
      return {
        info: { ...base, status: 'kept-previous', error: message },
        offers: previous,
        rejections: {},
      };
    }
    log(`${adapter.id}: fetch failed (${message}) — no previous data`);
    return { info: { ...base, status: 'failed', error: message }, offers: [], rejections: {} };
  }

  const { valid, rejected } = validateOffers(raw, knownTlds);
  const rejectionCounts = countRejections(rejected);

  // Empty/garbage results must never overwrite a working dataset.
  if (valid.length === 0) {
    if (previous.length > 0) {
      log(`${adapter.id}: 0 valid rows (raw=${raw.length}) — keeping ${previous.length} previous rows`);
      return {
        info: { ...base, status: 'kept-previous', rows: previous.length, error: 'no valid rows returned' },
        offers: previous,
        rejections: rejectionCounts,
      };
    }
    log(`${adapter.id}: 0 valid rows (raw=${raw.length}) — source failed`);
    return {
      info: { ...base, status: 'failed', error: 'no valid rows returned' },
      offers: [],
      rejections: rejectionCounts,
    };
  }

  // Sudden shrinkage usually means a broken payload — keep known-good data.
  if (previous.length > 0 && valid.length < previous.length * SHRINK_RATIO) {
    log(
      `${adapter.id}: suspicious shrink ${previous.length} → ${valid.length} — keeping previous rows`,
    );
    return {
      info: {
        ...base,
        status: 'shrunk-kept-previous',
        rows: previous.length,
        error: `shrink ${previous.length} → ${valid.length} (< ${SHRINK_RATIO * 100}%)`,
      },
      offers: previous,
      rejections: rejectionCounts,
    };
  }

  const rejectedTotal = Object.values(rejectionCounts).reduce((a, b) => a + b, 0);
  log(`${adapter.id}: ${valid.length} valid rows (${rejectedTotal} rejected: ${JSON.stringify(rejectionCounts)})`);
  return { info: { ...base, rows: valid.length }, offers: valid, rejections: rejectionCounts };
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

  const previous = await loadJson<PriceDataset>(PRICES_PATH);
  const previousBySource = new Map<string, PriceOffer[]>();
  for (const offer of previous?.offers ?? []) {
    const list = previousBySource.get(offer.source_id) ?? [];
    list.push(offer);
    previousBySource.set(offer.source_id, list);
  }

  log(`starting: ${sourceAdapters.length} sources, catalog ${knownTlds.size} TLDs, previous ${previous?.offers.length ?? 0} offers`);

  const outcomes: SourceOutcome[] = [];
  for (const adapter of sourceAdapters) {
    outcomes.push(await runSource(adapter, knownTlds, previousBySource, now));
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

  // Merge across sources: one offer per (registrar, TLD), freshest wins.
  const batches: SourceBatch[] = sourceAdapters
    .map(adapter => ({
      sourceId: adapter.id,
      priority: adapter.priority,
      offers: finalizedSourceOffers.filter(o => o.source_id === adapter.id),
    }))
    .filter(b => b.offers.length > 0);
  const merge = mergeBatches(batches);

  const offers: PriceOffer[] = merge.merged.map(raw => ({
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
    three_year_usd: calcThreeYear(raw.register_usd, raw.renewal_usd),
    source_id: raw.source_id,
    source_url: raw.source_url,
    purchase_url: raw.purchase_url,
    last_checked: raw.last_checked,
    quality: effectiveQuality(
      { last_checked: raw.last_checked, source_status_stale: raw.source_status_stale },
      now,
    ),
    source_status_stale: raw.source_status_stale,
  }));

  if (offers.length === 0) {
    await writeFailureMeta(nowIso, 'merge produced zero offers — data/prices.json untouched');
    log('FATAL: merge produced zero offers; dataset left untouched');
    process.exit(1);
  }

  const bySource: Record<string, number> = {};
  const tldsSeen = new Set<string>();
  const registrarsSeen = new Set<string>();
  let verified = 0;
  let stale = 0;
  for (const offer of offers) {
    bySource[offer.source_id] = (bySource[offer.source_id] ?? 0) + 1;
    tldsSeen.add(offer.tld);
    registrarsSeen.add(offer.registrar_id);
    if (offer.quality === 'verified') verified++;
    else stale++;
  }

  const dataset: PriceDataset = {
    schema_version: 1,
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
      stale_offers: stale,
      by_source: bySource,
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

  const supersededNote = merge.superseded > 0 ? `, ${merge.superseded} superseded by fresher copies` : '';
  log(
    `done: ${offers.length} offers across ${tldsSeen.size} TLDs and ${registrarsSeen.size} registrars ` +
      `(verified=${verified}, stale=${stale}${supersededNote}), status=${metaStatus}`,
  );
  for (const o of outcomes) {
    log(`  source ${o.info.id}: ${o.info.status}${o.info.error ? ` (${o.info.error})` : ''} rows=${o.info.rows}`);
  }
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
      by_source: {},
    },
    history: [{ at: nowIso, status: 'failed', offers: previousMeta?.counts.offers ?? 0, note: error }, ...(previousMeta?.history ?? [])].slice(0, 50),
  };
  await atomicWrite(PRICES_META_PATH, meta);
}

main().catch(e => {
  console.error('[sync-prices] unexpected error:', e);
  process.exit(1);
});
