/**
 * Per-source lifecycle and coverage rules.
 *
 * The pipeline already recorded three timestamps per *offer* (when we fetched,
 * when the source observed the price, when we verified it). What it could not
 * express was the same distinction per *source* — and that is the difference
 * between "the workflow ran" and "the prices moved".
 *
 * Concretely: a third-party snapshot can be downloaded successfully every
 * single day while every date inside it stays frozen at whatever the upstream
 * last observed. Such a source reported `status: ok`, the dataset reported
 * `status: ok`, the deploy went green, and four registrars served two-month-old
 * prices under a "successfully synced" banner.
 *
 * So each source now carries:
 *
 *   last_attempt_at          when this run tried to read it
 *   last_successful_fetch_at when it last returned rows we actually adopted
 *   price_evidence_at        the newest evidence date among its rows
 *
 * plus `evidence_advanced` (did the newest evidence date move?) and
 * `evidence_state` (is that evidence current?). Everything here is pure so the
 * rules are unit-testable without a network.
 */

import type {
  PriceCoverage,
  PriceOffer,
  PriceSourceInfo,
  SourceEvidenceState,
} from '../../src/lib/pricingTypes.js';
import {
  effectiveEvidenceDate,
  effectiveFreshness,
  RECENT_WITHIN_DAYS,
  STALE_AFTER_DAYS,
} from '../../src/lib/pricingCalc.js';

/** Anything that carries the two evidence timestamps. */
type Dated = {
  price_verified_at?: string | null;
  price_observed_at?: string | null;
};

/** Newest parsable evidence date across a set of rows, or null. */
export function newestEvidenceDate(rows: Dated[]): string | null {
  let newest: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const date = effectiveEvidenceDate(row);
    if (!date) continue;
    const ms = Date.parse(date);
    if (Number.isNaN(ms)) continue;
    if (ms > newestMs) {
      newestMs = ms;
      newest = date;
    }
  }
  return newest;
}

/** Oldest parsable evidence date across a set of rows, or null. */
export function oldestEvidenceDate(rows: Dated[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const date = effectiveEvidenceDate(row);
    if (!date) continue;
    const ms = Date.parse(date);
    if (Number.isNaN(ms)) continue;
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = date;
    }
  }
  return oldest;
}

/**
 * Band the newest evidence a source carries.
 *
 * `frozen` is the important one: the download worked, but nothing in it is
 * newer than the stale threshold, so the source is not refreshing its data.
 */
export function evidenceStateFor(newest: string | null, now: Date): SourceEvidenceState {
  if (!newest) return 'none';
  const ms = Date.parse(newest);
  if (Number.isNaN(ms)) return 'none';
  const ageDays = (now.getTime() - ms) / 86_400_000;
  if (ageDays > STALE_AFTER_DAYS) return 'frozen';
  if (ageDays <= RECENT_WITHIN_DAYS) return 'current';
  return 'aging';
}

/**
 * Did this run obtain evidence newer than the previous run's?
 *
 * Strictly newer, not "different": re-reading the same frozen snapshot leaves
 * the newest evidence date identical, and that must report false so the run
 * summary can say the source delivered nothing new.
 */
export function evidenceAdvanced(current: string | null, previous: string | null): boolean {
  if (!current) return false;
  if (!previous) return true;
  const a = Date.parse(current);
  const b = Date.parse(previous);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}

export interface SourceLifecycleInput {
  /** Outcome the runner recorded for this source. */
  status: PriceSourceInfo['status'];
  /** Rows the adapter returned before validation. */
  attempted: number;
  /** Rows that passed validation. */
  parsed: number;
  /** Rows rejected by validation. */
  rejectedTotal: number;
  /** Rows kept from the previous dataset because the fetch was unusable. */
  retainedFromPrevious: number;
  /** The rows this source will publish (valid rows, or the retained ones). */
  published: Dated[];
  /** `last_successful_fetch_at` from the previous dataset, if any. */
  previousSuccessfulFetchAt: string | null;
  /** `price_evidence_at` from the previous dataset, if any. */
  previousPriceEvidenceAt: string | null;
  /** This run's clock. */
  attemptedAt: string;
  now: Date;
}

export type SourceLifecycle = Pick<
  PriceSourceInfo,
  | 'last_attempt_at'
  | 'last_successful_fetch_at'
  | 'price_evidence_at'
  | 'previous_price_evidence_at'
  | 'evidence_advanced'
  | 'evidence_state'
  | 'retained_from_previous'
  | 'attempted'
  | 'parsed'
  | 'rejected_total'
  | 'fetched_at'
  | 'oldest_observed_at'
>;

/**
 * Derive the lifecycle block for one source.
 *
 * `last_successful_fetch_at` only advances on `status === 'ok'`. A fallback
 * keeps the old value, because "we downloaded the file" is not "we refreshed
 * the data" — and a run that never fetched anything at all must not inherit
 * this run's clock.
 */
export function buildSourceLifecycle(input: SourceLifecycleInput): SourceLifecycle {
  const evidenceAt = newestEvidenceDate(input.published);
  const oldest = oldestEvidenceDate(input.published);
  const succeeded = input.status === 'ok';
  const lastSuccessful = succeeded
    ? input.attemptedAt
    : (input.previousSuccessfulFetchAt ?? null);

  return {
    last_attempt_at: input.attemptedAt,
    last_successful_fetch_at: lastSuccessful,
    price_evidence_at: evidenceAt,
    previous_price_evidence_at: input.previousPriceEvidenceAt,
    evidence_advanced: evidenceAdvanced(evidenceAt, input.previousPriceEvidenceAt),
    evidence_state: evidenceStateFor(evidenceAt, input.now),
    retained_from_previous: input.retainedFromPrevious,
    attempted: input.attempted,
    parsed: input.parsed,
    rejected_total: input.rejectedTotal,
    // Compatibility alias. Null when this source has never succeeded: writing
    // the attempt time here would let the *next* run read it back as a
    // successful fetch, which is precisely the fake freshness this field is
    // supposed to prevent.
    fetched_at: lastSuccessful,
    oldest_observed_at: oldest,
  };
}

/**
 * The last time a source *successfully* fetched, as recorded by the previous
 * dataset.
 *
 * The distinction that matters is *absent* versus *null*:
 *
 *   - a dataset written before `last_successful_fetch_at` existed has no such
 *     property at all, and only carries `fetched_at`, which was already
 *     defined as a successful fetch time — so it is a legitimate fallback;
 *   - a dataset written since carries an explicit `null` for a source that has
 *     never worked, and that null must survive. Reading an attempt time back
 *     as a success is exactly how a permanently-unconfigured source ends up
 *     looking like it once worked.
 */
export function previousSuccessfulFetchFrom(
  info: Pick<PriceSourceInfo, 'last_successful_fetch_at' | 'fetched_at'> | undefined,
): string | null {
  if (!info) return null;
  if (info.last_successful_fetch_at !== undefined) return info.last_successful_fetch_at;
  return info.fetched_at ?? null;
}

/**
 * Judge how much of the published dataset is actually current.
 *
 * Deliberately stricter than `meta.status`: a source that downloaded fine but
 * carries frozen evidence is not a coverage success, and a registrar whose
 * every offer is stale has no current price at all.
 */
export function buildCoverage(
  sources: Array<{ id: string; evidence_state: SourceEvidenceState }>,
  offers: PriceOffer[],
  now: Date,
): PriceCoverage {
  const current: string[] = [];
  const frozen: string[] = [];
  const stale: string[] = [];

  for (const source of sources) {
    if (source.evidence_state === 'current') current.push(source.id);
    else if (source.evidence_state === 'frozen') frozen.push(source.id);
    else stale.push(source.id);
  }

  const byRegistrar = new Map<string, boolean>();
  for (const offer of offers) {
    const band = effectiveFreshness(offer, now);
    const isCurrent = band === 'recent' || band === 'aging';
    byRegistrar.set(offer.registrar_id, (byRegistrar.get(offer.registrar_id) ?? false) || isCurrent);
  }
  const registrarsWithout = [...byRegistrar.entries()]
    .filter(([, ok]) => !ok)
    .map(([id]) => id)
    .sort();

  const complete = frozen.length === 0 && stale.length === 0 && registrarsWithout.length === 0;

  const parts: string[] = [];
  if (complete) {
    parts.push('Every source delivered current evidence.');
  } else {
    if (frozen.length) {
      parts.push(
        `${frozen.length} source${frozen.length === 1 ? '' : 's'} downloaded successfully but ` +
          `${frozen.length === 1 ? 'carries' : 'carry'} no evidence newer than ${STALE_AFTER_DAYS} days ` +
          `(${frozen.join(', ')})`,
      );
    }
    if (stale.length) {
      parts.push(`${stale.length} source${stale.length === 1 ? '' : 's'} did not deliver usable data (${stale.join(', ')})`);
    }
    if (registrarsWithout.length) {
      parts.push(
        `no current quote exists for ${registrarsWithout.join(', ')} — their figures are historical snapshots`,
      );
    }
  }

  return {
    complete,
    current_sources: current.sort(),
    frozen_sources: frozen.sort(),
    stale_sources: stale.sort(),
    registrars_without_current_evidence: registrarsWithout,
    note: parts.join('; ') + '.',
  };
}
