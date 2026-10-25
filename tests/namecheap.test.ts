/**
 * Namecheap adapter tests.
 *
 * The adapter cannot be exercised against the live API without an account key
 * and an allowlisted egress IP, so the guarantees that matter are pinned here:
 *
 *   - the documented response shape parses, and the requested action selects
 *     the right `<ProductCategory>` when several are present;
 *   - `Price` is published and `YourPrice` (the account's own cost) never is;
 *   - a row with no retail `Price` is skipped and counted, not back-filled;
 *   - an API error, a changed schema or a truncated document throws instead of
 *     yielding a partial catalogue;
 *   - only 1-year USD figures are read;
 *   - a suspiciously small catalogue is refused rather than published.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  NAMECHEAP_MIN_REGISTER_TLDS,
  buildNamecheapOffers,
  fetchNamecheap,
  isIpv4,
  namecheapCredentialsFromEnv,
  namecheapUrl,
  parseNamecheapPricing,
  redactNamecheapUrl,
  resolveClientIp,
} from '../scripts/pricing/sources/namecheap.js';
import { NAMECHEAP_REQUIRED_ENV } from '../scripts/pricing/sources/namecheap.js';
import { sourceAdapters, missingEnvFor } from '../scripts/pricing/sources/index.js';

/**
 * The example response printed in the Namecheap API documentation, verbatim.
 * It deliberately contains TWO categories (REACTIVATE and REGISTER) so a parser
 * that ignores the requested action would be caught.
 */
const DOCUMENTED_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?><ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">  <Errors />  <RequestedCommand>namecheap.users.getPricing</RequestedCommand>  <CommandResponse Type="namecheap.users.getPricing">    <UserGetPricingResult>      <ProductType Name="DOMAIN">        <ProductCategory Name="REACTIVATE">          <Product Name="biz">            <Price Duration="1" DurationType="YEAR" Price="8.55" RegularPrice="8.55" YourPrice="8.55" CouponPrice="" Currency="USD" />            <Price Duration="2" DurationType="YEAR" Price="8.87" RegularPrice="8.87" YourPrice="8.87" CouponPrice="" Currency="USD" />          </Product>          <Product Name="bz">            <Price Duration="1" DurationType="YEAR" Price="8.88" RegularPrice="8.88" YourPrice="8.88" CouponPrice="" Currency="USD" />          </Product>        </ProductCategory>        <ProductCategory Name="REGISTER">          <Product Name="biz">            <Price Duration="1" DurationType="YEAR" Price="6.00" RegularPrice="6.00" YourPrice="6.00" CouponPrice="" Currency="USD" />            <Price Duration="2" DurationType="YEAR" Price="8.87" RegularPrice="8.87" YourPrice="8.87" CouponPrice="" Currency="USD" />          </Product>        </ProductCategory>      </ProductType>    </UserGetPricingResult>  </CommandResponse>  <Server>IMWS-A06</Server><GMTTimeDifference>+5:30</GMTTimeDifference><ExecutionTime>1.109</ExecutionTime></ApiResponse>`;

/** Build a one-category response with arbitrary products. */
function catalogueXml(
  category: string,
  products: Array<{ tld: string; price?: string; regular?: string; your?: string; currency?: string | null; duration?: string }>,
): string {
  const body = products
    .map(p => {
      const currency = p.currency === null ? '' : ` Currency="${p.currency ?? 'USD'}"`;
      return (
        `<Product Name="${p.tld}">` +
        `<Price Duration="${p.duration ?? '1'}" DurationType="YEAR" ` +
        `Price="${p.price ?? ''}" RegularPrice="${p.regular ?? p.price ?? ''}" ` +
        `YourPrice="${p.your ?? '0.00'}" CouponPrice=""${currency} />` +
        `</Product>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><ApiResponse Status="OK"><Errors />` +
    `<CommandResponse Type="namecheap.users.getPricing"><UserGetPricingResult>` +
    `<ProductType Name="DOMAIN"><ProductCategory Name="${category}">${body}</ProductCategory>` +
    `</ProductType></UserGetPricingResult></CommandResponse></ApiResponse>`
  );
}

describe('parseNamecheapPricing', () => {
  it('reads the documented example and selects the requested action', () => {
    const register = parseNamecheapPricing(DOCUMENTED_EXAMPLE, 'REGISTER');
    expect([...register.prices.entries()]).toEqual([['biz', 6]]);
    // `bz` exists only in the REACTIVATE category.
    expect(register.prices.has('bz')).toBe(false);
    // Two-year terms are ignored: the dataset models one year.
    expect(register.prices.get('biz')).not.toBe(8.87);
  });

  it('throws when the requested category is absent from a multi-category response', () => {
    expect(() => parseNamecheapPricing(DOCUMENTED_EXAMPLE, 'RENEW')).toThrow(
      /no <ProductCategory Name="RENEW">/,
    );
  });

  it('publishes Price, never YourPrice', () => {
    const xml = catalogueXml('REGISTER', [{ tld: 'com', price: '9.58', your: '8.06' }]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect(parsed.prices.get('com')).toBe(9.58);
  });

  it('skips a product whose retail Price is empty instead of substituting YourPrice', () => {
    const xml = catalogueXml('REGISTER', [
      { tld: 'com', price: '', your: '8.06', regular: '9.58' },
      { tld: 'net', price: '11.98', your: '10.06' },
    ]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect(parsed.prices.has('com')).toBe(false);
    expect(parsed.prices.get('net')).toBe(11.98);
    expect(parsed.skipped['missing-retail-price']).toBe(1);
  });

  it('skips non-USD and currency-less rows rather than relabelling them', () => {
    const xml = catalogueXml('REGISTER', [
      { tld: 'com', price: '9.58', currency: 'EUR' },
      { tld: 'net', price: '11.98', currency: null },
      { tld: 'org', price: '12.98', currency: 'USD' },
    ]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect([...parsed.prices.keys()]).toEqual(['org']);
    expect(parsed.skipped['non-usd-currency']).toBe(1);
    expect(parsed.skipped['missing-currency']).toBe(1);
  });

  it('only reads the 1-year term', () => {
    const xml = catalogueXml('REGISTER', [
      { tld: 'com', price: '9.58', duration: '2' },
      { tld: 'net', price: '11.98', duration: '1' },
    ]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect([...parsed.prices.keys()]).toEqual(['net']);
    expect(parsed.skipped['no-one-year-price']).toBe(1);
  });

  it('rejects zero, negative and unparsable prices without dropping the valid row', () => {
    const xml = catalogueXml('REGISTER', [
      { tld: 'com', price: '0.00' },
      { tld: 'net', price: '-1' },
      { tld: 'org', price: 'n/a' },
      { tld: 'io', price: '34.98' },
    ]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect([...parsed.prices.keys()]).toEqual(['io']);
    expect(parsed.skipped['invalid-price']).toBe(3);
  });

  it('throws when nothing in the response is usable', () => {
    const xml = catalogueXml('REGISTER', [{ tld: 'com', price: '0.00' }]);
    expect(() => parseNamecheapPricing(xml, 'REGISTER')).toThrow(/no usable 1-year USD prices/);
  });

  it('normalises TLD names to lowercase and rejects names the catalog cannot hold', () => {
    // `data/tlds.json` models single-label TLDs only, so a multi-label product
    // name such as `co.uk` is not a TLD we can attach a price to — it is
    // rejected here and again by row validation, never silently relabelled.
    const xml = catalogueXml('REGISTER', [
      { tld: 'COM', price: '9.58' },
      { tld: 'co.uk', price: '8.98' },
      { tld: 'bad tld', price: '1.00' },
      { tld: '.net', price: '11.98' },
    ]);
    const parsed = parseNamecheapPricing(xml, 'REGISTER');
    expect([...parsed.prices.keys()]).toEqual(['com']);
    expect(parsed.skipped['invalid-tld']).toBe(3);
  });

  it('throws on an API error and keeps the documented error number', () => {
    const xml =
      '<ApiResponse Status="ERROR"><Errors><Error Number="1011102">API Key is invalid or API access has not been enabled</Error></Errors>' +
      '<CommandResponse Type="namecheap.users.getPricing" /></ApiResponse>';
    expect(() => parseNamecheapPricing(xml, 'REGISTER')).toThrow(/#1011102/);
    expect(() => parseNamecheapPricing(xml, 'REGISTER')).toThrow(/API Key is invalid/);
  });

  it('throws when the documented result element is missing', () => {
    const xml = '<ApiResponse Status="OK"><Errors /><CommandResponse Type="x" /></ApiResponse>';
    expect(() => parseNamecheapPricing(xml, 'REGISTER')).toThrow(/missing <UserGetPricingResult>/);
  });

  it('throws on a truncated document instead of returning a partial catalogue', () => {
    expect(() => parseNamecheapPricing(DOCUMENTED_EXAMPLE.slice(0, 400), 'REGISTER')).toThrow(
      /malformed XML/,
    );
  });
});

describe('buildNamecheapOffers', () => {
  const observedAt = '2026-10-24T00:00:00.000Z';

  it('merges the three actions into one offer per TLD', () => {
    const offers = buildNamecheapOffers(
      {
        REGISTER: parseNamecheapPricing(catalogueXml('REGISTER', [{ tld: 'com', price: '9.58' }]), 'REGISTER'),
        RENEW: parseNamecheapPricing(catalogueXml('RENEW', [{ tld: 'com', price: '17.98' }]), 'RENEW'),
        TRANSFER: parseNamecheapPricing(catalogueXml('TRANSFER', [{ tld: 'com', price: '10.98' }]), 'TRANSFER'),
      },
      observedAt,
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      tld: 'com',
      registrar_id: 'namecheap',
      registrar_name: 'Namecheap',
      currency: 'USD',
      register_usd: 9.58,
      renewal_usd: 17.98,
      transfer_usd: 10.98,
      promotional: false,
      promo_code: null,
      source_id: 'namecheap',
      price_observed_at: observedAt,
      price_verified_at: observedAt,
      verification_status: 'verified',
      source_status_stale: false,
    });
  });

  it('leaves unpublished categories null and sorts by TLD', () => {
    const offers = buildNamecheapOffers(
      {
        REGISTER: parseNamecheapPricing(
          catalogueXml('REGISTER', [
            { tld: 'org', price: '12.98' },
            { tld: 'com', price: '9.58' },
          ]),
          'REGISTER',
        ),
        RENEW: parseNamecheapPricing(catalogueXml('RENEW', [{ tld: 'com', price: '17.98' }]), 'RENEW'),
      },
      observedAt,
    );
    expect(offers.map(o => o.tld)).toEqual(['com', 'org']);
    const org = offers.find(o => o.tld === 'org')!;
    expect(org.register_usd).toBe(12.98);
    expect(org.renewal_usd).toBeNull();
    expect(org.transfer_usd).toBeNull();
  });

  it('drops a row that carries no price at all', () => {
    const offers = buildNamecheapOffers({}, observedAt);
    expect(offers).toEqual([]);
  });
});

describe('request construction', () => {
  const credentials = {
    apiUser: 'apiexample',
    apiKey: 'SECRET-KEY',
    userName: 'apiexample',
    clientIp: '192.0.2.10',
  };

  it('sends every documented global parameter plus the action', () => {
    const url = new URL(namecheapUrl(credentials, 'TRANSFER'));
    expect(url.origin + url.pathname).toBe('https://api.namecheap.com/xml.response');
    expect(url.searchParams.get('ApiUser')).toBe('apiexample');
    expect(url.searchParams.get('ApiKey')).toBe('SECRET-KEY');
    expect(url.searchParams.get('UserName')).toBe('apiexample');
    expect(url.searchParams.get('ClientIp')).toBe('192.0.2.10');
    expect(url.searchParams.get('Command')).toBe('namecheap.users.getPricing');
    expect(url.searchParams.get('ProductType')).toBe('DOMAIN');
    expect(url.searchParams.get('ProductCategory')).toBe('DOMAINS');
    expect(url.searchParams.get('ActionName')).toBe('TRANSFER');
  });

  it('redacts the key so a logged URL never leaks it', () => {
    const redacted = redactNamecheapUrl(namecheapUrl(credentials, 'REGISTER'));
    expect(redacted).not.toContain('SECRET-KEY');
    expect(redacted).toContain('ApiKey=***');
  });
});

describe('client IP handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a valid IPv4 address', () => {
    expect(isIpv4('192.0.2.10')).toBe(true);
    expect(isIpv4('255.255.255.255')).toBe(true);
  });

  it('rejects IPv6 and out-of-range values', () => {
    expect(isIpv4('2001:db8::1')).toBe(false);
    expect(isIpv4('256.0.0.1')).toBe(false);
    expect(isIpv4('192.0.2')).toBe(false);
  });

  it('prefers the explicit environment value', async () => {
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '198.51.100.7');
    await expect(resolveClientIp()).resolves.toEqual({ ip: '198.51.100.7', source: 'env' });
  });

  it('rejects an IPv6 value in the environment with an actionable message', async () => {
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '2001:db8::1');
    await expect(resolveClientIp()).rejects.toThrow(/must be an IPv4 address/);
  });

  it('detects the egress address when none is configured', async () => {
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '');
    const stub = vi.fn(async () => new Response(JSON.stringify({ ip: '203.0.113.9' }), { status: 200 }));
    await expect(resolveClientIp(stub as unknown as typeof fetch)).resolves.toEqual({
      ip: '203.0.113.9',
      source: 'detected',
    });
  });

  it('refuses a detected address that is not IPv4', async () => {
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '');
    const stub = vi.fn(async () => new Response(JSON.stringify({ ip: '2001:db8::1' }), { status: 200 }));
    await expect(resolveClientIp(stub as unknown as typeof fetch)).rejects.toThrow(/not IPv4/);
  });
});

describe('credentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to run with a partial configuration and names what is missing', () => {
    for (const name of NAMECHEAP_REQUIRED_ENV) vi.stubEnv(name, '');
    vi.stubEnv('NAMECHEAP_API_USER', 'user');
    expect(() => namecheapCredentialsFromEnv()).toThrow(/NAMECHEAP_API_KEY/);
    expect(() => namecheapCredentialsFromEnv()).toThrow(/NAMECHEAP_USERNAME/);
  });

  it('is registered as a credential-gated source', () => {
    const adapter = sourceAdapters.find(a => a.id === 'namecheap');
    expect(adapter).toBeDefined();
    expect(adapter?.verificationStatus).toBe('verified');
    expect(adapter?.requiresEnv).toEqual(NAMECHEAP_REQUIRED_ENV);
    vi.stubEnv('NAMECHEAP_API_USER', '');
    expect(missingEnvFor(adapter!).length).toBe(NAMECHEAP_REQUIRED_ENV.length);
  });
});

describe('fetchNamecheap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function stubCatalogue(count: number) {
    const products = Array.from({ length: count }, (_, i) => ({
      tld: i === 0 ? 'com' : `t${i}`,
      price: (10 + i / 100).toFixed(2),
    }));
    const byAction: Record<string, string> = {
      REGISTER: catalogueXml('REGISTER', products),
      RENEW: catalogueXml('RENEW', products.map(p => ({ ...p, price: (20 + Number(p.price) / 100).toFixed(2) }))),
      TRANSFER: catalogueXml('TRANSFER', products.map(p => ({ ...p, price: (15 + Number(p.price) / 100).toFixed(2) }))),
    };
    return vi.fn(async (input: RequestInfo | URL) => {
      const action = new URL(String(input)).searchParams.get('ActionName') ?? '';
      const body = byAction[action];
      if (!body) return new Response('unexpected action', { status: 400 });
      return new Response(body, { status: 200 });
    });
  }

  it('requests all three actions and merges the results', async () => {
    vi.stubEnv('NAMECHEAP_API_USER', 'user');
    vi.stubEnv('NAMECHEAP_API_KEY', 'key');
    vi.stubEnv('NAMECHEAP_USERNAME', 'user');
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '192.0.2.10');
    const stub = stubCatalogue(NAMECHEAP_MIN_REGISTER_TLDS + 5);

    const offers = await fetchNamecheap(new Date('2026-10-24T00:00:00.000Z'), stub as unknown as typeof fetch);

    expect(stub).toHaveBeenCalledTimes(3);
    expect(offers).toHaveLength(NAMECHEAP_MIN_REGISTER_TLDS + 5);
    expect(offers[0].tld).toBe('com');
    expect(offers[0].register_usd).toBe(10);
    expect(offers[0].renewal_usd).toBe(20.1);
    expect(offers[0].transfer_usd).toBe(15.1);
    expect(offers[0].price_verified_at).toBe('2026-10-24T00:00:00.000Z');
  });

  it('refuses a catalogue that is implausibly small', async () => {
    vi.stubEnv('NAMECHEAP_API_USER', 'user');
    vi.stubEnv('NAMECHEAP_API_KEY', 'key');
    vi.stubEnv('NAMECHEAP_USERNAME', 'user');
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '192.0.2.10');
    const stub = stubCatalogue(3);

    await expect(
      fetchNamecheap(new Date('2026-10-24T00:00:00.000Z'), stub as unknown as typeof fetch),
    ).rejects.toThrow(/refusing to publish/);
  });

  it('surfaces the client IP on an auth error so the allowlist can be fixed', async () => {
    vi.stubEnv('NAMECHEAP_API_USER', 'user');
    vi.stubEnv('NAMECHEAP_API_KEY', 'key');
    vi.stubEnv('NAMECHEAP_USERNAME', 'user');
    vi.stubEnv('NAMECHEAP_CLIENT_IP', '192.0.2.99');
    const stub = vi.fn(
      async () =>
        new Response(
          '<ApiResponse Status="ERROR"><Errors><Error Number="1011150">Parameter RequestIP is invalid</Error></Errors></ApiResponse>',
          { status: 200 },
        ),
    );

    const failure = fetchNamecheap(new Date('2026-10-24T00:00:00.000Z'), stub as unknown as typeof fetch);
    await expect(failure).rejects.toThrow(/#1011150/);
    await expect(failure).rejects.toThrow(/clientIp=192\.0\.2\.99/);
  });

  it('refuses to run without credentials', async () => {
    for (const name of NAMECHEAP_REQUIRED_ENV) vi.stubEnv(name, '');
    await expect(fetchNamecheap()).rejects.toThrow(/missing env/);
  });
});
