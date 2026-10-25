/**
 * Source adapter: Namecheap official API — `namecheap.users.getPricing`.
 *
 * Endpoint: GET https://api.namecheap.com/xml.response?Command=namecheap.users.getPricing
 * Docs:     https://www.namecheap.com/support/api/methods/users/get-pricing/
 * Auth:     ApiUser + ApiKey + UserName + ClientIp. The key must be enabled on
 *           the account AND the calling IP must be on Namecheap's allowlist.
 *           Namecheap accepts IPv4 only.
 * Coverage: every TLD the account can sell, split by action
 *           (REGISTER / RENEW / TRANSFER).
 * Licence:  official documented API intended for programmatic use — no
 *           scraping of the website, no challenge bypass.
 *
 * ## Which number we publish
 *
 * The documented `Price` element carries three figures per (product, duration):
 *
 *   Price         "Final price (it can be from regular, userprice, special
 *                  price, promo price, tier price)" — what a customer is
 *                  quoted for this account.
 *   RegularPrice  the undiscounted list price.
 *   YourPrice     "The user's price for the product" — i.e. the *account's*
 *                  cost, which for a reseller account is below retail.
 *
 * We publish `Price`. We never publish `YourPrice`: a reseller account's cost
 * is not a retail quote, and silently substituting it would understate every
 * price on the site. When `Price` is missing or empty the row is skipped and
 * counted — never back-filled from `YourPrice` or `RegularPrice`.
 *
 * ## Fail-closed contract
 *
 * Nothing here is allowed to publish a price it cannot justify:
 *   - the response must be `Status="OK"`; an API error throws with the
 *     documented error number and message;
 *   - the expected `UserGetPricingResult → ProductType → ProductCategory →
 *     Product → Price` shape must be present, otherwise it throws (a changed
 *     schema is a bug report, not a price list);
 *   - only `Duration="1"` + `DurationType="YEAR"` is read, because the dataset
 *     models first-year registration / annual renewal / one-year transfer;
 *   - only `Currency="USD"` rows are accepted;
 *   - a catalogue that comes back implausibly small throws instead of
 *     replacing the previous rows.
 *
 * ## Credentials
 *
 *   NAMECHEAP_API_USER    API user (usually the account username)
 *   NAMECHEAP_API_KEY     API key, enabled in Profile → Tools → API Access
 *   NAMECHEAP_USERNAME    username the command executes for (usually the same)
 *   NAMECHEAP_CLIENT_IP   optional; the egress IPv4 Namecheap should see. When
 *                         unset it is detected at run time and reported in any
 *                         auth error, because "which IP do I allowlist?" is the
 *                         single most common failure here.
 *
 * GitHub-hosted runners egress from a rotating pool, so a stable IP (or a
 * fixed-IP proxy) is required for this source to work in CI at all.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { POLITE_USER_AGENT } from '../http.js';
import { elementChildren, firstChild, parseXml, rootElement, type XmlNode } from '../xml.js';

export const NAMECHEAP_SOURCE = {
  id: 'namecheap',
  name: 'Namecheap API',
  url: 'https://www.namecheap.com/support/api/methods/users/get-pricing/',
  license: 'Official API (account API key + IP allowlist required)',
  attribution: null,
  priority: 0, // read live from the registrar's own API — wins freshness ties
  verificationStatus: 'verified' as VerificationStatus,
};

export const NAMECHEAP_ENDPOINT = 'https://api.namecheap.com/xml.response';

/** Documented actions, in the order we request them. */
export const NAMECHEAP_ACTIONS = ['REGISTER', 'RENEW', 'TRANSFER'] as const;
export type NamecheapAction = (typeof NAMECHEAP_ACTIONS)[number];

/** Which dataset field each action fills. */
const ACTION_FIELD: Record<NamecheapAction, 'register_usd' | 'renewal_usd' | 'transfer_usd'> = {
  REGISTER: 'register_usd',
  RENEW: 'renewal_usd',
  TRANSFER: 'transfer_usd',
};

export const NAMECHEAP_ENV = {
  apiUser: 'NAMECHEAP_API_USER',
  apiKey: 'NAMECHEAP_API_KEY',
  userName: 'NAMECHEAP_USERNAME',
  clientIp: 'NAMECHEAP_CLIENT_IP',
} as const;

/**
 * Credentials without which the adapter cannot run at all. `NAMECHEAP_CLIENT_IP`
 * is deliberately absent: it is detectable, and requiring it would make the
 * source look unconfigured when only one detail is missing.
 */
export const NAMECHEAP_REQUIRED_ENV: string[] = [
  NAMECHEAP_ENV.apiUser,
  NAMECHEAP_ENV.apiKey,
  NAMECHEAP_ENV.userName,
];

/**
 * A real Namecheap catalogue covers four figures of TLDs. Anything below this
 * means we are looking at a partial or filtered response, which must not
 * replace a working dataset.
 */
export const NAMECHEAP_MIN_REGISTER_TLDS = 100;

export interface NamecheapCredentials {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
}

/** Skip reasons, counted per action so a bad payload is diagnosable. */
export type NamecheapSkipReason =
  | 'invalid-tld'
  | 'no-one-year-price'
  | 'missing-currency'
  | 'non-usd-currency'
  | 'missing-retail-price'
  | 'invalid-price'
  | 'duplicate-tld';

export interface NamecheapPrices {
  action: NamecheapAction;
  /** tld → 1-year USD price from `Price` (never `YourPrice`). */
  prices: Map<string, number>;
  skipped: Partial<Record<NamecheapSkipReason, number>>;
}

const TLD_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function bump(counts: Partial<Record<NamecheapSkipReason, number>>, reason: NamecheapSkipReason): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

/** Pull `<Errors><Error Number="…">text</Error></Errors>` out of a response. */
function apiErrors(root: XmlNode): string[] {
  const container = firstChild(root, 'Errors');
  if (!container) return [];
  return elementChildren(container, 'Error').map(node => {
    const number = node.attrs.Number ? `#${node.attrs.Number}` : '';
    const message = node.text.trim();
    return [number, message].filter(Boolean).join(' ') || 'unspecified error';
  });
}

/** The `Price` node for a 1-year term, if the product publishes one. */
function oneYearPrice(product: XmlNode): XmlNode | null {
  const candidates = elementChildren(product, 'Price').filter(
    node => node.attrs.Duration === '1' && node.attrs.DurationType?.toUpperCase() === 'YEAR',
  );
  return candidates[0] ?? null;
}

/**
 * Parse one `getPricing` response.
 *
 * Pure and fixture-testable: no network, no clock. Throws when the response is
 * an API error or does not have the documented shape.
 */
export function parseNamecheapPricing(xml: string, action: NamecheapAction): NamecheapPrices {
  const root = rootElement(parseXml(xml));
  if (root.name !== 'ApiResponse') {
    throw new Error(`Namecheap response root is <${root.name}>, expected <ApiResponse>`);
  }

  const status = root.attrs.Status ?? '';
  if (status.toUpperCase() !== 'OK') {
    const errors = apiErrors(root);
    throw new Error(
      `Namecheap API error (Status=${status || 'missing'})` +
        (errors.length ? `: ${errors.join('; ')}` : ''),
    );
  }

  const commandResponse = firstChild(root, 'CommandResponse');
  const result = commandResponse ? firstChild(commandResponse, 'UserGetPricingResult') : null;
  if (!result) {
    throw new Error('Namecheap response is missing <UserGetPricingResult> — schema changed?');
  }

  const productTypes = elementChildren(result, 'ProductType');
  const productType =
    productTypes.find(node => node.attrs.Name?.toUpperCase() === 'DOMAIN') ?? productTypes[0];
  if (!productType) {
    throw new Error('Namecheap response contains no <ProductType> — schema changed?');
  }

  // The documented example labels the response's categories with the action
  // name (REGISTER / RENEW / …). Prefer the requested one; accept a single
  // category whatever its label; refuse to guess when several are present.
  const categories = elementChildren(productType, 'ProductCategory');
  const wanted = categories.find(node => node.attrs.Name?.toUpperCase() === action);
  let category: XmlNode | undefined = wanted;
  if (!category && categories.length === 1) category = categories[0];
  if (!category) {
    const labels = categories.map(node => node.attrs.Name ?? '(unnamed)').join(', ');
    throw new Error(
      `Namecheap response has no <ProductCategory Name="${action}"> (found: ${labels || 'none'})`,
    );
  }

  const prices = new Map<string, number>();
  const skipped: Partial<Record<NamecheapSkipReason, number>> = {};

  for (const product of elementChildren(category, 'Product')) {
    const tld = (product.attrs.Name ?? '').trim().toLowerCase();
    if (!tld || !TLD_RE.test(tld)) {
      bump(skipped, 'invalid-tld');
      continue;
    }

    const priceNode = oneYearPrice(product);
    if (!priceNode) {
      // Products are listed with 2/5/10-year terms too; we model one year only.
      bump(skipped, 'no-one-year-price');
      continue;
    }

    const currency = (priceNode.attrs.Currency ?? '').trim();
    if (!currency) {
      // Publishing a bare number as USD without the field would be a guess.
      bump(skipped, 'missing-currency');
      continue;
    }
    if (currency.toUpperCase() !== 'USD') {
      bump(skipped, 'non-usd-currency');
      continue;
    }

    const raw = priceNode.attrs.Price;
    if (raw === undefined || raw.trim() === '') {
      // `YourPrice`/`RegularPrice` are present here — deliberately not used.
      bump(skipped, 'missing-retail-price');
      continue;
    }

    let value: number | null;
    try {
      value = normalizePrice(raw);
    } catch {
      bump(skipped, 'invalid-price');
      continue;
    }
    if (value === null || value <= 0) {
      bump(skipped, 'invalid-price');
      continue;
    }
    if (prices.has(tld)) {
      bump(skipped, 'duplicate-tld');
      continue;
    }
    prices.set(tld, value);
  }

  if (prices.size === 0) {
    throw new Error(
      `Namecheap ${action} response contained no usable 1-year USD prices (skipped: ${JSON.stringify(skipped)})`,
    );
  }

  return { action, prices, skipped };
}

/**
 * Fold the three action responses into one offer per TLD.
 *
 * A TLD that only appears in one action keeps `null` for the others — the
 * dataset models "not published" as null and never fills it in.
 */
export function buildNamecheapOffers(
  byAction: Partial<Record<NamecheapAction, NamecheapPrices>>,
  observedAt: string,
): RawOffer[] {
  const tlds = new Set<string>();
  for (const entry of Object.values(byAction)) {
    for (const tld of entry?.prices.keys() ?? []) tlds.add(tld);
  }

  const offers: RawOffer[] = [];
  for (const tld of [...tlds].sort()) {
    const offer: RawOffer = {
      tld,
      registrar_id: 'namecheap',
      registrar_name: 'Namecheap',
      currency: 'USD',
      register_usd: null,
      renewal_usd: null,
      transfer_usd: null,
      // getPricing without a PromotionCode returns the standing price; we do
      // not invent a promotion the source never claimed.
      promotional: false,
      promo_code: null,
      promo_restrictions: null,
      promotion_expires_at: null,
      source_id: NAMECHEAP_SOURCE.id,
      source_url: NAMECHEAP_SOURCE.url,
      purchase_url: null,
      price_observed_at: observedAt,
      price_verified_at: observedAt,
      verification_status: NAMECHEAP_SOURCE.verificationStatus,
      source_status_stale: false,
    };
    for (const action of NAMECHEAP_ACTIONS) {
      const price = byAction[action]?.prices.get(tld);
      if (typeof price === 'number') offer[ACTION_FIELD[action]] = price;
    }
    if (offer.register_usd === null && offer.renewal_usd === null && offer.transfer_usd === null) {
      continue;
    }
    offers.push(offer);
  }
  return offers;
}

/** Build the request URL. The API key travels in the query string — by design. */
export function namecheapUrl(credentials: NamecheapCredentials, action: NamecheapAction): string {
  const url = new URL(NAMECHEAP_ENDPOINT);
  url.searchParams.set('ApiUser', credentials.apiUser);
  url.searchParams.set('ApiKey', credentials.apiKey);
  url.searchParams.set('UserName', credentials.userName);
  url.searchParams.set('ClientIp', credentials.clientIp);
  url.searchParams.set('Command', 'namecheap.users.getPricing');
  url.searchParams.set('ProductType', 'DOMAIN');
  url.searchParams.set('ProductCategory', 'DOMAINS');
  url.searchParams.set('ActionName', action);
  return url.toString();
}

/** Never log a URL containing the API key. */
export function redactNamecheapUrl(url: string): string {
  return url.replace(/([?&]ApiKey=)[^&]*/i, '$1***');
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Namecheap accepts IPv4 only, so an IPv6 value is a configuration error. */
export function isIpv4(value: string): boolean {
  const match = IPV4_RE.exec(value.trim());
  if (!match) return false;
  return match.slice(1).every(part => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export interface ResolvedClientIp {
  ip: string;
  source: 'env' | 'detected';
}

/**
 * Work out which IP Namecheap should see.
 *
 * An explicit `NAMECHEAP_CLIENT_IP` always wins. Otherwise the egress address
 * is detected, because the alternative — sending nothing — is rejected by the
 * API, and because the detected value is exactly what the operator needs in
 * order to fix the allowlist.
 */
export async function resolveClientIp(
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedClientIp> {
  const explicit = (process.env[NAMECHEAP_ENV.clientIp] ?? '').trim();
  if (explicit) {
    if (!isIpv4(explicit)) {
      throw new Error(
        `${NAMECHEAP_ENV.clientIp} must be an IPv4 address (Namecheap rejects IPv6): "${explicit}"`,
      );
    }
    return { ip: explicit, source: 'env' };
  }

  const res = await fetchImpl('https://api.ipify.org?format=json', {
    headers: { accept: 'application/json', 'user-agent': POLITE_USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`could not detect egress IP (HTTP ${res.status})`);
  const payload = (await res.json()) as { ip?: unknown };
  const detected = typeof payload.ip === 'string' ? payload.ip.trim() : '';
  if (!isIpv4(detected)) {
    throw new Error(
      `detected egress address "${detected || 'none'}" is not IPv4 — set ${NAMECHEAP_ENV.clientIp} explicitly`,
    );
  }
  return { ip: detected, source: 'detected' };
}

/** Read credentials from the environment, refusing to run half-configured. */
export function namecheapCredentialsFromEnv(): NamecheapCredentials {
  const apiUser = (process.env[NAMECHEAP_ENV.apiUser] ?? '').trim();
  const apiKey = (process.env[NAMECHEAP_ENV.apiKey] ?? '').trim();
  const userName = (process.env[NAMECHEAP_ENV.userName] ?? '').trim();
  const missing = NAMECHEAP_REQUIRED_ENV.filter(name => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`missing env: ${missing.join(', ')}`);
  }
  return { apiUser, apiKey, userName, clientIp: '' };
}

async function fetchAction(
  credentials: NamecheapCredentials,
  action: NamecheapAction,
  fetchImpl: typeof fetch,
): Promise<NamecheapPrices> {
  const url = namecheapUrl(credentials, action);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      headers: {
        'user-agent': POLITE_USER_AGENT,
        accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new Error(
      `Namecheap ${action} request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Namecheap ${action} HTTP ${res.status}`);
  }
  try {
    return parseNamecheapPricing(body, action);
  } catch (e) {
    // Surface the egress IP on auth failures: it is the allowlist entry the
    // operator has to add, and guessing it from a generic error is miserable.
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${message} [action=${action}, clientIp=${credentials.clientIp}${
        credentials.clientIp ? '' : ', unresolved'
      }]`,
    );
  }
}

/**
 * Fetch and merge all three actions.
 *
 * Sequential on purpose: three requests, one at a time, is well inside the
 * documented limits and keeps a failure attributable to a single action.
 */
export async function fetchNamecheap(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<RawOffer[]> {
  const base = namecheapCredentialsFromEnv();
  const { ip, source } = await resolveClientIp(fetchImpl);
  const credentials: NamecheapCredentials = { ...base, clientIp: ip };
  if (source === 'detected') {
    console.log(
      `[sync-prices] namecheap: egress IPv4 ${ip} detected — it must be on the account's API allowlist`,
    );
  }

  const byAction: Partial<Record<NamecheapAction, NamecheapPrices>> = {};
  for (const action of NAMECHEAP_ACTIONS) {
    byAction[action] = await fetchAction(credentials, action, fetchImpl);
  }

  const observedAt = now.toISOString();
  const offers = buildNamecheapOffers(byAction, observedAt);

  const registerRows = offers.filter(offer => offer.register_usd !== null).length;
  if (registerRows < NAMECHEAP_MIN_REGISTER_TLDS) {
    throw new Error(
      `Namecheap returned only ${registerRows} registration prices ` +
        `(expected at least ${NAMECHEAP_MIN_REGISTER_TLDS}) — refusing to publish`,
    );
  }

  return offers;
}
