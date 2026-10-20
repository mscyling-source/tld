/**
 * Pricing pipeline tests: pure calculations, validation, merge, source
 * parsers (fixtures shaped from real payloads), outbound-link policy,
 * and an integration pass over the committed dataset.
 *
 * Invariants under test:
 *   - missing prices stay null ("Price unavailable"), never 0
 *   - three-year cost = register + 2×renewal, only when both exist
 *   - freshness derives from source timestamps, never from rebuild time
 *   - invalid rows (unknown TLD, bad price, bad URL, dupes) are rejected
 *   - freshest source wins a (registrar, TLD) conflict; registrars never merge
 *   - outbound links are ordinary links; no affiliate params by default
 */

import { describe, it, expect } from 'vitest';
import {
  calcThreeYear,
  normalizePrice,
  qualityFor,
  effectiveQuality,
  cheapestPoint,
  sortComparisonRows,
  formatUsd,
  STALE_AFTER_DAYS,
  MAX_SANE_PRICE_USD,
} from '../src/lib/pricingCalc.js';
import { validateOffers, countRejections } from '../scripts/pricing/validate.js';
import { mergeBatches } from '../scripts/pricing/merge.js';
import { parsePorkbun } from '../scripts/pricing/sources/porkbun.js';
import { parsePikkly } from '../scripts/pricing/sources/pikkly.js';
import { parseOdd } from '../scripts/pricing/sources/opendomaindata.js';
import {
  purchaseUrlFor,
  outboundRel,
  hasAffiliate,
  registrarName,
  registrars,
} from '../src/config/registrars.js';
import { readPriceDataset, getOffersForTld, buildComparisonRows } from '../src/lib/pricing.js';
import type { ComparisonRow, PriceOffer, RawOffer } from '../src/lib/pricingTypes.js';
import { porkbunSuccess, pikklyPayload, oddPayload, rawOffer } from './fixtures/pricing-fixtures.js';

const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'ai', 'dev', 'app', 'xyz', 'cloudflare', 'invalidtld',
]);

const NOW = new Date('2026-10-20T12:00:00.000Z');

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

describe('normalizePrice', () => {
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
  });

  it('throws on invalid, negative or absurd prices', () => {
    expect(() => normalizePrice('free')).toThrow();
    expect(() => normalizePrice(-5)).toThrow();
    expect(() => normalizePrice('-5')).toThrow();
    expect(() => normalizePrice(NaN)).toThrow();
    expect(() => normalizePrice(MAX_SANE_PRICE_USD + 1)).toThrow();
    expect(() => normalizePrice({})).toThrow();
  });
});

describe('qualityFor / effectiveQuality', () => {
  it('marks fresh data verified and old data stale', () => {
    expect(qualityFor('2026-10-20T00:00:00Z', NOW)).toBe('verified');
    expect(qualityFor('2026-09-25T00:00:00Z', NOW)).toBe('verified'); // 25 days
    expect(qualityFor('2026-09-19T00:00:00Z', NOW)).toBe('stale'); // 31 days > 30
    expect(qualityFor('2026-05-12T00:00:00Z', NOW)).toBe('stale');
  });

  it('treats unparsable and far-future timestamps as stale, not verified', () => {
    expect(qualityFor('not-a-date', NOW)).toBe('stale');
    expect(qualityFor('2026-11-30T00:00:00Z', NOW)).toBe('stale');
    expect(STALE_AFTER_DAYS).toBe(30);
  });

  it('never upgrades a source-flagged stale row, no matter how recent', () => {
    expect(
      effectiveQuality({ last_checked: '2026-10-20T00:00:00Z', source_status_stale: true }, NOW),
    ).toBe('stale');
    expect(
      effectiveQuality({ last_checked: '2026-10-20T00:00:00Z', source_status_stale: false }, NOW),
    ).toBe('verified');
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
      validateOffers([rawOffer({ last_checked: 'garbage' })], KNOWN_TLDS).rejected[0].reason,
    ).toBe('invalid-timestamp');
  });

  it('deduplicates within a batch and counts rejection reasons', () => {
    const { valid, rejected } = validateOffers(
      [rawOffer(), rawOffer(), rawOffer({ registrar_id: 'cloudflare' })],
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

  it('keeps one offer per (registrar, TLD) — freshest check date wins', () => {
    const old = rawOffer({
      source_id: 'opendomaindata',
      last_checked: '2026-05-12T00:00:00.000Z',
      register_usd: 11.99,
    });
    const fresh = rawOffer({
      source_id: 'porkbun',
      last_checked: '2026-10-20T00:00:00.000Z',
      register_usd: 11.08,
    });
    const { merged, superseded } = mergeBatches([
      batch('opendomaindata', 2, [old]),
      batch('porkbun', 0, [fresh]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source_id).toBe('porkbun');
    expect(merged[0].register_usd).toBe(11.08);
    expect(superseded).toBe(1);
  });

  it('breaks freshness ties by source priority', () => {
    const stamp = '2026-10-20T00:00:00.000Z';
    const { merged } = mergeBatches([
      batch('opendomaindata', 2, [rawOffer({ source_id: 'opendomaindata', last_checked: stamp })]),
      batch('porkbun', 0, [rawOffer({ source_id: 'porkbun', last_checked: stamp })]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source_id).toBe('porkbun');
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
  it('parses the Porkbun public pricing payload', () => {
    const offers = parsePorkbun(porkbunSuccess, NOW.toISOString());
    const com = offers.find(o => o.tld === 'com')!;
    expect(com.register_usd).toBe(11.08);
    expect(com.renewal_usd).toBe(11.08);
    expect(com.transfer_usd).toBe(11.08);
    expect(com.source_url).toBe('https://porkbun.com/tld/com');
    expect(com.purchase_url).toBe('https://porkbun.com/tld/com');

    // negative price recorded as an invalid field (row will be rejected)
    const xyz = offers.find(o => o.tld === 'xyz')!;
    expect(xyz.invalid_fields).toContain('registration');

    // documented coupon with a code becomes a promo — codes are never invented
    const app = offers.find(o => o.tld === 'app')!;
    expect(app.promo_code).toBe('SAVE5');
    expect(app.promotional).toBe(true);

    expect(() => parsePorkbun({ status: 'ERROR' }, NOW.toISOString())).toThrow();
  });

  it('parses Pikkly rows with conservative freshness and safe skips', () => {
    const { offers, skipped } = parsePikkly(pikklyPayload);

    // dump_date wins over daily rebuild time
    const cloudflare = offers.find(o => o.registrar_id === 'cloudflare')!;
    expect(cloudflare.last_checked).toBe('2026-08-04');
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
    three_year_usd: null,
    source_id: 'pikkly',
    source_url: 'https://example.com',
    purchase_url: 'https://example.com',
    last_checked: '2026-10-20T00:00:00.000Z',
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

  it('prefers the verified quote when prices tie', () => {
    const offers = [
      offer({ registrar_id: 'a', registrar_name: 'A', register_usd: 10, last_checked: '2026-05-01T00:00:00Z' }),
      offer({ registrar_id: 'b', registrar_name: 'B', register_usd: 10, last_checked: '2026-10-20T00:00:00Z' }),
    ];
    expect(cheapestPoint(offers, 'register_usd', NOW)?.registrar_id).toBe('b');
  });

  it('sorts by each key with missing prices always last', () => {
    const rows: ComparisonRow[] = [
      {
        suffix: '.b', tld: 'b', type: 'generic', offers: 1, verified_offers: 1,
        register: null, renewal: { usd: 5, registrar_id: 'x', registrar_name: 'X', quality: 'verified', last_checked: '2026-10-20T00:00:00Z' },
        transfer: null, three_year: null, visit_url: '', visit_registrar: '',
        registrars: ['X'], latest_checked: '2026-10-20T00:00:00Z',
      },
      {
        suffix: '.a', tld: 'a', type: 'generic', offers: 2, verified_offers: 2,
        register: { usd: 20, registrar_id: 'y', registrar_name: 'Y', quality: 'verified', last_checked: '2026-10-20T00:00:00Z' },
        renewal: null, transfer: null,
        three_year: { usd: 60, registrar_id: 'y', registrar_name: 'Y', quality: 'verified', last_checked: '2026-10-20T00:00:00Z' },
        visit_url: '', visit_registrar: '', registrars: ['Y'], latest_checked: '2026-10-20T00:00:00Z',
      },
      {
        suffix: '.c', tld: 'c', type: 'generic', offers: 1, verified_offers: 1,
        register: { usd: 9, registrar_id: 'z', registrar_name: 'Z', quality: 'verified', last_checked: '2026-10-20T00:00:00Z' },
        renewal: null, transfer: null, three_year: null, visit_url: '', visit_registrar: '',
        registrars: ['Z'], latest_checked: '2026-10-20T00:00:00Z',
      },
    ];

    expect(sortComparisonRows(rows, 'register-asc').map(r => r.tld)).toEqual(['c', 'a', 'b']);
    expect(sortComparisonRows(rows, 'three-year-asc').map(r => r.tld)).toEqual(['a', 'b', 'c']);
    expect(sortComparisonRows(rows, 'suffix-asc').map(r => r.tld)).toEqual(['a', 'b', 'c']);
  });

  it('formats display prices and keeps null display to the caller', () => {
    expect(formatUsd(11.08)).toBe('$11.08');
    expect(formatUsd(null)).toBe('');
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
  it('contains real offers with correct derived math and no missing links', async () => {
    const dataset = await readPriceDataset();
    expect(dataset).not.toBeNull();
    expect(dataset!.offers.length).toBeGreaterThan(500);
    expect(dataset!.currency).toBe('USD');

    for (const o of dataset!.offers) {
      expect(['verified', 'stale']).toContain(o.quality);
      expect(o.currency).toBe('USD');
      if (o.three_year_usd !== null && o.register_usd !== null && o.renewal_usd !== null) {
        expect(o.three_year_usd).toBeCloseTo(o.register_usd + 2 * o.renewal_usd, 2);
      }
      if (o.purchase_url !== null) {
        expect(o.purchase_url).toMatch(/^https:\/\//);
      }
      expect(o.source_url).toMatch(/^https:\/\//);
    }
    // every offer resolves to a known registrar
    const unknown = dataset!.offers.filter(o => !registrars[o.registrar_id]);
    expect(unknown).toHaveLength(0);
  });

  it('serves .com offers across multiple registrars with null-safe prices', async () => {
    const offers = await getOffersForTld('com');
    expect(offers.length).toBeGreaterThanOrEqual(5);
    expect(offers.every(o => o.tld === 'com')).toBe(true);
    expect(new Set(offers.map(o => o.registrar_id)).size).toBe(offers.length);
    expect(offers.some(o => o.renewal_usd !== null)).toBe(true);
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
      if (row.three_year && row.register) {
        expect(row.three_year.usd).toBeGreaterThanOrEqual(row.register.usd);
      }
    }
  });
});
