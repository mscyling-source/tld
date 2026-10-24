/**
 * Build-time pricing store.
 *
 * Reads `data/prices.json` (written by scripts/sync-prices.ts) and joins it
 * with the IANA catalog for types. All functions run during `astro build` —
 * no runtime I/O.
 *
 * Freshness is recomputed from each offer's own evidence date at build time,
 * so a rebuild can never make old prices look current: an offer's freshness
 * band only ever degrades with age, because it is derived from the source's
 * observation/verification date rather than from the build clock. A row with
 * no usable evidence date is shown as unverified rather than being dated "now".
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ComparisonRow, PriceDataset, PriceMeta, PriceOffer, VerificationStatus } from './pricingTypes.js';
import { cheapestPoint, effectiveFreshness, freshnessToQuality } from './pricingCalc.js';
import { isFirstPartySource } from '../config/sources.js';
import { loadAllRecords } from './store.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRICES_PATH = path.join(DATA_DIR, 'prices.json');
const PRICES_META_PATH = path.join(DATA_DIR, 'prices-meta.json');

let cache: { dataset: PriceDataset | null; meta: PriceMeta | null } | null = null;

/**
 * Normalise a possibly-v1 dataset read from disk.
 *
 * v1 rows carry a single `last_checked` and no verification tier. They are
 * treated as `source_snapshot` with that date as the observation date, which
 * is exactly what v1 documented ("the most conservative timestamp the source
 * exposes") — never as verified, because a v1 row cannot prove we read it.
 *
 * Exported so the trust rules below can be unit-tested directly rather than
 * only through a build.
 */
export function normalizeOffer(raw: Record<string, unknown>): PriceOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const tld = typeof raw.tld === 'string' ? raw.tld : null;
  const registrarId = typeof raw.registrar_id === 'string' ? raw.registrar_id : null;
  if (!tld || !registrarId) return null;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const iso = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null;
    return Number.isNaN(Date.parse(v)) ? null : v;
  };

  const observedAt = iso(raw.price_observed_at) ?? iso(raw.last_checked);
  const verifiedAt = iso(raw.price_verified_at);
  const declared = raw.verification_status;
  const sourceId = typeof raw.source_id === 'string' ? raw.source_id : 'unknown';
  const firstParty = isFirstPartySource(sourceId);
  const declaredTier: VerificationStatus | null =
    declared === 'verified' || declared === 'source_snapshot' || declared === 'model_derived' || declared === 'unverified'
      ? declared
      : null;

  /**
   * A row may only be published as `verified` when BOTH hold:
   *   1. the producing source is one *we* read first-party, and
   *   2. a verification date backs the claim.
   *
   * Otherwise it is downgraded to `source_snapshot`, never promoted. This is
   * the build-time twin of the validation rule: a third-party dataset that
   * labels its own rows "verified" must not be republished as our first-party
   * read, and a row that merely *claims* verification without a date must not
   * borrow its observation date to look verified. Both mistakes are how a
   * download timestamp starts masquerading as a verification.
   */
  let verificationStatus: VerificationStatus;
  if (declaredTier === 'verified') {
    verificationStatus = firstParty && verifiedAt ? 'verified' : 'source_snapshot';
  } else if (declaredTier) {
    verificationStatus = declaredTier;
  } else {
    // v1 rows carry no tier: classify them by the source that produced them.
    // A first-party read with a date is `verified`; without one it is
    // `unverified` rather than dated "now".
    verificationStatus = firstParty ? (observedAt ? 'verified' : 'unverified') : 'source_snapshot';
  }
  // A snapshot can never carry a verification date, whatever the file says.
  // `observedAt` is only ever used here for a first-party row whose own
  // observation date is the read date (v1 compatibility).
  const effectiveVerifiedAt =
    verificationStatus === 'verified' && firstParty ? (verifiedAt ?? observedAt) : null;

  return {
    tld,
    registrar_id: registrarId,
    registrar_name: typeof raw.registrar_name === 'string' ? raw.registrar_name : registrarId,
    currency: 'USD',
    register_usd: num(raw.register_usd),
    renewal_usd: num(raw.renewal_usd),
    transfer_usd: num(raw.transfer_usd),
    promotional: raw.promotional === true,
    promo_code: typeof raw.promo_code === 'string' ? raw.promo_code : null,
    promo_restrictions: typeof raw.promo_restrictions === 'string' ? raw.promo_restrictions : null,
    promotion_expires_at: iso(raw.promotion_expires_at),
    three_year_usd: num(raw.three_year_usd),
    source_id: sourceId,
    source_name: typeof raw.source_name === 'string' ? raw.source_name : 'Unknown source',
    source_url: typeof raw.source_url === 'string' ? raw.source_url : '',
    purchase_url: typeof raw.purchase_url === 'string' ? raw.purchase_url : null,
    source_fetched_at: iso(raw.source_fetched_at) ?? '',
    price_observed_at: observedAt,
    price_verified_at: effectiveVerifiedAt,
    verification_status: verificationStatus,
    last_checked: effectiveVerifiedAt ?? observedAt ?? '',
    freshness: 'unknown',
    quality: 'stale',
    source_status_stale: raw.source_status_stale === true,
  };
}

export function normalizeDataset(raw: unknown): PriceDataset | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const offersRaw = Array.isArray(record.offers) ? record.offers : [];
  const offers = offersRaw
    .map(o => normalizeOffer(o as Record<string, unknown>))
    .filter((o): o is PriceOffer => o !== null);
  const sourcesRaw = Array.isArray(record.sources) ? record.sources : [];
  return {
    // v1 datasets are migrated in memory; the in-memory shape is always v2.
    schema_version: 2,
    generated_at: typeof record.generated_at === 'string' ? record.generated_at : '',
    currency: 'USD',
    sources: sourcesRaw as PriceDataset['sources'],
    offers,
  };
}

async function readPrices(): Promise<{ dataset: PriceDataset | null; meta: PriceMeta | null }> {
  if (cache) return cache;
  const read = async (p: string) => {
    try {
      return JSON.parse(await fs.readFile(p, 'utf-8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  const [rawDataset, meta] = await Promise.all([read(PRICES_PATH), read(PRICES_META_PATH)]);
  cache = { dataset: normalizeDataset(rawDataset), meta };
  return cache;
}

/** Full price dataset (null before the first successful sync). */
export async function readPriceDataset(): Promise<PriceDataset | null> {
  return (await readPrices()).dataset;
}

/** Price sync metadata (last run, counts, history). */
export async function readPriceMeta(): Promise<PriceMeta | null> {
  return (await readPrices()).meta;
}

/** Recompute freshness/quality for every offer against the build clock. */
export function refreshOffers(offers: PriceOffer[], now: Date): PriceOffer[] {
  return offers.map(o => {
    const freshness = effectiveFreshness(o, now);
    return {
      ...o,
      freshness,
      quality: freshnessToQuality(freshness),
      // Keep the compatibility alias in step with the recomputed evidence date.
      last_checked: o.price_verified_at ?? o.price_observed_at ?? '',
    };
  });
}

/** Freshness-adjusted offers for one TLD (`com` or `.com`). */
export async function getOffersForTld(tld: string): Promise<PriceOffer[]> {
  const ds = await readPrices();
  if (!ds?.dataset) return [];
  const bare = tld.replace(/^\./, '').toLowerCase();
  const now = new Date();
  return refreshOffers(
    ds.dataset.offers.filter(o => o.tld === bare),
    now,
  );
}

/**
 * Per-TLD cheapest-price rows for the homepage comparison table.
 * Only TLDs with at least one offer appear — every other extension is
 * simply "no price data yet", never a guess.
 */
export async function buildComparisonRows(): Promise<ComparisonRow[]> {
  const ds = await readPrices();
  if (!ds?.dataset) return [];
  const now = new Date();

  const records = await loadAllRecords();
  const typeByTld = new Map<string, string | null>();
  for (const r of records) typeByTld.set(r.ascii_name, r.normalized_type);

  const byTld = new Map<string, PriceOffer[]>();
  for (const offer of ds.dataset.offers) {
    const list = byTld.get(offer.tld) ?? [];
    list.push(offer);
    byTld.set(offer.tld, list);
  }

  const rows: ComparisonRow[] = [];
  for (const [tld, offers] of byTld) {
    // Refresh freshness against the build clock for honest sorting/filtering.
    const fresh = refreshOffers(offers, now);
    const register = cheapestPoint(fresh, 'register_usd', now);
    const renewal = cheapestPoint(fresh, 'renewal_usd', now);
    const transfer = cheapestPoint(fresh, 'transfer_usd', now);
    const threeYear = cheapestPoint(fresh, 'three_year_usd', now);

    const firstPoint = register ?? renewal ?? transfer ?? threeYear;
    const registrars = [...new Set(fresh.map(o => o.registrar_name))].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
    const dates = fresh
      .map(o => o.last_checked)
      .filter((d): d is string => typeof d === 'string' && d !== '');
    const latest = dates.length
      ? dates.reduce((max, d) => (Date.parse(d) > Date.parse(max) ? d : max))
      : '';

    rows.push({
      suffix: `.${tld}`,
      tld,
      type: typeByTld.get(tld) ?? null,
      offers: fresh.length,
      // "Verified" counts first-party reads regardless of age — freshness is a
      // separate axis and is reported by `stale_offers` and each point's badge.
      verified_offers: fresh.filter(o => o.verification_status === 'verified').length,
      stale_offers: fresh.filter(o => o.freshness === 'stale' || o.freshness === 'unknown').length,
      register,
      renewal,
      transfer,
      three_year: threeYear,
      visit_url: firstPoint
        ? fresh.find(o => o.registrar_id === firstPoint.registrar_id)?.purchase_url ?? ''
        : '',
      visit_registrar: firstPoint?.registrar_name ?? '',
      registrars,
      latest_checked: latest,
      // When nothing was read from a registrar's own source, the UI must
      // qualify the cheapest figure instead of calling it a current best.
      only_snapshots: fresh.length > 0 && fresh.every(o => o.verification_status !== 'verified'),
    });
  }

  return rows.sort((a, b) => a.suffix.localeCompare(b.suffix, 'en'));
}

/** Headline numbers for the homepage / footer. */
export interface PriceStats {
  tlids: number;
  registrars: number;
  offers: number;
  generatedAt: string | null;
  /** Offers read from a registrar's own published price list. */
  verifiedOffers: number;
  /** Offers carried by a dated third-party dataset. */
  snapshotOffers: number;
  /**
   * Offers in the `stale` band: evidence older than 30 days. Counted alone so
   * this agrees with `price-sync-report.json` → `totals.by_freshness.stale`.
   */
  staleOffers: number;
  /** Offers with no usable evidence date. */
  unknownOffers: number;
  sources: Array<{
    id: string;
    name: string;
    url: string;
    license: string;
    attribution: string | null;
    status: string;
    verification_status: string;
    oldest_observed_at: string | null;
  }>;
}

export async function getPriceStats(): Promise<PriceStats | null> {
  const { dataset } = await readPrices();
  if (!dataset) return null;
  const now = new Date();
  const fresh = refreshOffers(dataset.offers, now);
  const registrars = new Set(fresh.map(o => o.registrar_id));
  return {
    tlids: new Set(fresh.map(o => o.tld)).size,
    registrars: registrars.size,
    offers: fresh.length,
    generatedAt: dataset.generated_at,
    verifiedOffers: fresh.filter(o => o.verification_status === 'verified').length,
    snapshotOffers: fresh.filter(o => o.verification_status === 'source_snapshot').length,
    staleOffers: fresh.filter(o => o.freshness === 'stale').length,
    unknownOffers: fresh.filter(o => o.freshness === 'unknown').length,
    sources: dataset.sources.map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      license: s.license,
      attribution: s.attribution,
      status: s.status,
      verification_status: s.verification_status ?? 'source_snapshot',
      oldest_observed_at: s.oldest_observed_at ?? null,
    })),
  };
}