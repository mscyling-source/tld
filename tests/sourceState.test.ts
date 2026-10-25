/**
 * Per-source lifecycle rules.
 *
 * The failure mode these tests exist for: a third-party snapshot that is
 * downloaded successfully every day but whose internal dates never move. The
 * workflow stays green, the deploy succeeds, and the site serves two-month-old
 * prices under a "successfully synced" banner. Nothing in the old pipeline
 * could tell that apart from a genuine refresh.
 *
 * So: attempt time, success time and evidence time are three different
 * questions, and `evidence_advanced` answers the fourth — "did this run
 * actually get anything newer than last run's?".
 */

import { describe, it, expect } from 'vitest';
import {
  newestEvidenceDate,
  oldestEvidenceDate,
  evidenceStateFor,
  evidenceAdvanced,
  buildSourceLifecycle,
  buildCoverage,
  previousSuccessfulFetchFrom,
} from '../scripts/pricing/sourceState.js';
import type { PriceOffer } from '../src/lib/pricingTypes.js';
import { RECENT_WITHIN_DAYS, STALE_AFTER_DAYS } from '../src/config/freshness.js';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** Minimal offer with just the fields the evidence rules read. */
function offer(over: Partial<PriceOffer> = {}): PriceOffer {
  return {
    tld: 'com',
    registrar_id: 'porkbun',
    registrar_name: 'Porkbun',
    currency: 'USD',
    register_usd: 10,
    renewal_usd: 12,
    transfer_usd: 11,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: 34,
    source_id: 'porkbun',
    source_name: 'Porkbun',
    source_url: 'https://example.test',
    purchase_url: null,
    source_fetched_at: NOW.toISOString(),
    price_observed_at: null,
    price_verified_at: null,
    verification_status: 'source_snapshot',
    last_checked: '',
    freshness: 'unknown',
    quality: 'stale',
    source_status_stale: false,
    ...over,
  } as PriceOffer;
}

describe('evidence dates across a row set', () => {
  it('takes the newest parsable evidence date', () => {
    const rows = [
      offer({ price_observed_at: '2026-08-04' }),
      offer({ price_observed_at: '2026-10-21' }),
      offer({ price_verified_at: '2026-10-24T09:00:00.000Z', price_observed_at: '2020-01-01' }),
    ];
    expect(newestEvidenceDate(rows)).toBe('2026-10-24T09:00:00.000Z');
    // The third row's observation date is superseded by its verification date,
    // so it is not the oldest evidence in the set either.
    expect(oldestEvidenceDate(rows)).toBe('2026-08-04');
  });

  it('prefers the verification date over the observation date on the same row', () => {
    // This is `effectiveEvidenceDate`: a first-party read is evidenced by when
    // we read it, not by whatever observation date the payload also carried.
    const row = offer({ price_verified_at: '2026-10-24T09:00:00.000Z', price_observed_at: '2020-01-01' });
    expect(newestEvidenceDate([row])).toBe('2026-10-24T09:00:00.000Z');
  });

  it('ignores rows with no date and unparsable dates', () => {
    const rows = [offer(), offer({ price_observed_at: 'not-a-date' }), offer({ price_observed_at: '2026-09-02' })];
    expect(newestEvidenceDate(rows)).toBe('2026-09-02');
  });

  it('returns null when nothing is dated', () => {
    expect(newestEvidenceDate([offer(), offer()])).toBeNull();
    expect(oldestEvidenceDate([])).toBeNull();
  });
});

describe('evidence state bands', () => {
  it('is current inside the recent window', () => {
    expect(evidenceStateFor(NOW.toISOString(), NOW)).toBe('current');
    expect(evidenceStateFor(daysAgo(RECENT_WITHIN_DAYS), NOW)).toBe('current');
  });

  it('is aging between the recent window and the stale threshold', () => {
    expect(evidenceStateFor(daysAgo(RECENT_WITHIN_DAYS + 1), NOW)).toBe('aging');
    expect(evidenceStateFor(daysAgo(STALE_AFTER_DAYS), NOW)).toBe('aging');
  });

  it('is frozen once the evidence is older than the stale threshold', () => {
    // 51 days: Spaceship's real state in the dataset this rule was written for.
    expect(evidenceStateFor(daysAgo(STALE_AFTER_DAYS + 1), NOW)).toBe('frozen');
    expect(evidenceStateFor('2026-08-04', NOW)).toBe('frozen');
  });

  it('is none without a usable date', () => {
    expect(evidenceStateFor(null, NOW)).toBe('none');
    expect(evidenceStateFor('nonsense', NOW)).toBe('none');
  });
});

describe('evidence advancement', () => {
  it('is true only when the newest evidence is strictly newer', () => {
    expect(evidenceAdvanced('2026-10-24', '2026-10-21')).toBe(true);
    // Re-downloading the same frozen snapshot: the date did not move.
    expect(evidenceAdvanced('2026-09-02', '2026-09-02')).toBe(false);
    expect(evidenceAdvanced('2026-09-01', '2026-09-02')).toBe(false);
  });

  it('treats a first-ever date as an advance and a missing date as nothing', () => {
    expect(evidenceAdvanced('2026-10-24', null)).toBe(true);
    expect(evidenceAdvanced(null, '2026-10-24')).toBe(false);
    expect(evidenceAdvanced(null, null)).toBe(false);
  });
});

describe('source lifecycle', () => {
  const base = {
    attempted: 10,
    parsed: 8,
    rejectedTotal: 2,
    retainedFromPrevious: 0,
    published: [offer({ price_verified_at: daysAgo(0) })],
    previousSuccessfulFetchAt: '2026-10-20T00:00:00.000Z',
    previousPriceEvidenceAt: '2026-10-20T00:00:00.000Z',
    attemptedAt: NOW.toISOString(),
    now: NOW,
  };

  it('advances the success time only when the fetch succeeded', () => {
    const ok = buildSourceLifecycle({ ...base, status: 'ok' });
    expect(ok.last_attempt_at).toBe(NOW.toISOString());
    expect(ok.last_successful_fetch_at).toBe(NOW.toISOString());
    // The compatibility alias must never be fresher than a real success.
    expect(ok.fetched_at).toBe(NOW.toISOString());
  });

  it('does not advance the success time on a fallback', () => {
    const kept = buildSourceLifecycle({ ...base, status: 'kept-previous' });
    expect(kept.last_attempt_at).toBe(NOW.toISOString());
    expect(kept.last_successful_fetch_at).toBe('2026-10-20T00:00:00.000Z');
    expect(kept.fetched_at).toBe('2026-10-20T00:00:00.000Z');
  });

  it('reports no success at all for a source that never worked', () => {
    const failed = buildSourceLifecycle({
      ...base,
      status: 'failed',
      published: [],
      previousSuccessfulFetchAt: null,
      previousPriceEvidenceAt: null,
    });
    expect(failed.last_successful_fetch_at).toBeNull();
    expect(failed.price_evidence_at).toBeNull();
    expect(failed.evidence_state).toBe('none');
    expect(failed.evidence_advanced).toBe(false);
  });

  it('never lets an attempt time masquerade as a successful fetch', () => {
    // The alias is read back by the next run as `previousSuccessfulFetchAt`,
    // so a non-null value here would permanently mark an unconfigured source
    // as having succeeded once.
    const failed = buildSourceLifecycle({
      ...base,
      status: 'failed',
      published: [],
      previousSuccessfulFetchAt: null,
      previousPriceEvidenceAt: null,
    });
    expect(failed.fetched_at).toBeNull();
    expect(failed.last_attempt_at).toBe(NOW.toISOString());
  });

  it('carries the retained-row count so a fallback is visible', () => {
    const kept = buildSourceLifecycle({
      ...base,
      status: 'shrunk-kept-previous',
      retainedFromPrevious: 1377,
      published: [offer({ price_observed_at: '2026-09-02' })],
    });
    expect(kept.retained_from_previous).toBe(1377);
    expect(kept.attempted).toBe(10);
    expect(kept.parsed).toBe(8);
    expect(kept.rejected_total).toBe(2);
  });

  it('flags a frozen upstream even though the fetch succeeded', () => {
    const frozen = buildSourceLifecycle({
      ...base,
      status: 'ok',
      published: [offer({ price_observed_at: '2026-09-02' })],
      previousPriceEvidenceAt: '2026-09-02',
    });
    expect(frozen.last_successful_fetch_at).toBe(NOW.toISOString());
    expect(frozen.evidence_state).toBe('frozen');
    // Downloaded again, nothing new inside it.
    expect(frozen.evidence_advanced).toBe(false);
  });
});

describe('coverage verdict', () => {
  const source = (id: string, evidence_state: 'current' | 'aging' | 'frozen' | 'none') => ({
    id,
    evidence_state,
  });

  it('is complete when every source is current and every registrar has a current offer', () => {
    const coverage = buildCoverage(
      [source('porkbun', 'current'), source('pikkly', 'current')],
      [
        offer({ registrar_id: 'porkbun', freshness: 'recent', price_verified_at: daysAgo(0) }),
        offer({ registrar_id: 'cloudflare', freshness: 'aging', price_observed_at: daysAgo(10) }),
      ],
      NOW,
    );
    expect(coverage.complete).toBe(true);
    expect(coverage.frozen_sources).toEqual([]);
    expect(coverage.note).toContain('Every source delivered current evidence');
  });

  it('is incomplete when a source is frozen, and names it', () => {
    const coverage = buildCoverage(
      [source('porkbun', 'current'), source('opendomaindata', 'frozen')],
      [offer({ freshness: 'recent', price_verified_at: daysAgo(0) })],
      NOW,
    );
    expect(coverage.complete).toBe(false);
    expect(coverage.frozen_sources).toEqual(['opendomaindata']);
    expect(coverage.note).toContain('opendomaindata');
    // Singular agreement, because this string is read by humans.
    expect(coverage.note).toContain('1 source downloaded successfully but carries');
  });

  it('lists a registrar whose every offer is stale', () => {
    const coverage = buildCoverage(
      [source('pikkly', 'current')],
      [
        offer({ registrar_id: 'cloudflare', price_observed_at: '2026-08-04', freshness: 'stale' }),
        offer({ registrar_id: 'porkbun', price_verified_at: daysAgo(0), freshness: 'recent' }),
      ],
      NOW,
    );
    expect(coverage.registrars_without_current_evidence).toEqual(['cloudflare']);
    expect(coverage.complete).toBe(false);
  });

  it('does not condemn a registrar that has at least one current offer', () => {
    const coverage = buildCoverage(
      [source('porkbun', 'current')],
      [
        offer({ registrar_id: 'spaceship', price_observed_at: '2026-09-02', freshness: 'stale' }),
        offer({ registrar_id: 'spaceship', tld: 'net', price_verified_at: daysAgo(0), freshness: 'recent' }),
      ],
      NOW,
    );
    expect(coverage.registrars_without_current_evidence).toEqual([]);
  });

  it('counts a source that failed as stale rather than frozen', () => {
    const coverage = buildCoverage([source('porkbun', 'none')], [], NOW);
    expect(coverage.stale_sources).toEqual(['porkbun']);
    expect(coverage.frozen_sources).toEqual([]);
    expect(coverage.complete).toBe(false);
  });
});

describe('previousSuccessfulFetchFrom', () => {
  /** Build a record with ONLY the keys given, so a missing key stays missing. */
  const record = (over: {
    last_successful_fetch_at?: string | null;
    fetched_at?: string | null;
  }) => over as Parameters<typeof previousSuccessfulFetchFrom>[0];

  it('prefers the explicit lifecycle field', () => {
    expect(
      previousSuccessfulFetchFrom(
        record({
          last_successful_fetch_at: '2026-10-24T00:00:00.000Z',
          fetched_at: '2020-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe('2026-10-24T00:00:00.000Z');
  });

  it('falls back to fetched_at for a dataset written before the field existed', () => {
    // A legacy record has no lifecycle key at all, so its absence means "not
    // recorded", not "never succeeded".
    expect(previousSuccessfulFetchFrom(record({ fetched_at: '2026-10-20T00:00:00.000Z' }))).toBe(
      '2026-10-20T00:00:00.000Z',
    );
  });

  it('keeps a modern record honest: an explicit null means it never succeeded', () => {
    // This is the regression that let an unconfigured source inherit its own
    // attempt time as a successful fetch on the following run.
    expect(
      previousSuccessfulFetchFrom(
        record({ last_successful_fetch_at: null, fetched_at: '2026-10-25T02:17:22.449Z' }),
      ),
    ).toBeNull();
  });

  it('returns null for an unknown source', () => {
    expect(previousSuccessfulFetchFrom(undefined)).toBeNull();
  });

  it('returns null when a modern record has neither field', () => {
    expect(previousSuccessfulFetchFrom(record({}))).toBeNull();
  });
});
