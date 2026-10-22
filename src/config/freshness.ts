/**
 * Price freshness policy — documented, configurable thresholds.
 *
 * These numbers decide which badge a price row gets. They are *policy*, not
 * permission to mislabel: a row never claims to be fresher than its evidence.
 * The two axes are deliberately independent:
 *
 *   1. `verification_status` — HOW the figure was obtained
 *        verified        read directly from the registrar's own published
 *                        source (official API or official pricing page) during
 *                        a sync run
 *        source_snapshot carried by a dated third-party dataset snapshot;
 *                        accurate as of that dataset's own observation date
 *        model_derived   computed from a documented policy rather than a
 *                        published price (e.g. Cloudflare's at-cost model)
 *        unverified      no trustworthy observation date, or the upstream
 *                        pipeline itself flagged the row as placeholder
 *
 *   2. `freshness` — HOW OLD that evidence is
 *        recent    observed within RECENT_WITHIN_DAYS
 *        aging      observed within STALE_AFTER_DAYS but no longer recent
 *        stale      older than STALE_AFTER_DAYS
 *        unknown    no parsable observation date
 *
 * An `unverified` row is always `unknown`, and a `model_derived` row is never
 * presented as `verified` no matter how recent its derivation date is.
 */

import type { PriceFreshness, VerificationStatus } from '../lib/pricingTypes.js';

/** Re-exported so callers can import the policy types and thresholds together. */
export type { PriceFreshness, VerificationStatus };

/** Verified within this many days ⇒ "recently verified". */
export const RECENT_WITHIN_DAYS = 7;

/** Older than this many days ⇒ stale. */
export const STALE_AFTER_DAYS = 30;

/** Ignore clock skew below this (a date further ahead than this is untrusted). */
export const MAX_FUTURE_SKEW_DAYS = 1;

/**
 * Relative cost of each verification tier when two sources disagree about the
 * same (registrar, TLD). Lower wins. A figure we read from the registrar's own
 * site outranks a third-party snapshot, which outranks a derived model.
 */
export const VERIFICATION_RANK: Record<VerificationStatus, number> = {
  verified: 0,
  source_snapshot: 1,
  model_derived: 2,
  unverified: 3,
};

/** Human label per verification status, used in badges and tooltips. */
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: 'Verified',
  source_snapshot: 'Snapshot',
  model_derived: 'Modelled',
  unverified: 'Unverified',
};

/** One-sentence explanation shown in the tooltip behind each status badge. */
export const VERIFICATION_EXPLANATION: Record<VerificationStatus, string> = {
  verified:
    'Read directly from this registrar’s own published price list during our daily sync. The date shown is when we read it.',
  source_snapshot:
    'Taken from an openly licensed third-party dataset, not read from the registrar today. The date shown is that dataset’s own observation date, so the price may have changed since.',
  model_derived:
    'Derived from a documented pricing policy rather than a published price list. Treat it as an indication, not a quote.',
  unverified:
    'No trustworthy observation date, or the upstream pipeline flagged this row as placeholder data. Do not rely on it.',
};

/** Human label per freshness band. */
export const FRESHNESS_LABEL: Record<PriceFreshness, string> = {
  recent: 'Recently verified',
  aging: 'Verification not recent',
  stale: 'Stale',
  unknown: 'Unverified',
};

/** One-sentence explanation shown in the tooltip behind each freshness badge. */
export const FRESHNESS_EXPLANATION: Record<PriceFreshness, string> = {
  recent: `Observed within the last ${RECENT_WITHIN_DAYS} days.`,
  aging: `Observed more than ${RECENT_WITHIN_DAYS} days ago but within ${STALE_AFTER_DAYS}. The price may have changed since.`,
  stale: `Observed more than ${STALE_AFTER_DAYS} days ago. Treat this as a historical reference price, not a current quote.`,
  unknown: 'No observation date is available for this price, so its age cannot be established.',
};

/**
 * A `freshness` band is only ever as strong as its `verification_status`:
 * a snapshot read today is still a snapshot, so it is never labelled
 * "Recently verified".
 */
export function freshnessFor(
  verification: VerificationStatus,
  evidenceDate: string | null | undefined,
  now: Date,
): PriceFreshness {
  if (verification === 'unverified') return 'unknown';
  if (!evidenceDate) return 'unknown';
  const t = Date.parse(evidenceDate);
  if (Number.isNaN(t)) return 'unknown';
  const ageDays = (now.getTime() - t) / 86_400_000;
  if (ageDays < -MAX_FUTURE_SKEW_DAYS) return 'unknown';
  if (ageDays > STALE_AFTER_DAYS) return 'stale';
  // Only a first-party read earns "recently verified"; snapshots stay "aging"
  // no matter how recently the dataset was rebuilt.
  if (ageDays <= RECENT_WITHIN_DAYS) return verification === 'verified' ? 'recent' : 'aging';
  return 'aging';
}