/**
 * Pure pricing calculations — shared by the sync pipeline, the build-time
 * store, and the unit tests. No I/O, no clock access except via arguments,
 * so every function is deterministic and testable.
 */

import type {
  ComparisonRow,
  PriceField,
  PriceFreshness,
  PriceOffer,
  PricePoint,
  VerificationStatus,
} from './pricingTypes.js';
import {
  freshnessFor,
  RECENT_WITHIN_DAYS,
  STALE_AFTER_DAYS,
  VERIFICATION_RANK,
} from '../config/freshness.js';

export { freshnessFor, RECENT_WITHIN_DAYS, STALE_AFTER_DAYS, VERIFICATION_RANK };
export type { PriceField };

/** Sanity ceiling for a standard (non-premium) annual registration price. */
export const MAX_SANE_PRICE_USD = 100_000;

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
 * Accepts numbers and numeric strings (`"11.08"` — Porkbun quotes strings,
 * Dynadot quotes `"$10.88"`). Returns null for absent values (`null`,
 * `undefined`, `''`, `'n/a'`, `'-1'` which several sources use as "no price").
 * Throws for out-of-range / non-numeric garbage so validation can reject
 * the row instead of silently storing 0.
 */
export function normalizePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`invalid price: ${value}`);
    if (value < 0) throw new Error(`invalid price: ${value}`);
    if (value > MAX_SANE_PRICE_USD) throw new Error(`price out of range: ${value}`);
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned.toLowerCase() === 'n/a') return null;
    // Several sources emit "-1" as an explicit "no price published" sentinel.
    if (cleaned === '-1') return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) throw new Error(`invalid price string: ${value}`);
    if (parsed < 0) throw new Error(`invalid price: ${value}`);
    if (parsed > MAX_SANE_PRICE_USD) throw new Error(`price out of range: ${value}`);
    return Math.round(parsed * 100) / 100;
  }
  throw new Error(`invalid price type: ${typeof value}`);
}

/** Parse a currency-formatted string such as `"$10.88"` / `"1 234,50"` → null-safe. */
export function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return normalizePrice(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  return normalizePrice(cleaned);
}

/**
 * The date that actually evidences a price.
 *
 * This is the single most important rule in the codebase: a fetch timestamp
 * must never stand in for an observation date, or every price would look
 * freshly verified every morning. First-party reads use `price_verified_at`;
 * snapshot rows use the dataset's own `price_observed_at`. Returns null when
 * neither is known — callers must then treat the row as unverified rather
 * than inventing a date.
 */
export function effectiveEvidenceDate(offer: {
  price_verified_at?: string | null;
  price_observed_at?: string | null;
}): string | null {
  const verified = offer.price_verified_at ?? null;
  if (verified && !Number.isNaN(Date.parse(verified))) return verified;
  const observed = offer.price_observed_at ?? null;
  if (observed && !Number.isNaN(Date.parse(observed))) return observed;
  return null;
}

/**
 * Classify freshness from the verification status and the evidence date.
 *
 * Never uses "when the site was rebuilt" and never uses the fetch timestamp:
 * only the timestamp the source itself published. Unparsable dates become
 * `unknown`, not `recent`.
 */
export function qualityFor(
  verification: VerificationStatus,
  evidenceDate: string | null,
  now: Date,
): PriceFreshness {
  return freshnessFor(verification, evidenceDate, now);
}

/**
 * Effective stored freshness: a source-flagged stale row never upgrades.
 *
 * Accepts both `RawOffer` (where the dates are optional) and `PriceOffer`
 * (where they are required but nullable), so the sync pipeline and the build
 * use exactly the same rule.
 */
export function effectiveFreshness(
  offer: {
    price_verified_at?: string | null;
    price_observed_at?: string | null;
    /** Absent means `source_snapshot` — the same default validation applies. */
    verification_status?: VerificationStatus;
    source_status_stale?: boolean;
  },
  now: Date,
): PriceFreshness {
  // A source that flags its own row stale can never read as anything better
  // than stale, even when its own date looks fresh.
  if (offer.source_status_stale) return 'stale';
  return freshnessFor(
    offer.verification_status ?? 'source_snapshot',
    effectiveEvidenceDate(offer),
    now,
  );
}

/** Legacy v1 quality flag derived from the v2 freshness band. */
export function freshnessToQuality(freshness: PriceFreshness): 'verified' | 'stale' {
  return freshness === 'recent' || freshness === 'aging' ? 'verified' : 'stale';
}

/** True when a promotion's explicit end date has already passed. */
export function isPromotionExpired(
  promotionExpiresAt: string | null | undefined,
  now: Date,
): boolean {
  if (!promotionExpiresAt) return false;
  const t = Date.parse(promotionExpiresAt);
  if (Number.isNaN(t)) return false;
  return t < now.getTime();
}

/**
 * Format a price for display: `$11.08`. Callers render the
 * "Price unavailable" placeholder for null themselves.
 */
export function formatUsd(value: number | null): string {
  if (value === null) return '';
  return `$${value.toFixed(2)}`;
}

/** Format an ISO date for display in UTC, or null when unusable. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
}

/**
 * Evidence that is recent enough to be presented as a current quote.
 *
 * `recent` (≤7 days, first-party read) and `aging` (8–30 days, or a snapshot
 * no older than a week) both qualify. `stale` (>30 days) and `unknown` (no
 * usable date) do not: an eight-week-old snapshot must never occupy the
 * "cheapest" slot, or the site would advertise a price the registrar may have
 * changed long ago.
 */
export function isCurrentEvidence(freshness: PriceFreshness): boolean {
  return freshness === 'recent' || freshness === 'aging';
}

/**
 * Pick the cheapest price for a field across offers — but only among figures
 * whose evidence is still current.
 *
 * Ranking: current evidence first (stale/undated quotes never win while any
 * current alternative exists), then lower price, then better verification
 * status, then fresher evidence, then registrar name (stable).
 *
 * When nothing current is available the cheapest stale quote is returned
 * anyway — labelled as such by its own badges — because showing an old price
 * with an honest date beats showing "unavailable" and pretending we have no
 * data. In that fallback the winner is the cheapest of what exists.
 *
 * Whenever a cheaper stale/undated quote lost to a current one, it is carried
 * on `cheaper_stale` so the UI can disclose it instead of silently hiding a
 * lower published price.
 */
export function cheapestPoint(offers: PriceOffer[], field: PriceField, now: Date): PricePoint | null {
  let current: PricePoint | null = null;
  let stale: PricePoint | null = null;

  for (const offer of offers) {
    const usd = offer[field];
    if (usd === null || !isFinitePrice(usd)) continue;
    const freshness = effectiveFreshness(offer, now);
    const point: PricePoint = {
      usd,
      registrar_id: offer.registrar_id,
      registrar_name: offer.registrar_name,
      verification_status: offer.verification_status,
      freshness,
      last_checked: effectiveEvidenceDate(offer) ?? '',
      promotional: offer.promotional === true,
      promotion_expired: isPromotionExpired(offer.promotion_expires_at, now),
      quality: freshnessToQuality(freshness),
      cheaper_stale: null,
    };
    if (isCurrentEvidence(freshness)) {
      if (current === null || isBetterPoint(point, current)) current = point;
    } else if (stale === null || isBetterPoint(point, stale)) {
      stale = point;
    }
  }

  if (current === null) return stale;
  if (stale !== null && stale.usd < current.usd) {
    current.cheaper_stale = {
      usd: stale.usd,
      registrar_id: stale.registrar_id,
      registrar_name: stale.registrar_name,
      verification_status: stale.verification_status,
      freshness: stale.freshness,
      last_checked: stale.last_checked,
    };
  }
  return current;
}

function isBetterPoint(a: PricePoint, b: PricePoint): boolean {
  if (a.usd !== b.usd) return a.usd < b.usd;
  const rankA = VERIFICATION_RANK[a.verification_status];
  const rankB = VERIFICATION_RANK[b.verification_status];
  if (rankA !== rankB) return rankA < rankB;
  const freshRank: Record<PriceFreshness, number> = { recent: 0, aging: 1, stale: 2, unknown: 3 };
  if (freshRank[a.freshness] !== freshRank[b.freshness]) return freshRank[a.freshness] < freshRank[b.freshness];
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

/** Human summary of a freshness band, used in badges and tooltips. */
export function freshnessDescription(offer: {
  verification_status: VerificationStatus;
  price_verified_at?: string | null;
  price_observed_at?: string | null;
}): string {
  const date = effectiveEvidenceDate(offer);
  if (!date) return 'no observation date available';
  const kind = offer.verification_status === 'verified' ? 'verified' : 'observed';
  return `${kind} ${formatDate(date)}`;
}