/**
 * Pricing pipeline tests: the freshness policy, pure calculations, validation,
 * merge ranking, source parsers (fixtures shaped from real payloads), the sync
 * report, schema migration, outbound-link policy, and an integration pass over
 * the committed dataset.
 *
 * Invariants under test:
 *   - missing prices stay null ("Price unavailable"), never 0
 *   - three-year cost = register + 2×renewal, only when both exist
 *   - a price is dated by its EVIDENCE, never by when we downloaded it
 *   - a snapshot is never labelled "recently verified", however new the download
 *   - a better-verified copy beats a fresher-looking snapshot for the same
 *     registrar+TLD (tier is checked before age)
 *   - invalid rows (unknown TLD, bad price, bad URL, dupes, unbacked
 *     "verified" claims) are rejected
 *   - outbound links are ordinary links; no affiliate params by default
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  calcThreeYear,
  normalizePrice,
  parseMoney,
  qualityFor,
  effectiveEvidenceDate,
  effectiveFreshness,
  freshnessToQuality,
  isPromotionExpired,
  cheapestPoint,
  isCurrentEvidence,
  sortComparisonRows,
  formatUsd,
  formatDate,
  RECENT_WITHIN_DAYS,
  STALE_AFTER_DAYS,
  MAX_SANE_PRICE_USD,
} from '../src/lib/pricingCalc.js';
import {
  FRESHNESS_EXPLANATION,
  VERIFICATION_EXPLANATION,
  VERIFICATION_RANK,
  freshnessFor,
} from '../src/config/freshness.js';
import { validateOffers, countRejections } from '../scripts/pricing/validate.js';
import { mergeBatches } from '../scripts/pricing/merge.js';
import { applyTrustPolicy, quarantineReason } from '../scripts/pricing/trust.js';
import { migrateDataset } from '../scripts/pricing/migrate.js';
import { buildReport, buildMetaCounts, buildRegistrarReports, diffPrices, renderMarkdown } from '../scripts/pricing/report.js';
import { parsePorkbun } from '../scripts/pricing/sources/porkbun.js';
import { parsePikkly } from '../scripts/pricing/sources/pikkly.js';
import { parseOdd } from '../scripts/pricing/sources/opendomaindata.js';
import { parseBdr, mapVerificationStatus } from '../scripts/pricing/sources/bestdomainregistrars.js';
import { parseHover } from '../scripts/pricing/sources/hover.js';
import { parseGandiPage } from '../scripts/pricing/sources/gandi.js';
import { parseIonos } from '../scripts/pricing/sources/ionos.js';
import { decodeDevalue, findTldCatalogue, parseDynadot } from '../scripts/pricing/sources/dynadot.js';
import {
  purchaseUrlFor,
  outboundRel,
  hasAffiliate,
  registrarName,
  registrars,
} from '../src/config/registrars.js';
import { readPriceDataset, readPriceMeta, getOffersForTld, buildComparisonRows, getPriceStats, refreshOffers, normalizeOffer } from '../src/lib/pricing.js';
import type {
  ComparisonRow,
  PriceDataset,
  PriceOffer,
  PricePoint,
  RawOffer,
} from '../src/lib/pricingTypes.js';
import type { SourceReport } from '../scripts/pricing/report.js';
import {
  porkbunSuccess,
  pikklyPayload,
  oddPayload,
  bdrCsv,
  bdrVerification,
  hoverPage,
  gandiPage,
  ionosPage,
  rawOffer,
  snapshotOffer,
} from './fixtures/pricing-fixtures.js';

const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'ai', 'dev', 'app', 'xyz', 'cloudflare', 'invalidtld',
]);

const NOW = new Date('2026-10-20T12:00:00.000Z');
const day = (n: number): string =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe('freshness policy', () => {
  it('bands verified evidence into recent / aging / stale', () => {
    expect(freshnessFor('verified', day(0), NOW)).toBe('recent');
    expect(freshnessFor('verified', day(-RECENT_WITHIN_DAYS), NOW)).toBe('recent');
    expect(freshnessFor('verified', day(-RECENT_WITHIN_DAYS - 1), NOW)).toBe('aging');
    expect(freshnessFor('verified', day(-STALE_AFTER_DAYS), NOW)).toBe('aging');
    expect(freshnessFor('verified', day(-STALE_AFTER_DAYS - 1), NOW)).toBe('stale');
    expect(freshnessFor('verified', '2026-05-12T00:00:00Z', NOW)).toBe('stale');
  });

  it('never lets a snapshot be labelled "recently verified"', () => {
    // A dataset rebuilt this morning is still a snapshot of an older read.
    expect(freshnessFor('source_snapshot', day(0), NOW)).toBe('aging');
    expect(freshnessFor('model_derived', day(0), NOW)).toBe('aging');
    expect(freshnessFor('unverified', day(0), NOW)).toBe('unknown');
  });

  it('treats missing, unparsable and far-future dates as unknown', () => {
    expect(freshnessFor('verified', null, NOW)).toBe('unknown');
    expect(freshnessFor('verified', 'not-a-date', NOW)).toBe('unknown');
    // A date more than a day ahead is untrusted (clock skew, bad upstream data).
    expect(freshnessFor('verified', day(3), NOW)).toBe('unknown');
    expect(freshnessFor('verified', day(0.5), NOW)).toBe('recent');
  });

  it('keeps the documented thresholds and explanations in sync', () => {
    expect(RECENT_WITHIN_DAYS).toBe(7);
    expect(STALE_AFTER_DAYS).toBe(30);
    expect(VERIFICATION_RANK.verified).toBeLessThan(VERIFICATION_RANK.source_snapshot);
    expect(VERIFICATION_RANK.source_snapshot).toBeLessThan(VERIFICATION_RANK.model_derived);
    for (const status of ['verified', 'source_snapshot', 'model_derived', 'unverified'] as const) {
      expect(VERIFICATION_EXPLANATION[status].length).toBeGreaterThan(20);
    }
    for (const band of ['recent', 'aging', 'stale', 'unknown'] as const) {
      expect(FRESHNESS_EXPLANATION[band].length).toBeGreaterThan(20);
    }
  });

  it('derives freshness from evidence, never from when we fetched', () => {
    // The row was downloaded a minute ago (source_fetched_at would be "now"),
    // but the snapshot's own date is from May — that is the only date that
    // counts, so the row is stale.
    const offer = snapshotOffer({ price_observed_at: '2026-05-12T00:00:00Z' });
    expect(effectiveEvidenceDate(offer)).toBe('2026-05-12T00:00:00Z');
    expect(effectiveFreshness(offer, NOW)).toBe('stale');
    expect(freshnessToQuality(effectiveFreshness(offer, NOW))).toBe('stale');
  });

  it('prefers the verification date over the observation date', () => {
    expect(
      effectiveEvidenceDate({
        price_verified_at: '2026-10-20T00:00:00Z',
        price_observed_at: '2026-01-01T00:00:00Z',
      }),
    ).toBe('2026-10-20T00:00:00Z');
    expect(effectiveEvidenceDate({ price_verified_at: null, price_observed_at: null })).toBeNull();
  });

  it('never upgrades a row the source itself flagged stale', () => {
    const flagged = rawOffer({ source_status_stale: true });
    expect(effectiveFreshness(flagged, NOW)).toBe('stale');
    expect(effectiveFreshness(rawOffer(), NOW)).toBe('recent');
  });

  it('qualityFor is a thin alias over the same policy', () => {
    expect(qualityFor('verified', day(0), NOW)).toBe('recent');
    expect(qualityFor('source_snapshot', '2026-05-12T00:00:00Z', NOW)).toBe('stale');
  });
});

describe('provenance invariants', () => {
  /** A stored offer, as the sync would write it. */
  const stored = (over: Partial<PriceOffer> = {}): PriceOffer => ({
    tld: 'com',
    registrar_id: 'porkbun',
    registrar_name: 'Porkbun',
    currency: 'USD',
    register_usd: 11.08,
    renewal_usd: 11.08,
    transfer_usd: 11.08,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: 33.24,
    source_id: 'porkbun',
    source_name: 'Porkbun pricing API',
    source_url: 'https://porkbun.com/tld/com',
    purchase_url: 'https://porkbun.com/tld/com',
    source_fetched_at: '2026-10-20T12:00:00.000Z',
    price_observed_at: '2026-10-20T00:00:00.000Z',
    price_verified_at: '2026-10-20T00:00:00.000Z',
    verification_status: 'verified',
    last_checked: '2026-10-20T00:00:00.000Z',
    freshness: 'recent',
    quality: 'verified',
    source_status_stale: false,
    ...over,
  });

  it('a fetch timestamp can never stand in for a verification timestamp', () => {
    // Downloaded this second, but the source's own observation is from May and
    // nobody verified it. The row is a stale snapshot, not a fresh quote.
    const justDownloaded = stored({
      source_fetched_at: NOW.toISOString(),
      price_verified_at: null,
      price_observed_at: '2026-05-12T00:00:00Z',
      verification_status: 'source_snapshot',
    });
    expect(effectiveEvidenceDate(justDownloaded)).toBe('2026-05-12T00:00:00Z');
    expect(effectiveFreshness(justDownloaded, NOW)).toBe('stale');
  });

  it('a row with no evidence date at all is unknown, however new the download', () => {
    const noDates = stored({
      source_fetched_at: NOW.toISOString(),
      price_verified_at: null,
      price_observed_at: null,
      verification_status: 'source_snapshot',
    });
    expect(effectiveEvidenceDate(noDates)).toBeNull();
    expect(effectiveFreshness(noDates, NOW)).toBe('unknown');
  });

  it('a row cannot claim verified without a usable price_verified_at', () => {
    // Missing, empty and unparsable dates are all rejected — the adapter has to
    // show it actually read the registrar, not just that it downloaded a file.
    for (const bad of [null, '', 'not-a-date'] as const) {
      const { valid, rejected } = validateOffers(
        [rawOffer({ verification_status: 'verified', price_verified_at: bad })],
        KNOWN_TLDS,
      );
      expect(valid).toHaveLength(0);
      expect(rejected[0].reason).toBe('unverifiable');
    }
    // The same row is fine once the date is real.
    const ok = validateOffers(
      [rawOffer({ verification_status: 'verified', price_verified_at: NOW.toISOString() })],
      KNOWN_TLDS,
    );
    expect(ok.valid).toHaveLength(1);
  });

  it('snapshot rows stay snapshots even when fetched today', () => {
    const fetchedToday = stored({
      source_fetched_at: NOW.toISOString(),
      price_verified_at: null,
      price_observed_at: NOW.toISOString(),
      verification_status: 'source_snapshot',
    });
    // Fresh evidence, still a third-party snapshot: never "recently verified".
    expect(effectiveFreshness(fetchedToday, NOW)).toBe('aging');
    expect(freshnessFor('source_snapshot', NOW.toISOString(), NOW)).not.toBe('recent');
    expect(freshnessFor('model_derived', NOW.toISOString(), NOW)).not.toBe('recent');
  });

  it('unknown evidence dates stay unknown instead of defaulting to fresh', () => {
    expect(freshnessFor('unverified', NOW.toISOString(), NOW)).toBe('unknown');
    expect(freshnessFor('verified', null, NOW)).toBe('unknown');
    expect(freshnessFor('verified', '2026-13-45', NOW)).toBe('unknown');
    // A date further ahead than the skew allowance is untrusted, not "recent".
    expect(freshnessFor('verified', day(5), NOW)).toBe('unknown');
  });

  it('rebuilding can never make a stale price look fresh', () => {
    const old = stored({
      price_verified_at: '2026-05-12T00:00:00Z',
      price_observed_at: '2026-05-12T00:00:00Z',
      last_checked: '2026-05-12T00:00:00Z',
      // A stale claim written into the file must not survive a rebuild.
      freshness: 'recent',
      quality: 'verified',
    });
    const today = refreshOffers([old], NOW)[0];
    expect(today.freshness).toBe('stale');
    expect(today.quality).toBe('stale');

    // And it stays stale as the build clock moves forward.
    const later = refreshOffers([old], new Date('2027-03-01T00:00:00Z'))[0];
    expect(later.freshness).toBe('stale');
  });

  it('rebuilding re-derives the compatibility date from evidence, not from the clock', () => {
    const offer = stored({
      price_verified_at: '2026-10-20T00:00:00Z',
      price_observed_at: '2026-10-01T00:00:00Z',
      last_checked: 'stale-value-written-by-hand',
    });
    const refreshed = refreshOffers([offer], NOW)[0];
    expect(refreshed.last_checked).toBe('2026-10-20T00:00:00Z');
  });
});

describe('promotion expiry', () => {
  it('only expires a promotion with an explicit past end date', () => {
    expect(isPromotionExpired('2026-10-01', NOW)).toBe(true);
    expect(isPromotionExpired('2026-11-01', NOW)).toBe(false);
    expect(isPromotionExpired(null, NOW)).toBe(false);
    expect(isPromotionExpired('soon', NOW)).toBe(false);
  });
});

describe('calcThreeYear', () => {
  it('computes register + 2×renewal rounded to cents', () => {
    expect(calcThreeYear(11.08, 11.08)).toBe(33.24);
    expect(calcThreeYear(1, 20)).toBe(41);
    expect(calcThreeYear(10.46, 10.46)).toBe(31.38);
    expect(calcThreeYear(28.12, 51.8)).toBe(131.72);
  });

  it('returns null when either price is missing — never an estimate', () => {
    expect(calcThreeYear(11.08, null)).toBeNull();
    expect(calcThreeYear(null, 11.08)).toBeNull();
    expect(calcThreeYear(null, null)).toBeNull();
  });

  it('returns null for unusable inputs instead of propagating garbage', () => {
    expect(calcThreeYear(NaN, 10)).toBeNull();
    expect(calcThreeYear(10, Infinity)).toBeNull();
    expect(calcThreeYear(-1, 10)).toBeNull();
  });
});

describe('price parsing', () => {
  it('parses numeric strings with $ and separators', () => {
    expect(normalizePrice('11.08')).toBe(11.08);
    expect(normalizePrice('$11.08')).toBe(11.08);
    expect(normalizePrice('$1,234.56')).toBe(1234.56);
    expect(normalizePrice(10.46)).toBe(10.46);
  });

  it('maps absent values to null', () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
    expect(normalizePrice('')).toBeNull();
    expect(normalizePrice('  ')).toBeNull();
    expect(normalizePrice('n/a')).toBeNull();
    // Several sources use "-1" as an explicit "not published" sentinel.
    expect(normalizePrice('-1')).toBeNull();
  });

  it('throws on invalid, negative or absurd prices', () => {
    expect(() => normalizePrice('free')).toThrow();
    expect(() => normalizePrice(-5)).toThrow();
    expect(() => normalizePrice('-5')).toThrow();
    expect(() => normalizePrice(NaN)).toThrow();
    expect(() => normalizePrice(MAX_SANE_PRICE_USD + 1)).toThrow();
    expect(() => normalizePrice({})).toThrow();
  });

  it('parseMoney tolerates the display formats registrars actually publish', () => {
    expect(parseMoney('$10.88')).toBe(10.88);
    expect(parseMoney('10,88 €')).toBe(10.88);
    expect(parseMoney('1,234.56')).toBe(1234.56);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('—')).toBeNull();
  });

  it('formats prices and dates for display without inventing values', () => {
    expect(formatUsd(11.08)).toBe('$11.08');
    expect(formatUsd(null)).toBe('');
    expect(formatDate('2026-10-20T00:00:00Z')).toBe('Oct 20, 2026');
    expect(formatDate('garbage')).toBeNull();
    expect(formatDate(null)).toBeNull();
  });
});

describe('validateOffers', () => {
  it('accepts well-formed rows', () => {
    const { valid, rejected } = validateOffers([rawOffer()], KNOWN_TLDS);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects TLDs not in the IANA catalog', () => {
    const { valid, rejected } = validateOffers(
      [rawOffer({ tld: 'notadelegatedtld' })],
      KNOWN_TLDS,
    );
    expect(valid).toHaveLength(0);
    expect(rejected[0].reason).toBe('unknown-tld');
  });

  it('rejects rows with invalid prices, including source-reported bad fields', () => {
    const zero = validateOffers(
      [rawOffer({ register_usd: 0, renewal_usd: 0, transfer_usd: 0 })],
      KNOWN_TLDS,
    );
    expect(zero.rejected[0].reason).toBe('invalid-price');

    const poisoned = validateOffers(
      [rawOffer({ invalid_fields: ['registration'] })],
      KNOWN_TLDS,
    );
    expect(poisoned.rejected[0].reason).toBe('invalid-price');
  });

  it('rejects missing currency, invalid URLs and empty price sets', () => {
    expect(
      validateOffers([rawOffer({ currency: 'EUR' })], KNOWN_TLDS).rejected[0].reason,
    ).toBe('missing-currency');
    expect(
      validateOffers([rawOffer({ source_url: 'javascript:alert(1)' })], KNOWN_TLDS).rejected[0].reason,
    ).toBe('invalid-url');
    expect(
      validateOffers(
        [rawOffer({ register_usd: null, renewal_usd: null, transfer_usd: null })],
        KNOWN_TLDS,
      ).rejected[0].reason,
    ).toBe('no-price');
    expect(
      validateOffers([rawOffer({ price_observed_at: 'garbage' })], KNOWN_TLDS).rejected[0].reason,
    ).toBe('invalid-timestamp');
  });

  it('rejects a "verified" claim with no verification date', () => {
    // This is the guard that stops an adapter from "verifying" a row with the
    // time of the download rather than a real first-party read.
    const { rejected } = validateOffers(
      [rawOffer({ verification_status: 'verified', price_verified_at: null })],
      KNOWN_TLDS,
    );
    expect(rejected[0].reason).toBe('unverifiable');
  });

  it('keeps undated snapshot rows and lets them surface as unverified', () => {
    const { valid } = validateOffers(
      [snapshotOffer({ price_observed_at: null, price_verified_at: null })],
      KNOWN_TLDS,
    );
    expect(valid).toHaveLength(1);
    expect(effectiveFreshness({ ...valid[0], source_status_stale: false }, NOW)).toBe('unknown');
  });

  it('deduplicates within a batch and counts rejection reasons', () => {
    const { valid, rejected } = validateOffers(
      [rawOffer(), rawOffer(), rawOffer({ registrar_id: 'cloudflare', registrar_name: 'Cloudflare Registrar' })],
      KNOWN_TLDS,
    );
    expect(valid).toHaveLength(2);
    expect(rejected[0].reason).toBe('duplicate');
    const counts = countRejections(rejected);
    expect(counts.duplicate).toBe(1);
  });
});

describe('mergeBatches', () => {
  const batch = (sourceId: string, priority: number, offers: RawOffer[]) => ({
    sourceId,
    priority,
    offers,
  });

  it('keeps one offer per (registrar, TLD) — freshest evidence wins within a tier', () => {
    const old = snapshotOffer({ register_usd: 11.99 });
    const fresh = snapshotOffer({
      price_observed_at: '2026-10-20T00:00:00.000Z',
      register_usd: 11.08,
    });
    const { merged, superseded } = mergeBatches([
      batch('opendomaindata', 2, [old]),
      batch('bdr', 1, [fresh]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].register_usd).toBe(11.08);
    expect(superseded).toBe(1);
  });

  it('lets a first-party read displace a fresher snapshot', () => {
    // The snapshot was observed TODAY; the first-party read is three weeks old.
    // Age alone would keep the snapshot — tier must win.
    const snapshot = snapshotOffer({
      price_observed_at: day(0),
      register_usd: 9.5,
    });
    const verified = rawOffer({
      price_verified_at: day(-21),
      price_observed_at: day(-21),
      register_usd: 11.08,
    });
    const { merged, upgradedByVerification } = mergeBatches([
      batch('opendomaindata', 0, [snapshot]),
      batch('porkbun', 5, [verified]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source_id).toBe('porkbun');
    expect(merged[0].register_usd).toBe(11.08);
    expect(upgradedByVerification).toBe(1);
  });

  it('breaks same-tier, same-date ties by source priority', () => {
    const stamp = '2026-10-20T00:00:00.000Z';
    const { merged } = mergeBatches([
      batch('opendomaindata', 2, [snapshotOffer({ source_id: 'opendomaindata', price_observed_at: stamp })]),
      batch('bdr', 0, [snapshotOffer({ source_id: 'bdr', price_observed_at: stamp })]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source_id).toBe('bdr');
  });

  it('never collapses distinct registrars for the same TLD', () => {
    const { merged } = mergeBatches([
      batch('porkbun', 0, [rawOffer()]),
      batch('pikkly', 1, [
        rawOffer({
          registrar_id: 'cloudflare',
          registrar_name: 'Cloudflare Registrar',
          source_id: 'pikkly',
        }),
      ]),
    ]);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map(o => o.registrar_id)).size).toBe(2);
  });
});

describe('source parsers', () => {
  it('parses the Porkbun public pricing payload as a first-party read', () => {
    const offers = parsePorkbun(porkbunSuccess, NOW.toISOString());
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(11.08);
    expect(com.renewal_usd).toBe(11.08);
    expect(com.transfer_usd).toBe(11.08);
    expect(com.source_url).toBe('https://porkbun.com/tld/com');
    expect(com.purchase_url).toBe('https://porkbun.com/tld/com');
    expect(com.verification_status).toBe('verified');
    expect(com.price_verified_at).toBe(NOW.toISOString());

    // negative price recorded as an invalid field (row will be rejected)
    const xyz = offers.find(o => o.tld === 'xyz')!;
    expect(xyz.invalid_fields).toContain('registration');

    // documented coupon with a code becomes a promo — codes are never invented
    const app = offers.find(o => o.tld === 'app')!;
    expect(app.promo_code).toBe('SAVE5');
    expect(app.promotional).toBe(true);

    expect(() => parsePorkbun({ status: 'ERROR' }, NOW.toISOString())).toThrow();
  });

  it('parses Pikkly as a snapshot, dating rows by the dump and never verifying them', () => {
    const { offers, skipped } = parsePikkly(pikklyPayload);

    // dump_date wins over daily rebuild time
    const cloudflare = offers.find(o => o.registrar_id === 'cloudflare')!;
    expect(cloudflare.price_observed_at).toBe('2026-08-04');
    expect(cloudflare.price_verified_at).toBeNull();
    expect(cloudflare.verification_status).toBe('source_snapshot');
    expect(cloudflare.register_usd).toBe(10.46);
    expect(cloudflare.transfer_usd).toBeNull();

    // source-flagged stale stays stale
    const hover = offers.find(o => o.registrar_id === 'hover')!;
    expect(hover.source_status_stale).toBe(true);

    // unavailable / unknown provider / non-domain rows are skipped, not mangled
    expect(offers.find(o => o.tld === 'app')).toBeUndefined();
    expect(offers.find(o => o.registrar_id === 'somewhere-else')).toBeUndefined();
    expect(offers.find(o => o.tld === 'org')).toBeUndefined();
    expect(skipped).toBeGreaterThanOrEqual(3);
    expect(offers.find(o => o.tld === 'io')!.source_id).toBe('pikkly');
  });

  it('parses Open Domain Data with registrar id mapping and promo flag', () => {
    const { offers, skipped } = parseOdd(oddPayload);
    const cf = offers.find(o => o.registrar_id === 'cloudflare')!;
    expect(cf.source_url).toBe('https://www.cloudflare.com/products/registrar/');
    expect(cf.verification_status).toBe('source_snapshot');
    expect(cf.price_verified_at).toBeNull();

    const nc = offers.find(o => o.registrar_id === 'namecheap')!;
    expect(nc.promotional).toBe(true);
    expect(nc.promo_code).toBeNull(); // dataset publishes no codes

    expect(offers.find(o => o.registrar_id === 'unknown-registrar')).toBeUndefined();
    expect(skipped).toBe(1);

    expect(() =>
      parseOdd({ dataset: 'tld_pricing', currency: 'EUR', records: [] }),
    ).toThrow();
    expect(() => parseOdd({ dataset: 'wrong', records: [] })).toThrow();
  });

  it('parses Best Domain Registrars and drops placeholder rows', () => {
    const { offers, skipped, statuses, oldestObservedAt } = parseBdr(bdrCsv, bdrVerification);

    // squarespace is a `sample` upstream → dropped, never published.
    expect(offers.find(o => o.registrar_id === 'squarespace')).toBeUndefined();
    // non-USD rows are dropped rather than silently converted.
    expect(offers.find(o => o.registrar_id === 'namecheap')).toBeUndefined();
    // registrars we do not list are not our business.
    expect(offers.find(o => o.registrar_id === 'unknownshop')).toBeUndefined();
    expect(skipped).toBeGreaterThanOrEqual(3);

    const porkbun = offers.find(o => o.registrar_id === 'porkbun')!;
    expect(porkbun.verification_status).toBe('source_snapshot');
    expect(porkbun.price_verified_at).toBeNull();
    expect(porkbun.price_observed_at).toBe('2026-10-21');
    expect(porkbun.register_usd).toBe(11.08);
    expect(porkbun.source_id).toBe('bestdomainregistrars');

    const cloudflare = offers.find(o => o.registrar_id === 'cloudflare')!;
    expect(cloudflare.verification_status).toBe('model_derived');

    expect(statuses.squarespace).toBe('sample');
    expect(oldestObservedAt).toBe('2026-10-21');
  });

  it('keeps registration, renewal and transfer figures in their own columns', () => {
    const csv = [
      'registrar_id,registrar_name,tld,first_year_price,renewal_price,transfer_price,currency,last_checked,source_url',
      'porkbun,Porkbun,com,,12.34,9.87,USD,2026-10-21,https://porkbun.com/tlds',
    ].join('\n');
    const { offers } = parseBdr(csv);
    const row = offers[0];
    // A missing first-year price stays missing: the renewal figure is never
    // promoted into the registration column to make the row look complete.
    expect(row.register_usd).toBeNull();
    expect(row.renewal_usd).toBe(12.34);
    expect(row.transfer_usd).toBe(9.87);
  });

  it('maps upstream verification vocabulary conservatively', () => {
    // BDR's "verified" is the publisher's attestation, not our own read.
    expect(mapVerificationStatus('verified')).toBe('source_snapshot');
    expect(mapVerificationStatus('model_confirmed')).toBe('model_derived');
    expect(mapVerificationStatus('sample')).toBe('unverified');
    expect(mapVerificationStatus('no_pricing_published')).toBe('unverified');
    expect(mapVerificationStatus(undefined)).toBe('unverified');
    // Unknown upstream values are not promoted.
    expect(mapVerificationStatus('something-new')).toBe('source_snapshot');
  });

  it('parses Hover data-props and flags first-year promotions', () => {
    const offers = parseHover(
      hoverPage({
        com: [1, 11.99, 19.99, 19.99],
        'co.uk': [0, 9.99, 9.99, 9.99],
      }),
      NOW.toISOString(),
    );
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(11.99);
    expect(com.renewal_usd).toBe(19.99);
    expect(com.promotional).toBe(true);
    expect(com.promo_restrictions).toContain('First-year');
    expect(com.verification_status).toBe('verified');

    // values[0] is an availability flag, not a price
    const uk = offers.find(o => o.tld === 'co.uk')!;
    expect(uk.register_usd).toBe(9.99);
    expect(uk.promotional).toBe(false);

    expect(() => parseHover('<html></html>', NOW.toISOString())).toThrow();
  });

  it('parses a Gandi price table, taking the current figure of a promo cell', () => {
    const offers = parseGandiPage(
      gandiPage([
        ['.com', '$11.00', '$11.00', '$11.00'],
        ['.co', 'Promo $34.84 $15.99', '$15.99', '$34.84'],
        ['.dev', '$14.00', '$14.00', '$14.00'],
        ['.app', '$14.00', '$14.00', '$14.00'],
        ['.io', '$39.00', '$39.00', '$39.00'],
      ]),
      NOW.toISOString(),
    );
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(11);
    expect(com.promotional).toBe(false);

    const co = offers.find(o => o.tld === 'co')!;
    expect(co.register_usd).toBe(15.99); // current, not the struck regular price
    expect(co.renewal_usd).toBe(34.84);
    expect(co.promotional).toBe(true);
    expect(co.verification_status).toBe('verified');
  });

  it('parses IONOS welcome / special / renewal columns', () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({
      title: `.tld${i}`,
      prices: { welcomeOffer: 1, specialOffer: 5, regularRenewalFee: 20, domainTransfer: 9.5 },
    }));
    entries[0] = {
      title: '.com',
      prices: { welcomeOffer: 1, specialOffer: 9, regularRenewalFee: 20, domainTransfer: 9.5 },
    };
    const offers = parseIonos(ionosPage(entries), NOW.toISOString());
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(1); // welcome offer, not the bundle price
    expect(com.renewal_usd).toBe(20);
    expect(com.transfer_usd).toBe(9.5);
    expect(com.promotional).toBe(true);
    expect(com.promo_restrictions).toContain('welcome');
  });

  it('decodes Nuxt devalue payloads and reads the Dynadot catalogue', () => {
    // A hand-built devalue array: index 0 is the root object, index 1 the data.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      name: `.tld${i}`,
      reg_price: '$10.88',
      renew_price: '$12.88',
      tr_price: '$10.88',
    }));
    rows[0] = {
      name: '.com',
      reg_price: '$10.88',
      renew_price: '$12.88',
      tr_price: '$10.88',
      original_reg_price: '$12.99',
    } as (typeof rows)[number];
    const payload = [{ data: 1 }, rows];
    const decoded = decodeDevalue(payload) as { data: unknown[] };
    expect(Array.isArray(decoded.data)).toBe(true);
    expect(findTldCatalogue(decoded)).toHaveLength(51);

    const html = `<html><body><script id="__NUXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
    const offers = parseDynadot(html, NOW.toISOString());
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(10.88);
    expect(com.renewal_usd).toBe(12.88);
    expect(com.promotional).toBe(true); // struck original price is higher
    expect(com.verification_status).toBe('verified');
    expect(com.price_verified_at).toBe(NOW.toISOString());
  });
});

describe('cheapestPoint & sorting', () => {
  const offer = (over: Partial<PriceOffer>): PriceOffer => ({
    tld: 'com',
    registrar_id: 'x',
    registrar_name: 'X',
    currency: 'USD',
    register_usd: null,
    renewal_usd: null,
    transfer_usd: null,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: null,
    source_id: 'pikkly',
    source_name: 'Pikkly open data',
    source_url: 'https://example.com',
    purchase_url: 'https://example.com',
    source_fetched_at: '2026-10-20T00:00:00.000Z',
    price_observed_at: '2026-10-20T00:00:00.000Z',
    price_verified_at: null,
    verification_status: 'source_snapshot',
    last_checked: '2026-10-20T00:00:00.000Z',
    freshness: 'aging',
    quality: 'verified',
    source_status_stale: false,
    ...over,
  });

  it('picks the minimum non-null price; all-null yields null', () => {
    const offers = [
      offer({ registrar_id: 'a', registrar_name: 'A', register_usd: 11.99 }),
      offer({ registrar_id: 'b', registrar_name: 'B', register_usd: 10.46 }),
      offer({ registrar_id: 'c', registrar_name: 'C', register_usd: null }),
    ];
    const point = cheapestPoint(offers, 'register_usd', NOW);
    expect(point?.usd).toBe(10.46);
    expect(point?.registrar_id).toBe('b');

    expect(cheapestPoint(offers, 'transfer_usd', NOW)).toBeNull();
  });

  it('carries provenance onto the point so the UI can label it', () => {
    const point = cheapestPoint(
      [
        offer({
          registrar_id: 'a',
          registrar_name: 'A',
          register_usd: 10,
          verification_status: 'source_snapshot',
          price_observed_at: '2026-05-12T00:00:00Z',
        }),
      ],
      'register_usd',
      NOW,
    )!;
    expect(point.verification_status).toBe('source_snapshot');
    expect(point.freshness).toBe('stale');
    expect(point.last_checked).toBe('2026-05-12T00:00:00Z');
  });

  it('prefers the better-verified quote when prices tie', () => {
    const offers = [
      offer({ registrar_id: 'a', registrar_name: 'A', register_usd: 10 }),
      offer({
        registrar_id: 'b',
        registrar_name: 'B',
        register_usd: 10,
        verification_status: 'verified',
        price_verified_at: '2026-10-20T00:00:00Z',
      }),
    ];
    expect(cheapestPoint(offers, 'register_usd', NOW)?.registrar_id).toBe('b');
  });

  it('sorts by each key with missing prices always last', () => {
    const point = (usd: number, id: string): PricePoint => ({
      usd,
      registrar_id: id,
      registrar_name: id.toUpperCase(),
      verification_status: 'verified',
      freshness: 'recent',
      last_checked: '2026-10-20T00:00:00Z',
      promotional: false,
      promotion_expired: false,
      quality: 'verified',
      cheaper_stale: null,
      no_current_evidence: false,
    });
    const rows: ComparisonRow[] = [
      {
        suffix: '.b', tld: 'b', type: 'generic', offers: 1, verified_offers: 1, stale_offers: 0,
        register: null, renewal: point(5, 'x'),
        transfer: null, three_year: null, visit_url: '', visit_registrar: '',
        registrars: ['X'], latest_checked: '2026-10-20T00:00:00Z', only_snapshots: false,
      },
      {
        suffix: '.a', tld: 'a', type: 'generic', offers: 2, verified_offers: 2, stale_offers: 0,
        register: point(20, 'y'), renewal: null, transfer: null,
        three_year: point(60, 'y'),
        visit_url: '', visit_registrar: '', registrars: ['Y'],
        latest_checked: '2026-10-20T00:00:00Z', only_snapshots: false,
      },
      {
        suffix: '.c', tld: 'c', type: 'generic', offers: 1, verified_offers: 1, stale_offers: 0,
        register: point(9, 'z'), renewal: null, transfer: null, three_year: null,
        visit_url: '', visit_registrar: '', registrars: ['Z'],
        latest_checked: '2026-10-20T00:00:00Z', only_snapshots: true,
      },
    ];

    expect(sortComparisonRows(rows, 'register-asc').map(r => r.tld)).toEqual(['c', 'a', 'b']);
    expect(sortComparisonRows(rows, 'three-year-asc').map(r => r.tld)).toEqual(['a', 'b', 'c']);
    expect(sortComparisonRows(rows, 'suffix-asc').map(r => r.tld)).toEqual(['a', 'b', 'c']);
  });
});

describe('schema migration', () => {
  const v1 = {
    schema_version: 1,
    generated_at: '2026-10-20T11:30:38.660Z',
    currency: 'USD',
    sources: [
      { id: 'porkbun', name: 'Porkbun', url: 'https://porkbun.com', rows: 1 },
      { id: 'pikkly', name: 'Pikkly', url: 'https://pikkly.dev', rows: 1 },
    ],
    offers: [
      {
        tld: 'com', registrar_id: 'porkbun', registrar_name: 'Porkbun', currency: 'USD',
        register_usd: 11.08, renewal_usd: 11.08, transfer_usd: 11.08,
        source_id: 'porkbun', source_url: 'https://porkbun.com/tld/com',
        purchase_url: 'https://porkbun.com/tld/com',
        last_checked: '2026-10-20T09:06:25.657Z', quality: 'verified',
      },
      {
        tld: 'com', registrar_id: 'cloudflare', registrar_name: 'Cloudflare Registrar',
        currency: 'USD', register_usd: 10.46, renewal_usd: 10.46, transfer_usd: null,
        source_id: 'pikkly', source_url: 'https://github.com/example/dump',
        purchase_url: null, last_checked: '2026-08-04', quality: 'verified',
      },
    ],
  };

  it('turns v1 timestamps into evidence, not into a fresh verification', () => {
    const { dataset, changed } = migrateDataset(v1);
    expect(changed).toBe(true);
    expect(dataset.schema_version).toBe(2);

    const porkbun = dataset.offers.find(o => o.registrar_id === 'porkbun')!;
    expect(porkbun.verification_status).toBe('verified');
    expect(porkbun.price_verified_at).toBe('2026-10-20T09:06:25.657Z');

    // A third-party row can never be promoted by a migration.
    const cloudflare = dataset.offers.find(o => o.registrar_id === 'cloudflare')!;
    expect(cloudflare.verification_status).toBe('source_snapshot');
    expect(cloudflare.price_verified_at).toBeNull();
    expect(cloudflare.price_observed_at).toBe('2026-08-04');

    // The fetch time is the dataset's own generation time, not "now".
    expect(porkbun.source_fetched_at).toBe('2026-10-20T11:30:38.660Z');
  });

  it('is idempotent on an already-v2 dataset', () => {
    const first = migrateDataset(v1);
    const second = migrateDataset(first.dataset);
    expect(second.changed).toBe(false);
    expect(second.dataset.offers).toHaveLength(first.dataset.offers.length);
  });
});

describe('trust policy', () => {
  const offer = (over: Partial<PriceOffer>): PriceOffer => ({
    tld: 'com',
    registrar_id: 'porkbun',
    registrar_name: 'Porkbun',
    currency: 'USD',
    register_usd: 11.08,
    renewal_usd: 11.08,
    transfer_usd: 11.08,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: 33.24,
    source_id: 'porkbun',
    source_name: 'Porkbun pricing API',
    source_url: 'https://porkbun.com/tld/com',
    purchase_url: 'https://porkbun.com/tld/com',
    source_fetched_at: '2026-10-20T12:00:00.000Z',
    price_observed_at: '2026-10-20T00:00:00.000Z',
    price_verified_at: '2026-10-20T00:00:00.000Z',
    verification_status: 'verified',
    last_checked: '2026-10-20T00:00:00.000Z',
    freshness: 'recent',
    quality: 'verified',
    source_status_stale: false,
    ...over,
  });

  it('keeps placeholder pricing but strips every trust signal', () => {
    const { offers, quarantined } = applyTrustPolicy([
      offer({}),
      offer({
        registrar_id: 'squarespace',
        registrar_name: 'Squarespace Domains',
        source_id: 'opendomaindata',
        verification_status: 'source_snapshot',
        price_verified_at: null,
        price_observed_at: '2026-05-12T00:00:00Z',
        freshness: 'stale',
        quality: 'stale',
      }),
    ]);

    expect(quarantined).toEqual(['squarespace']);
    const porkbun = offers.find(o => o.registrar_id === 'porkbun')!;
    expect(porkbun.verification_status).toBe('verified');

    const squarespace = offers.find(o => o.registrar_id === 'squarespace')!;
    expect(squarespace.verification_status).toBe('unverified');
    expect(squarespace.freshness).toBe('unknown');
    expect(squarespace.quality).toBe('stale');
    expect(squarespace.price_verified_at).toBeNull();
    // The figure is still there — we are labelling it, not hiding it.
    expect(squarespace.register_usd).toBe(11.08);
  });

  it('never lets a quarantined row earn a cheapest badge', () => {
    const { offers } = applyTrustPolicy([
      offer({ registrar_id: 'squarespace', registrar_name: 'Squarespace Domains', register_usd: 1 }),
      offer({ registrar_id: 'porkbun', registrar_name: 'Porkbun', register_usd: 11.08 }),
    ]);
    const point = cheapestPoint(offers, 'register_usd', NOW)!;
    // The quarantined $1 quote has no usable evidence date, so it must not be
    // presented as the current cheapest price even though it is cheaper.
    expect(point.usd).toBe(11.08);
    expect(point.registrar_id).toBe('porkbun');
    // The figure is disclosed rather than deleted: it rides along as a cheaper
    // quote whose evidence is unknown.
    expect(point.cheaper_stale?.usd).toBe(1);
    expect(point.cheaper_stale?.registrar_id).toBe('squarespace');
    expect(point.cheaper_stale?.freshness).toBe('unknown');
    expect(quarantineReason('squarespace')).toContain('placeholder');
    expect(quarantineReason('porkbun')).toBeNull();
  });
});

describe('current-evidence ranking', () => {
  // The clock under which the reported .com row was showing stale figures.
  const TODAY = new Date('2026-10-23T10:46:27.474Z');

  const offer = (over: Partial<PriceOffer>): PriceOffer => ({
    tld: 'com',
    registrar_id: 'x',
    registrar_name: 'X',
    currency: 'USD',
    register_usd: null,
    renewal_usd: null,
    transfer_usd: null,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: null,
    source_id: 'pikkly',
    source_name: 'Pikkly open data',
    source_url: 'https://example.com',
    purchase_url: 'https://example.com',
    source_fetched_at: '2026-10-23T10:46:27.474Z',
    price_observed_at: '2026-10-23T10:46:27.474Z',
    price_verified_at: null,
    verification_status: 'source_snapshot',
    last_checked: '2026-10-23T10:46:27.474Z',
    freshness: 'recent',
    quality: 'verified',
    source_status_stale: false,
    ...over,
  });

  const verified = (over: Partial<PriceOffer>): PriceOffer =>
    offer({
      verification_status: 'verified',
      price_verified_at: '2026-10-23T10:46:27.474Z',
      price_observed_at: '2026-10-23T10:46:27.474Z',
      source_id: 'porkbun',
      source_name: 'Porkbun API',
      ...over,
    });

  const snapshot = (observedAt: string, over: Partial<PriceOffer>): PriceOffer =>
    offer({
      verification_status: 'source_snapshot',
      price_verified_at: null,
      price_observed_at: observedAt,
      last_checked: observedAt,
      ...over,
    });

  it('counts only recent and aging evidence as current', () => {
    expect(isCurrentEvidence('recent')).toBe(true);
    expect(isCurrentEvidence('aging')).toBe(true);
    expect(isCurrentEvidence('stale')).toBe(false);
    expect(isCurrentEvidence('unknown')).toBe(false);
  });

  it('does not let a cheaper stale snapshot outrank a current first-party read', () => {
    const offers = [
      snapshot('2026-09-02', {
        registrar_id: 'spaceship',
        registrar_name: 'Spaceship',
        renewal_usd: 10.18,
      }),
      verified({ registrar_id: 'dynadot', registrar_name: 'Dynadot', renewal_usd: 10.88 }),
    ];
    const point = cheapestPoint(offers, 'renewal_usd', TODAY)!;
    expect(point.registrar_id).toBe('dynadot');
    expect(point.usd).toBe(10.88);
    expect(point.freshness).toBe('recent');
    expect(point.no_current_evidence).toBe(false);
    // The older, cheaper figure is disclosed rather than dropped.
    expect(point.cheaper_stale).toEqual({
      usd: 10.18,
      registrar_id: 'spaceship',
      registrar_name: 'Spaceship',
      verification_status: 'source_snapshot',
      freshness: 'stale',
      last_checked: '2026-09-02',
    });
  });

  it('still shows a quote when nothing current exists, labelled by its own date', () => {
    const offers = [
      snapshot('2026-08-04', {
        registrar_id: 'cloudflare',
        registrar_name: 'Cloudflare Registrar',
        register_usd: 10.46,
      }),
      snapshot('2026-08-19', {
        registrar_id: 'namecheap',
        registrar_name: 'Namecheap',
        register_usd: 11.28,
      }),
    ];
    const point = cheapestPoint(offers, 'register_usd', TODAY)!;
    expect(point.registrar_id).toBe('cloudflare');
    expect(point.freshness).toBe('stale');
    expect(point.cheaper_stale).toBeNull();
    // …but it must be flagged as a fallback, so the UI can say that current
    // data is insufficient instead of presenting it as today's best price.
    expect(point.no_current_evidence).toBe(true);
  });

  it('reports no stale alternative when the winner is already the cheapest', () => {
    const offers = [
      verified({ registrar_id: 'porkbun', registrar_name: 'Porkbun', register_usd: 9 }),
      verified({ registrar_id: 'dynadot', registrar_name: 'Dynadot', register_usd: 11 }),
      snapshot('2026-09-02', {
        registrar_id: 'spaceship',
        registrar_name: 'Spaceship',
        register_usd: 12,
      }),
    ];
    const point = cheapestPoint(offers, 'register_usd', TODAY)!;
    expect(point.usd).toBe(9);
    expect(point.cheaper_stale).toBeNull();
  });

  it('never invents a figure for a field no source publishes', () => {
    const offers = [
      verified({
        registrar_id: 'porkbun',
        registrar_name: 'Porkbun',
        register_usd: 11.08,
        renewal_usd: 11.08,
      }),
      snapshot('2026-09-02', {
        registrar_id: 'spaceship',
        registrar_name: 'Spaceship',
        register_usd: 9.08,
      }),
    ];
    // A registration price is not a transfer price; absence stays absent.
    expect(cheapestPoint(offers, 'transfer_usd', TODAY)).toBeNull();
  });

  it('ranks the reported .com row by current evidence, not by the oldest snapshot', () => {
    // Shaped from the live dataset as it was reported.
    const offers = [
      verified({
        registrar_id: 'ionos',
        registrar_name: 'IONOS',
        register_usd: 1,
        renewal_usd: 20,
        transfer_usd: 9.5,
        promotional: true,
      }),
      snapshot('2026-09-02', {
        registrar_id: 'spaceship',
        registrar_name: 'Spaceship',
        register_usd: 9.08,
        renewal_usd: 10.18,
        transfer_usd: 9.48,
      }),
      snapshot('2026-08-04', {
        registrar_id: 'cloudflare',
        registrar_name: 'Cloudflare Registrar',
        register_usd: 10.46,
        renewal_usd: 10.46,
      }),
      verified({
        registrar_id: 'dynadot',
        registrar_name: 'Dynadot',
        register_usd: 10.88,
        renewal_usd: 10.88,
        transfer_usd: 10.88,
      }),
      verified({
        registrar_id: 'gandi',
        registrar_name: 'Gandi',
        register_usd: 11,
        renewal_usd: 38.38,
        transfer_usd: 11,
      }),
      offer({
        registrar_id: 'squarespace',
        registrar_name: 'Squarespace Domains',
        register_usd: 11,
        renewal_usd: 20,
        transfer_usd: 11,
        verification_status: 'unverified',
        price_observed_at: '2026-05-12',
        last_checked: '2026-05-12',
      }),
      verified({
        registrar_id: 'porkbun',
        registrar_name: 'Porkbun',
        register_usd: 11.08,
        renewal_usd: 11.08,
        transfer_usd: 11.08,
      }),
      snapshot('2026-08-19', {
        registrar_id: 'namecheap',
        registrar_name: 'Namecheap',
        register_usd: 11.28,
        renewal_usd: 18.48,
        transfer_usd: 11.48,
      }),
      verified({
        registrar_id: 'hover',
        registrar_name: 'Hover',
        register_usd: 18.99,
        renewal_usd: 18.99,
        transfer_usd: 18.99,
      }),
      snapshot('2026-10-21', {
        registrar_id: 'godaddy',
        registrar_name: 'GoDaddy',
        register_usd: 22.99,
        renewal_usd: 22.99,
      }),
    ];

    const register = cheapestPoint(offers, 'register_usd', TODAY)!;
    expect(register.usd).toBe(1);
    expect(register.registrar_id).toBe('ionos');
    // Nothing cheaper exists, so there is nothing to disclose.
    expect(register.cheaper_stale).toBeNull();

    const renewal = cheapestPoint(offers, 'renewal_usd', TODAY)!;
    // Spaceship's $10.18 snapshot is 51 days old: shown, but not ranked.
    expect(renewal.usd).toBe(10.88);
    expect(renewal.registrar_id).toBe('dynadot');
    expect(renewal.freshness).toBe('recent');
    expect(renewal.cheaper_stale?.usd).toBe(10.18);
    expect(renewal.cheaper_stale?.registrar_id).toBe('spaceship');
    expect(renewal.cheaper_stale?.freshness).toBe('stale');

    const transfer = cheapestPoint(offers, 'transfer_usd', TODAY)!;
    // IONOS's verified $9.50 wins; the $9.48 snapshot is disclosed beneath it.
    expect(transfer.registrar_id).toBe('ionos');
    expect(transfer.cheaper_stale?.usd).toBe(9.48);
    expect(transfer.cheaper_stale?.registrar_id).toBe('spaceship');
  });
});

describe('sync report', () => {
  const dataset = (offers: PriceOffer[]): PriceDataset => ({
    schema_version: 2,
    generated_at: '2026-10-20T12:00:00.000Z',
    currency: 'USD',
    sources: [],
    offers,
  });

  /** A fully-populated source report row; individual fields override freely. */
  const sourceReport = (over: Partial<SourceReport> & { source_id: string }): SourceReport => ({
    source_name: over.source_id,
    status: 'ok',
    verification_status: 'verified',
    rows: 1,
    attempted: 1,
    published_rows: 1,
    rejected: 0,
    rejections: {},
    fetched_at: NOW.toISOString(),
    last_attempt_at: NOW.toISOString(),
    last_successful_fetch_at: NOW.toISOString(),
    price_evidence_at: NOW.toISOString(),
    previous_price_evidence_at: null,
    evidence_advanced: true,
    evidence_state: 'current',
    retained_from_previous: 0,
    oldest_observed_at: NOW.toISOString(),
    error: null,
    ...over,
  });

  const offer = (over: Partial<PriceOffer>): PriceOffer => ({
    tld: 'com',
    registrar_id: 'porkbun',
    registrar_name: 'Porkbun',
    currency: 'USD',
    register_usd: 11.08,
    renewal_usd: 11.08,
    transfer_usd: 11.08,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: 33.24,
    source_id: 'porkbun',
    source_name: 'Porkbun pricing API',
    source_url: 'https://porkbun.com/tld/com',
    purchase_url: 'https://porkbun.com/tld/com',
    source_fetched_at: '2026-10-20T12:00:00.000Z',
    price_observed_at: '2026-10-20T00:00:00.000Z',
    price_verified_at: '2026-10-20T00:00:00.000Z',
    verification_status: 'verified',
    last_checked: '2026-10-20T00:00:00.000Z',
    freshness: 'recent',
    quality: 'verified',
    source_status_stale: false,
    ...over,
  });

  it('counts what we actually stand behind, by tier and by age', () => {
    const report = buildReport({
      runAt: NOW.toISOString(),
      dataset: dataset([
        offer({}),
        offer({
          tld: 'org',
          registrar_id: 'godaddy',
          verification_status: 'source_snapshot',
          price_verified_at: null,
          price_observed_at: '2026-05-12T00:00:00Z',
          freshness: 'stale',
        }),
        offer({
          tld: 'dev',
          registrar_id: 'cloudflare',
          verification_status: 'model_derived',
          price_verified_at: null,
          price_observed_at: null,
          freshness: 'unknown',
        }),
      ]),
      sources: [
        sourceReport({
          source_id: 'porkbun',
          source_name: 'Porkbun',
          oldest_observed_at: '2026-10-20T00:00:00.000Z',
        }),
        sourceReport({
          source_id: 'pikkly',
          source_name: 'Pikkly',
          status: 'kept-previous',
          verification_status: 'source_snapshot',
          rows: 2,
          attempted: 6,
          published_rows: 2,
          rejected: 4,
          rejections: { 'unknown-tld': 4 },
          fetched_at: null,
          last_successful_fetch_at: null,
          price_evidence_at: '2026-05-12T00:00:00Z',
          evidence_advanced: false,
          evidence_state: 'frozen',
          retained_from_previous: 2,
          oldest_observed_at: '2026-05-12T00:00:00Z',
          error: 'HTTP 503',
        }),
      ],
      changes: [],
      now: NOW,
    });

    expect(report.totals.offers).toBe(3);
    expect(report.totals.tlids).toBe(3);
    expect(report.totals.by_verification.verified).toBe(1);
    expect(report.totals.by_verification.source_snapshot).toBe(1);
    expect(report.totals.by_verification.model_derived).toBe(1);
    expect(report.totals.by_freshness.stale).toBe(1);
    expect(report.totals.by_freshness.unknown).toBe(1);
    expect(report.totals.oldest_observed_at).toBe('2026-05-12T00:00:00Z');
    expect(report.degraded_sources).toEqual(['pikkly (kept-previous)']);

    const md = renderMarkdown(report);
    expect(md).toContain('Registrar price sync report');
    expect(md).toContain('pikkly');
    expect(md).toContain('Sources needing attention');
  });

  it('surfaces only material price moves', () => {
    const before = dataset([offer({ register_usd: 10 })]);
    const after = dataset([
      offer({ register_usd: 12 }), // +20% — exactly at the threshold
      offer({ tld: 'org', registrar_id: 'gandi', register_usd: 10.5 }), // new offer
    ]);
    const changes = diffPrices(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].change_pct).toBe(20);
    expect(changes[0].field).toBe('register_usd');

    // Nothing to compare against on the first run.
    expect(diffPrices(null, after)).toEqual([]);
  });

  describe('per-registrar evidence', () => {
    it('bands each registrar by its own evidence, not by the run date', () => {
      const reports = buildRegistrarReports(
        [
          offer({ registrar_id: 'porkbun', freshness: 'recent', price_verified_at: NOW.toISOString() }),
          offer({
            registrar_id: 'cloudflare',
            tld: 'net',
            freshness: 'stale',
            verification_status: 'source_snapshot',
            price_verified_at: null,
            price_observed_at: '2026-08-04T00:00:00.000Z',
          }),
        ],
        NOW,
      );
      const byId = new Map(reports.map(r => [r.registrar_id, r]));
      expect(byId.get('porkbun')!.evidence_state).toBe('current');
      expect(byId.get('porkbun')!.current).toBe(1);
      // Cloudflare: downloaded today, evidenced 81 days ago.
      expect(byId.get('cloudflare')!.evidence_state).toBe('frozen');
      expect(byId.get('cloudflare')!.stale).toBe(1);
      expect(byId.get('cloudflare')!.newest_evidence_at).toBe('2026-08-04T00:00:00.000Z');
    });

    it('reports a registrar with only undated rows as having no data', () => {
      const reports = buildRegistrarReports(
        [
          offer({
            registrar_id: 'squarespace',
            verification_status: 'unverified',
            freshness: 'unknown',
            price_verified_at: null,
            price_observed_at: null,
          }),
        ],
        NOW,
      );
      expect(reports[0].unknown).toBe(1);
      expect(reports[0].evidence_state).toBe('none');
    });
  });

  it('publishes a coverage verdict that names frozen sources', () => {
    const report = buildReport({
      runAt: NOW.toISOString(),
      dataset: dataset([
        offer({}),
        offer({
          tld: 'net',
          registrar_id: 'spaceship',
          registrar_name: 'Spaceship',
          source_id: 'pikkly',
          verification_status: 'source_snapshot',
          price_verified_at: null,
          price_observed_at: '2026-09-02T00:00:00.000Z',
          freshness: 'stale',
        }),
      ]),
      sources: [
        sourceReport({ source_id: 'porkbun' }),
        sourceReport({
          source_id: 'pikkly',
          verification_status: 'source_snapshot',
          price_evidence_at: '2026-09-02T00:00:00.000Z',
          evidence_state: 'frozen',
          evidence_advanced: false,
        }),
      ],
      changes: [],
      now: NOW,
    });

    expect(report.coverage.complete).toBe(false);
    expect(report.frozen_sources).toEqual(['pikkly']);
    // The registrar view is the one a reader acts on.
    expect(report.coverage.registrars_without_current_evidence).toEqual(['spaceship']);
    expect(report.registrars_detail.reduce((sum, r) => sum + r.offers, 0)).toBe(2);
    expect(report.totals.previous_offers).toBeNull();
    expect(report.totals.offer_count_change_pct).toBeNull();

    const md = renderMarkdown(report);
    expect(md).toContain('## Registrars');
    expect(md).toContain('Registrars with no current quote');
    expect(md).toContain('Sources that downloaded but delivered no new evidence');
    expect(md).toContain('**Spaceship**');
  });

  it('measures the offer count against the previous dataset', () => {
    const previous = dataset([offer({}), offer({ tld: 'net' }), offer({ tld: 'org' }), offer({ tld: 'dev' })]);
    const report = buildReport({
      runAt: NOW.toISOString(),
      dataset: dataset([offer({}), offer({ tld: 'net' }), offer({ tld: 'org' })]),
      sources: [sourceReport({ source_id: 'porkbun', rows: 3, published_rows: 3, attempted: 3 })],
      changes: [],
      now: NOW,
      previous,
    });
    expect(report.totals.previous_offers).toBe(4);
    expect(report.totals.offer_count_change_pct).toBe(-25);
  });
});

describe('outbound registrar links (monetisation policy)', () => {
  it('uses verified per-TLD pages only where configured, else the homepage', () => {
    expect(purchaseUrlFor('porkbun', 'com')).toBe('https://porkbun.com/tld/com');
    expect(purchaseUrlFor('cloudflare', 'com')).toBe('https://www.cloudflare.com/products/registrar/');
    expect(purchaseUrlFor('unknown-registrar', 'com')).toBe('');
  });

  it('has no affiliate relationships configured — links are ordinary', () => {
    for (const id of Object.keys(registrars)) {
      expect(hasAffiliate(id)).toBe(false);
      expect(outboundRel(id)).toBe('noopener');
    }
    expect(registrarName('porkbun')).toBe('Porkbun');
    expect(registrarName('nobody')).toBe('nobody');
  });
});

describe('committed dataset integration', () => {
  it('normalises whatever is on disk into a schema-v2 dataset', async () => {
    const dataset = await readPriceDataset();
    expect(dataset).not.toBeNull();
    expect(dataset!.schema_version).toBe(2);
    expect(dataset!.offers.length).toBeGreaterThan(500);
    expect(dataset!.currency).toBe('USD');

    for (const o of dataset!.offers) {
      expect(['verified', 'source_snapshot', 'model_derived', 'unverified']).toContain(
        o.verification_status,
      );
      // A snapshot row can never carry a verification date.
      if (o.verification_status !== 'verified') expect(o.price_verified_at).toBeNull();
      if (o.three_year_usd !== null && o.register_usd !== null && o.renewal_usd !== null) {
        expect(o.three_year_usd).toBeCloseTo(o.register_usd + 2 * o.renewal_usd, 2);
      }
      if (o.purchase_url !== null) expect(o.purchase_url).toMatch(/^https:\/\//);
      expect(o.source_url).toMatch(/^https:\/\//);
    }
    const unknown = dataset!.offers.filter(o => !registrars[o.registrar_id]);
    expect(unknown).toHaveLength(0);
  });

  it('never promotes third-party rows to first-party verified', async () => {
    // Whether the file on disk is v1 (no tier declared) or v2, a row carried by
    // a third-party dataset must never be labelled `verified`. First-party
    // reads are the only rows allowed to make that claim.
    const dataset = await readPriceDataset();
    const porkbun = dataset!.offers.filter(o => o.source_id === 'porkbun');
    expect(porkbun.length).toBeGreaterThan(100);
    expect(porkbun.every(o => o.verification_status === 'verified')).toBe(true);

    const thirdParty = dataset!.offers.filter(
      o => o.source_id === 'pikkly' || o.source_id === 'opendomaindata' || o.source_id === 'bestdomainregistrars',
    );
    expect(thirdParty.length).toBeGreaterThan(100);
    expect(thirdParty.some(o => o.verification_status === 'verified')).toBe(false);
    // Quarantined registrars (placeholder pricing) are `unverified`; the rest
    // are dated snapshots.
    expect(
      thirdParty.every(
        o => o.verification_status === 'source_snapshot' || o.verification_status === 'unverified',
      ),
    ).toBe(true);
  });

  it('serves .com offers across multiple registrars with null-safe prices', async () => {
    const offers = await getOffersForTld('com');
    expect(offers.length).toBeGreaterThanOrEqual(5);
    expect(offers.every(o => o.tld === 'com')).toBe(true);
    expect(new Set(offers.map(o => o.registrar_id)).size).toBe(offers.length);
    expect(offers.some(o => o.renewal_usd !== null)).toBe(true);
    // Freshness is recomputed at read time from evidence, never from the clock.
    for (const o of offers) {
      expect(['recent', 'aging', 'stale', 'unknown']).toContain(o.freshness);
    }
  });

  it('publishes totals that agree with the sync report', async () => {
    // The report is what the run summary and the artefact claim. It must
    // describe the dataset that ships next to it, or the provenance story the
    // site tells is wrong. Read the file as written (the build-time store
    // recomputes freshness, so the stored bands are only visible raw) — this is
    // the same comparison the workflow performs before publishing.
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), 'data/prices.json'), 'utf-8'),
    ) as { generated_at: string; offers: Array<{ verification_status: string; freshness: string }> };
    const report = JSON.parse(
      readFileSync(resolve(process.cwd(), 'data/price-sync-report.json'), 'utf-8'),
    ) as {
      dataset_generated_at: string;
      totals: {
        offers: number;
        by_verification: Record<string, number>;
        by_freshness: Record<string, number>;
      };
    };
    const stats = await getPriceStats();

    expect(report.dataset_generated_at).toBe(raw.generated_at);
    expect(report.totals.offers).toBe(raw.offers.length);
    expect(stats!.offers).toBe(raw.offers.length);

    const count = (key: 'verification_status' | 'freshness', value: string): number =>
      raw.offers.filter(o => o[key] === value).length;

    for (const tier of ['verified', 'source_snapshot', 'model_derived', 'unverified'] as const) {
      expect(report.totals.by_verification[tier]).toBe(count('verification_status', tier));
    }
    for (const band of ['recent', 'aging', 'stale', 'unknown'] as const) {
      expect(report.totals.by_freshness[band]).toBe(count('freshness', band));
    }

    // The public JSON endpoint exposes the same tier counts as the report.
    expect(stats!.verifiedOffers).toBe(report.totals.by_verification.verified);
    expect(stats!.snapshotOffers).toBe(report.totals.by_verification.source_snapshot);
  });

  it('builds comparison rows where every priced TLD links onward honestly', async () => {
    const rows = await buildComparisonRows();
    expect(rows.length).toBeGreaterThan(300);

    const com = rows.find(r => r.tld === 'com');
    expect(com).toBeDefined();
    expect(com!.register).not.toBeNull();
    expect(com!.register!.usd).toBeGreaterThan(0);
    expect(com!.offers).toBeGreaterThanOrEqual(5);
    expect(com!.visit_url).toMatch(/^https:\/\//);
    expect(com!.suffix).toBe('.com');

    for (const row of rows) {
      expect(row.offers).toBeGreaterThanOrEqual(1);
      expect(row.verified_offers).toBeLessThanOrEqual(row.offers);
      expect(row.stale_offers).toBeLessThanOrEqual(row.offers);
      if (row.three_year && row.register) {
        expect(row.three_year.usd).toBeGreaterThanOrEqual(row.register.usd);
      }
      // `only_snapshots` must agree with the offers behind the row.
      if (row.only_snapshots) expect(row.verified_offers).toBe(0);
    }
  });
});

describe('build-time trust normalisation', () => {
  // The dataset on disk is read and normalised on every build. That pass is a
  // second line of defence: whatever a file claims, it must not be able to
  // promote a snapshot to a first-party verification.
  const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    tld: 'com',
    registrar_id: 'namecheap',
    registrar_name: 'Namecheap',
    currency: 'USD',
    register_usd: 11.28,
    renewal_usd: 18.48,
    transfer_usd: 11.48,
    promotional: false,
    promo_code: null,
    promo_restrictions: null,
    promotion_expires_at: null,
    three_year_usd: 48.24,
    source_id: 'opendomaindata',
    source_name: 'Open Domain Data',
    source_url: 'https://www.opendomaindata.org/datasets/tld-pricing',
    purchase_url: null,
    source_fetched_at: '2026-10-24T09:06:32.894Z',
    price_observed_at: '2026-08-19T00:00:00.000Z',
    price_verified_at: null,
    verification_status: 'source_snapshot',
    last_checked: '2026-08-19T00:00:00.000Z',
    freshness: 'stale',
    quality: 'stale',
    source_status_stale: false,
    ...over,
  });

  it('downgrades a third-party row that claims to be verified', () => {
    const offer = normalizeOffer(
      row({ verification_status: 'verified', price_verified_at: null }),
    )!;
    expect(offer.verification_status).toBe('source_snapshot');
    expect(offer.price_verified_at).toBeNull();
    // The evidence date is still the source's own observation date.
    expect(offer.last_checked).toBe('2026-08-19T00:00:00.000Z');
  });

  it('does not let a first-party row borrow its observation date as a verification', () => {
    const offer = normalizeOffer(
      row({
        source_id: 'porkbun',
        source_name: 'Porkbun API',
        verification_status: 'verified',
        price_verified_at: null,
        price_observed_at: '2026-10-24T09:00:00.000Z',
        last_checked: '2026-10-24T09:00:00.000Z',
      }),
    )!;
    expect(offer.verification_status).toBe('source_snapshot');
    expect(offer.price_verified_at).toBeNull();
  });

  it('keeps a first-party row that carries a real verification date', () => {
    const offer = normalizeOffer(
      row({
        source_id: 'porkbun',
        source_name: 'Porkbun API',
        verification_status: 'verified',
        price_verified_at: '2026-10-24T09:00:00.000Z',
        price_observed_at: '2026-10-24T09:00:00.000Z',
        last_checked: '2026-10-24T09:00:00.000Z',
      }),
    )!;
    expect(offer.verification_status).toBe('verified');
    expect(offer.price_verified_at).toBe('2026-10-24T09:00:00.000Z');
  });

  it('classifies a tier-less v1 first-party row as verified from its own date', () => {
    const raw = row({
      source_id: 'porkbun',
      source_name: 'Porkbun API',
      last_checked: '2026-06-01T00:00:00.000Z',
    });
    delete raw.verification_status;
    delete raw.price_observed_at;
    const offer = normalizeOffer(raw)!;
    expect(offer.verification_status).toBe('verified');
    expect(offer.price_verified_at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('classifies a tier-less v1 third-party row as a snapshot', () => {
    const raw = row({ last_checked: '2026-06-01T00:00:00.000Z' });
    delete raw.verification_status;
    delete raw.price_observed_at;
    const offer = normalizeOffer(raw)!;
    expect(offer.verification_status).toBe('source_snapshot');
    expect(offer.price_verified_at).toBeNull();
  });

  it('never fills one price field from another', () => {
    const offer = normalizeOffer(row({ register_usd: null, transfer_usd: null }))!;
    expect(offer.register_usd).toBeNull();
    expect(offer.transfer_usd).toBeNull();
    expect(offer.renewal_usd).toBe(18.48);
  });
});

describe('Open Domain Data — upstream attestation is not our verification', () => {
  const payload = (record: Record<string, unknown>) => ({
    dataset: 'tld_pricing',
    currency: 'USD',
    records: [
      {
        registrar_id: 'namecheap',
        tld: 'com',
        register_usd: 11.28,
        renew_usd: 18.48,
        transfer_usd: 11.48,
        last_checked: '2026-08-19',
        ...record,
      },
    ],
  });

  it('keeps a record the publisher calls "verified" at snapshot tier', () => {
    const { offers } = parseOdd(payload({ verification_status: 'verified' }) as any);
    expect(offers).toHaveLength(1);
    expect(offers[0].verification_status).toBe('source_snapshot');
    // We did not read it, so there is no verification date to claim.
    expect(offers[0].price_verified_at).toBeNull();
    expect(offers[0].price_observed_at).toBe('2026-08-19');
  });

  it('treats a record with no usable date as unverified rather than dating it now', () => {
    const { offers } = parseOdd(payload({ last_checked: '' }) as any);
    expect(offers[0].verification_status).toBe('unverified');
    expect(offers[0].price_observed_at).toBeNull();
  });

  it('leaves a missing field null instead of copying another field into it', () => {
    const { offers } = parseOdd(
      payload({ register_usd: null, transfer_usd: null }) as any,
    );
    expect(offers[0].register_usd).toBeNull();
    expect(offers[0].transfer_usd).toBeNull();
    expect(offers[0].renewal_usd).toBe(18.48);
  });
});

describe('prices-meta counters — one counter per band', () => {
  const meta = (freshness: string, registrar: string, status = 'source_snapshot') =>
    ({
      tld: 'com',
      registrar_id: registrar,
      freshness,
      verification_status: status,
      source_id: 'pikkly',
    }) as unknown as PriceOffer;

  it('counts the stale band alone and never folds unknown into it', () => {
    const counts = buildMetaCounts([
      meta('stale', 'spaceship'),
      meta('stale', 'cloudflare'),
      meta('unknown', 'squarespace', 'unverified'),
      meta('recent', 'porkbun', 'verified'),
    ]);
    // The bug this guards: `stale + unknown` published under `stale_offers`
    // made prices-meta.json disagree with prices.json and the sync report.
    expect(counts.stale_offers).toBe(2);
    expect(counts.unknown_offers).toBe(1);
    expect(counts.recent_offers).toBe(1);
    expect(counts.aging_offers).toBe(0);
    expect(counts.offers).toBe(4);
    // Every band counter sums to the offer count exactly once.
    expect(
      counts.recent_offers + counts.aging_offers + counts.stale_offers + counts.unknown_offers,
    ).toBe(counts.offers);
  });

  it('counts verified offers from the tier, not from the freshness band', () => {
    const counts = buildMetaCounts([
      meta('recent', 'porkbun', 'verified'),
      meta('stale', 'porkbun', 'verified'),
      meta('stale', 'cloudflare'),
    ]);
    expect(counts.verified_offers).toBe(2);
    expect(counts.by_verification.verified).toBe(2);
    expect(counts.tlids).toBe(1);
    expect(counts.registrars).toBe(2);
  });
});

describe('committed dataset — per-source lifecycle integrity', () => {
  // These run against the file actually committed to the repository, so a
  // future sync that regresses the provenance rules fails the build rather
  // than shipping quietly.
  it('gives every source an attempt time, a success time and an evidence state', async () => {
    const dataset = await readPriceDataset();
    expect(dataset!.sources.length).toBeGreaterThan(0);
    for (const source of dataset!.sources) {
      expect(typeof source.last_attempt_at, `${source.id} last_attempt_at`).toBe('string');
      expect(Number.isNaN(Date.parse(source.last_attempt_at))).toBe(false);
      expect(['current', 'aging', 'frozen', 'none']).toContain(source.evidence_state);
      expect(typeof source.published_rows).toBe('number');
      expect(typeof source.attempted).toBe('number');
      // A source that reports success must have a real success timestamp.
      if (source.status === 'ok') {
        expect(source.last_successful_fetch_at, `${source.id} success time`).not.toBeNull();
      }
    }
  });

  it('never dates a price later than the read that produced it', async () => {
    const dataset = await readPriceDataset();
    const byId = new Map(dataset!.sources.map(s => [s.id, s]));
    for (const offer of dataset!.offers) {
      const source = byId.get(offer.source_id);
      expect(source, `unknown source ${offer.source_id}`).toBeDefined();
      const evidence = offer.price_verified_at ?? offer.price_observed_at;
      if (!evidence) continue;
      const readAt = source!.last_successful_fetch_at ?? source!.last_attempt_at;
      if (!readAt) continue;
      // One day of tolerance for date-only upstream fields.
      expect(Date.parse(evidence)).toBeLessThanOrEqual(Date.parse(readAt) + 86_400_000);
    }
  });

  it('publishes a coverage verdict that matches the source states', async () => {
    const dataset = await readPriceDataset();
    const meta = await readPriceMeta();
    expect(meta?.coverage, 'prices-meta.json must carry a coverage verdict').toBeDefined();
    const frozen = dataset!.sources
      .filter(s => s.evidence_state === 'frozen')
      .map(s => s.id)
      .sort();
    expect(meta!.coverage!.frozen_sources.slice().sort()).toEqual(frozen);
    if (frozen.length > 0) expect(meta!.coverage!.complete).toBe(false);
  });

  it('keeps every source that reports success traceable to published rows', async () => {
    const dataset = await readPriceDataset();
    const publishedBySource = new Map<string, number>();
    for (const offer of dataset!.offers) {
      publishedBySource.set(offer.source_id, (publishedBySource.get(offer.source_id) ?? 0) + 1);
    }
    for (const source of dataset!.sources) {
      const actual = publishedBySource.get(source.id) ?? 0;
      expect(source.published_rows, `${source.id} published_rows`).toBe(actual);
    }
  });
});
