/**
 * Row-level validation for incoming price offers.
 *
 * Reject rules (each produces a counted issue, never a silent drop):
 *   - unknown TLD (not present in the IANA catalog)
 *   - invalid price (negative, zero, NaN, above the sanity ceiling)
 *   - missing currency (row must declare USD — all sources are USD-normalised)
 *   - invalid source/purchase URL (must be http/https)
 *   - unverifiable row: a `verified` claim with no verification date, or an
 *     unusable date anywhere. This is the rule that stops a fetch timestamp
 *     from silently standing in for an observation date.
 *   - duplicate offer within the same source batch
 *   - row with no usable price at all
 *
 * Note what is deliberately NOT a reject rule: a missing observation date on a
 * `source_snapshot` row. Those rows are kept and surface as `unverified` in the
 * UI, because dropping them would silently shrink the catalogue. Only a row
 * that *claims* verification without a date is rejected outright.
 */

import type { RawOffer, VerificationStatus } from '../../src/lib/pricingTypes.js';
import { isFinitePrice } from '../../src/lib/pricingCalc.js';

export interface RejectedRow {
  registrar_id: string;
  tld: string;
  reason:
    | 'unknown-tld'
    | 'invalid-price'
    | 'missing-currency'
    | 'invalid-url'
    | 'invalid-timestamp'
    | 'unverifiable'
    | 'duplicate'
    | 'no-price'
    | 'missing-identity';
}

export interface ValidationResult {
  valid: RawOffer[];
  rejected: RejectedRow[];
}

const TLD_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const KNOWN_VERIFICATIONS: ReadonlySet<string> = new Set([
  'verified',
  'source_snapshot',
  'model_derived',
  'unverified',
]);

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Check a single offer. Returns a rejection reason or null when valid. */
export function validateOffer(offer: RawOffer, knownTlds: Set<string>): RejectedRow['reason'] | null {
  if (!offer.registrar_id || !offer.registrar_name) return 'missing-identity';

  const tld = offer.tld;
  if (!tld || !TLD_RE.test(tld) || !knownTlds.has(tld)) return 'unknown-tld';

  if (offer.currency !== 'USD') return 'missing-currency';

  if (offer.invalid_fields && offer.invalid_fields.length > 0) return 'invalid-price';

  for (const field of ['register_usd', 'renewal_usd', 'transfer_usd'] as const) {
    const v = offer[field];
    if (v !== null && !isFinitePrice(v)) return 'invalid-price';
  }
  if (offer.register_usd === null && offer.renewal_usd === null && offer.transfer_usd === null) {
    return 'no-price';
  }

  if (!isHttpUrl(offer.source_url)) return 'invalid-url';
  if (offer.purchase_url !== null && !isHttpUrl(offer.purchase_url)) return 'invalid-url';

  const verification: VerificationStatus = offer.verification_status ?? 'source_snapshot';
  if (!KNOWN_VERIFICATIONS.has(verification)) return 'unverifiable';

  // A verification claim must be backed by a verification date. This is the
  // guard that would catch an adapter that "verifies" rows using the fetch time.
  if (verification === 'verified') {
    const v = offer.price_verified_at;
    if (typeof v !== 'string' || !v || Number.isNaN(Date.parse(v))) return 'unverifiable';
  }

  // Any date that is present must parse. A missing date on a snapshot row is
  // allowed through and displayed as `unverified`.
  for (const date of [offer.price_observed_at, offer.price_verified_at]) {
    if (date === null || date === undefined || date === '') continue;
    if (Number.isNaN(Date.parse(date))) return 'invalid-timestamp';
  }

  return null;
}

/** Validate a batch from one source; deduplicates within the batch. */
export function validateOffers(offers: RawOffer[], knownTlds: Set<string>): ValidationResult {
  const valid: RawOffer[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  for (const offer of offers) {
    const reason = validateOffer(offer, knownTlds);
    if (reason) {
      rejected.push({ registrar_id: offer.registrar_id, tld: offer.tld, reason });
      continue;
    }
    const key = `${offer.registrar_id}|${offer.tld}`;
    if (seen.has(key)) {
      rejected.push({ registrar_id: offer.registrar_id, tld: offer.tld, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    valid.push(offer);
  }
  return { valid, rejected };
}

/** Group rejection reasons for summaries. */
export function countRejections(rejected: RejectedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return counts;
}
