/**
 * Fixture payloads mirroring the real shapes published by each pricing
 * source (verified against live responses during the Phase 4 audit).
 * Non-`.test.ts` so vitest does not treat this as a suite.
 */

import type { RawOffer } from '../../src/lib/pricingTypes.js';

export const porkbunSuccess = {
  status: 'SUCCESS',
  pricing: {
    com: { registration: '11.08', renewal: '11.08', transfer: '11.08', coupons: [] },
    io: { registration: '28.12', renewal: '51.80', transfer: '51.80', coupons: [] },
    ai: { registration: '82.70', renewal: '82.70', transfer: '165.09', coupons: [] },
    xyz: { registration: '-5', renewal: '9.00', transfer: '9.00', coupons: [] },
    org: { registration: '0', renewal: '0', transfer: '0', coupons: [] },
    app: {
      registration: '6.99',
      renewal: '12.99',
      transfer: '12.99',
      coupons: [{ type: 'registration', code: 'SAVE5' }],
    },
    notadelegatedtld: { registration: '8.03', renewal: '8.03', transfer: '8.03', coupons: [] },
  },
  unsupported: ['notarealtld'],
};

export const pikklyPayload = {
  dataset: 'domains',
  generated_at: '2026-10-20T09:06:54.445Z',
  license: 'CC BY 4.0',
  records: [
    {
      provider: 'cloudflare',
      product: 'domain',
      sku: '.com',
      first_year_usd: 10.46,
      renewal_usd: 10.46,
      transfer_usd: null,
      source_url: 'https://github.com/example/dump',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'ok',
      meta: { dump_date: '2026-08-04', note: 'community dump' },
    },
    {
      provider: 'porkbun',
      product: 'domain',
      sku: '.io',
      first_year_usd: 28.12,
      renewal_usd: 51.8,
      transfer_usd: 51.8,
      source_url: 'https://porkbun.com/tld/io',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'ok',
    },
    {
      provider: 'hover',
      product: 'domain',
      sku: '.dev',
      first_year_usd: 12.99,
      renewal_usd: 12.99,
      transfer_usd: null,
      source_url: 'https://www.hover.com/domain-pricing',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'stale', // source says stale — must stay stale forever
    },
    {
      provider: 'gandi',
      product: 'domain',
      sku: '.app',
      first_year_usd: null,
      renewal_usd: null,
      transfer_usd: null,
      source_url: 'https://www.gandi.net/en-US/domain/tld',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'unavailable', // must be skipped, never overwrite good data
    },
    {
      provider: 'somewhere-else',
      product: 'domain',
      sku: '.xyz',
      first_year_usd: 5,
      renewal_usd: 5,
      transfer_usd: 5,
      source_url: 'https://example.com',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'ok',
    },
    {
      provider: 'dynadot',
      product: 'hosting', // not a domain row — skipped
      sku: '.org',
      first_year_usd: 7,
      renewal_usd: 7,
      transfer_usd: 7,
      source_url: 'https://www.dynadot.com/domain/prices',
      last_checked: '2026-10-20T09:06:24.975Z',
      status: 'ok',
    },
  ],
};

export const oddPayload = {
  dataset: 'tld_pricing',
  version: '2026.06',
  license: 'CC-BY-4.0',
  last_checked: '2026-08-19T00:00:00Z',
  currency: 'USD',
  count: 4,
  records: [
    {
      registrar_id: 'cloudflare-registrar',
      tld: 'com',
      register_usd: 10.46,
      renew_usd: 10.46,
      transfer_usd: null,
      promotional: false,
      last_checked: '2026-05-12T00:00:00Z',
      source_url: 'https://www.cloudflare.com/products/registrar/',
    },
    {
      registrar_id: 'namecheap',
      tld: 'com',
      register_usd: 11.28,
      renew_usd: 18.48,
      transfer_usd: 11.48,
      promotional: true,
      last_checked: '2026-08-19T00:00:00Z',
      source_url: 'https://www.namecheap.com',
    },
    {
      registrar_id: 'unknown-registrar',
      tld: 'com',
      register_usd: 1,
      renew_usd: 1,
      transfer_usd: 1,
      promotional: false,
      last_checked: '2026-08-19T00:00:00Z',
    },
    {
      registrar_id: 'godaddy',
      tld: 'org',
      register_usd: 12.99,
      renew_usd: 22.99,
      transfer_usd: null,
      promotional: false,
      last_checked: '2026-05-12T00:00:00Z',
      source_url: 'https://www.godaddy.com',
    },
  ],
};

export function rawOffer(overrides: Partial<RawOffer> = {}): RawOffer {
  return {
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
    source_id: 'porkbun',
    source_url: 'https://porkbun.com/tld/com',
    purchase_url: 'https://porkbun.com/tld/com',
    price_observed_at: '2026-10-20T00:00:00.000Z',
    price_verified_at: '2026-10-20T00:00:00.000Z',
    verification_status: 'verified',
    source_status_stale: false,
    ...overrides,
  };
}

/** A third-party snapshot row: observed on `date`, never first-party verified. */
export function snapshotOffer(overrides: Partial<RawOffer> = {}): RawOffer {
  return rawOffer({
    source_id: 'opendomaindata',
    source_url: 'https://www.opendomaindata.org/datasets/tld-pricing',
    purchase_url: null,
    price_verified_at: null,
    verification_status: 'source_snapshot',
    price_observed_at: '2026-08-19T00:00:00Z',
    ...overrides,
  });
}

/**
 * A minimal Hover `data-props` page. Hover's parser refuses payloads with
 * fewer than 100 usable rows (a guard against silently publishing a truncated
 * catalogue), so the fixture pads the payload with synthetic TLDs.
 */
export function hoverPage(entries: Record<string, unknown[]>): string {
  const prices: Record<string, unknown[]> = { ...entries };
  for (let i = 0; prices[`tld${i}`] === undefined && i < 120; i++) {
    prices[`tld${i}`] = [1, 9.99 + i, 14.99 + i, 14.99 + i];
  }
  const payload = JSON.stringify({ prices }).replace(/'/g, '&#39;');
  return `<html><body><div data-props='${payload}'></div></body></html>`;
}

/** A minimal Gandi price table. Values are `[tld, creation, transfer, renewal]`. */
export function gandiPage(rows: Array<[string, string, string, string]>): string {
  const body = rows
    .map(([tld, creation, transfer, renewal]) =>
      `<tr><td>${tld}</td><td>${creation}</td><td>${transfer}</td><td>${renewal}</td></tr>`,
    )
    .join('');
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

/** A minimal IONOS `__NEXT_DATA__` page with one prices table. */
export function ionosPage(entries: Array<Record<string, unknown>>): string {
  const payload = JSON.stringify({
    props: {
      pageProps: {
        componentsWithPrices: [{ content: { domainPrices: entries } }],
      },
    },
  });
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body></html>`;
}

/** BDR pricing CSV plus its verification taxonomy. */
export const bdrCsv = [
  'registrar_id,tld,first_year_price,renewal_price,transfer_price,currency,last_checked,source_url',
  'porkbun,com,11.08,11.08,11.08,USD,2026-10-21,https://porkbun.com/tld/com',
  'godaddy,com,11.99,21.99,11.99,USD,2026-10-21,https://www.godaddy.com/tlds/com',
  'squarespace,com,20.00,20.00,,USD,2026-10-21,https://domains.squarespace.com',
  'cloudflare,com,10.46,10.46,,USD,2026-10-21,https://www.cloudflare.com/products/registrar/',
  'namecheap,com,11.28,18.48,11.48,EUR,2026-10-21,https://www.namecheap.com',
  'unknownshop,com,1.00,1.00,1.00,USD,2026-10-21,https://example.com',
].join('\n');

export const bdrVerification = {
  registrars: {
    porkbun: { status: 'verified' },
    godaddy: { status: 'verified' },
    squarespace: { status: 'sample' },
    cloudflare: { status: 'model_confirmed' },
    namecheap: { status: 'verified' },
  },
};
