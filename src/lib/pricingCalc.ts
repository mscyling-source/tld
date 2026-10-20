/**
 * Pure pricing calculations — shared by the sync pipeline, the build-time
 * store, and the unit tests. No I/O, no clock access except via arguments,
 * so every function is deterministic and testable.
 */

import type { PriceOffer, PricePoint, PriceQuality, ComparisonRow } from './pricingTypes.js';

/** Offers older than this are shown but excluded from "verified" filters. */
export const STALE_AFTER_DAYS = 30;

/** Sanity ceiling for a standard (non-premium) annual registration price. */
export const MAX_SANE_PRICE_USD = 100_000;

export type PriceField = 'register_usd' | 'renewal_usd' | 'transfer_usd' | 'three_year_usd';

/**
 * Best-effort 3-year ownership cost.
 *
 * Formula (documented on the site): **first year at the registration price
 * + two renewals at the standard renewal price**, i.e. `register + 2 × renewal`.
 * Only computed when BOTH inputs exist — a missing renewal price yields null
 * rather than a fabricated estimate. Promotional terms (e.g. "renews at $X
 * after year 1") are represented by using the standard renewal price the
 * source publishes, which is exactly the number a buyer pays in years 2–3.
 */
export function calcThreeYear(
  register: number | null,
  renewal: number | null,
): number | null {
  if (register === null || renewal === null) return null;
  if (!isFinitePrice(register) || !isFinitePrice(renewal)) return null;
  return Math.round((register + renewal * 2) * 100) / 100;
}

/** True for usable prices: finite, > 0, within the sanity ceiling. */
export function isFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SANE_PRICE_USD;
}

/**
 * Normalise a source price to a number.
 *
 * Accepts numbers and numeric strings (`"11.08"` — Porkbun quotes strings).
 * Returns null for absent values (`null`, `undefined`, `''`, `'n/a'`).
 * Throws for out-of-range / non-numeric garbage so validation can reject
 * the row instead of silently storing 0.
 */
export function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`invalid price: ${value}`);
    if (value < 0) throw new Error(`invalid price: ${value}`);
    if (value > MAX_SANE_PRICE_USD) throw new Error(`price out of range: ${value}`);
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned.toLowerCase() === 'n/a') return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) throw new Error(`invalid price string: ${value}`);
    if (parsed < 0) throw new Error(`invalid price: ${value}`);
    if (parsed > MAX_SANE_PRICE_USD) throw new Error(`price out of range: ${value}`);
    return Math.round(parsed * 100) / 100;
  }
  throw new Error(`invalid price type: ${typeof value}`);
}

/**
 * Classify freshness from the source's check timestamp.
 *
 * Never uses "when the site was rebuilt": only the timestamp the source
 * itself published. Unparsable dates are treated as stale, not verified.
 */
export function qualityFor(lastChecked: string, now: Date): PriceQuality {
  const t = Date.parse(lastChecked);
  if (Number.isNaN(t)) return 'stale';
  const ageDays = (now.getTime() - t) / 86_400_000;
  // Clock skew: a timestamp in the future by >1 day is not trustworthy.
  if (ageDays < -1) return 'stale';
  return ageDays <= STALE_AFTER_DAYS ? 'verified' : 'stale';
}

/** Effective stored quality: a source-flagged stale row never upgrades. */
export function effectiveQuality(offer: Pick<PriceOffer, 'last_checked' | 'source_status_stale'>, now: Date): PriceQuality {
  if (offer.source_status_stale) return 'stale';
  return qualityFor(offer.last_checked, now);
}

/**
 * Format a price for display: `$11.08`. Callers render the
 * "Price unavailable" placeholder for null themselves.
 */
export function formatUsd(value: number | null): string {
  if (value === null) return '';
  return `$${value.toFixed(2)}`;
}

/**
 * Pick the cheapest non-null price for a field across offers.
 * Ties resolve to `verified` quality first, then registrar name (stable).
 */
export function cheapestPoint(offers: PriceOffer[], field: PriceField, now: Date): PricePoint | null {
  let best: PricePoint | null = null;
  for (const offer of offers) {
    const usd = offer[field];
    if (usd === null || !isFinitePrice(usd)) continue;
    const point: PricePoint = {
      usd,
      registrar_id: offer.registrar_id,
      registrar_name: offer.registrar_name,
      quality: effectiveQuality(offer, now),
      last_checked: offer.last_checked,
    };
    if (best === null || isBetterPoint(point, best)) best = point;
  }
  return best;
}

function isBetterPoint(a: PricePoint, b: PricePoint): boolean {
  if (a.usd !== b.usd) return a.usd < b.usd;
  const aVerified = a.quality === 'verified' ? 0 : 1;
  const bVerified = b.quality === 'verified' ? 0 : 1;
  if (aVerified !== bVerified) return aVerified < bVerified;
  return a.registrar_name.localeCompare(b.registrar_name, 'en') < 0;
}

export type ComparisonSortKey =
  | 'register-asc'
  | 'renewal-asc'
  | 'transfer-asc'
  | 'three-year-asc'
  | 'suffix-asc';

/**
 * Sort comparison rows. Rows missing the sort price always sink to the
 * end (missing data is never treated as cheapest).
 */
export function sortComparisonRows(rows: ComparisonRow[], key: ComparisonSortKey): ComparisonRow[] {
  const out = [...rows];
  if (key === 'suffix-asc') {
    return out.sort((a, b) => a.suffix.localeCompare(b.suffix, 'en'));
  }
  const pointOf: Record<string, (r: ComparisonRow) => PricePoint | null> = {
    'register-asc': r => r.register,
    'renewal-asc': r => r.renewal,
    'transfer-asc': r => r.transfer,
    'three-year-asc': r => r.three_year,
  };
  const get = pointOf[key];
  return out.sort((a, b) => {
    const pa = get(a);
    const pb = get(b);
    if (pa && pb) return pa.usd - pb.usd || a.suffix.localeCompare(b.suffix, 'en');
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.suffix.localeCompare(b.suffix, 'en');
  });
}
