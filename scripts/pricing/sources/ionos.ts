/**
 * Source adapter: IONOS — official price list, server-embedded JSON.
 *
 * URL:      https://www.ionos.com/domains/domain-name-prices
 * Access:   robots.txt disallows print/detail/tariff-select endpoints only; the
 *           price list is allowed. Plain GET, no JavaScript execution, no
 *           authentication, no anti-bot bypass.
 * Method:   the page is a Next.js app whose full price table is embedded in
 *           `__NEXT_DATA__` under `componentsWithPrices[].domainPrices`.
 *
 * Column semantics (the page's own column notes define them):
 *   welcomeOffer     first-year price limited to a first-time purchase
 *   specialOffer     first-year price for existing customers buying more
 *   regularRenewalFee the standard per-year renewal — this is `renewal_usd`
 *   domainTransfer   the transfer-in price — this is `transfer_usd`
 *   bundlePrice      a discounted multi-domain bundle, not a single-domain
 *                    price, so it is never used as the register figure
 * We take `welcomeOffer` as the registration price when present and fall back
 * to the standard fee, never to the bundle price.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { fetchText } from '../http.js';

export const IONOS_SOURCE = {
  id: 'ionos',
  name: 'IONOS domain price list',
  url: 'https://www.ionos.com/domains/domain-name-prices',
  license: 'Publicly published pricing page (read-only access)',
  attribution: 'Prices read from IONOS’s published domain price list at ionos.com',
  priority: 0,
  verificationStatus: 'verified' as VerificationStatus,
};

export const IONOS_PRICES_URL = 'https://www.ionos.com/domains/domain-name-prices';

interface IonosEntry {
  title?: string;
  prices?: {
    welcomeOffer?: number | string | null;
    specialOffer?: number | string | null;
    bundlePrice?: number | string | null;
    regularRenewalFee?: number | string | null;
    domainTransfer?: number | string | null;
    icannFee?: string | null;
  };
}

/** Pure parse of the official page HTML. */
export function parseIonos(html: string, verifiedAt: string): RawOffer[] {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error('IONOS price list has no __NEXT_DATA__ payload');
  let next: { props?: { pageProps?: { componentsWithPrices?: Array<{ content?: Record<string, unknown> }> } } };
  try {
    next = JSON.parse(match[1]);
  } catch {
    throw new Error('IONOS __NEXT_DATA__ payload is not valid JSON');
  }
  const components = next.props?.pageProps?.componentsWithPrices ?? [];

  let entries: IonosEntry[] = [];
  for (const component of components) {
    for (const value of Object.values(component.content ?? {})) {
      if (
        Array.isArray(value) &&
        value.length > 50 &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        'prices' in (value[0] as IonosEntry)
      ) {
        entries = value as IonosEntry[];
        break;
      }
    }
    if (entries.length > 0) break;
  }
  if (entries.length === 0) throw new Error('IONOS payload contained no domainPrices table');

  const offers: RawOffer[] = [];
  for (const entry of entries) {
    const tld = (entry.title ?? '').replace(/^\.+/, '').toLowerCase();
    if (!tld || !entry.prices) continue;
    const p = entry.prices;

    let welcome: number | null;
    let special: number | null;
    let renewal: number | null;
    let transfer: number | null;
    try {
      welcome = normalizePrice(p.welcomeOffer);
      special = normalizePrice(p.specialOffer);
      renewal = normalizePrice(p.regularRenewalFee);
      transfer = normalizePrice(p.domainTransfer);
    } catch {
      continue;
    }

    // The bundle price is not a single-domain price; never use it here.
    const register = welcome ?? special;
    if (register === null && renewal === null && transfer === null) continue;

    const promotional = register !== null && renewal !== null && register < renewal;
    const restrictions = promotional
      ? welcome !== null && welcome < (special ?? welcome)
        ? 'First-year welcome offer for a first-time purchase; standard rate applies on renewal.'
        : 'First-year promotional price for existing customers; standard rate applies on renewal.'
      : null;

    offers.push({
      tld,
      registrar_id: 'ionos',
      registrar_name: registrars.ionos.name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional,
      promo_code: null,
      promo_restrictions: restrictions,
      promotion_expires_at: null, // IONOS publishes no end date — never invent one
      source_id: IONOS_SOURCE.id,
      source_url: IONOS_PRICES_URL,
      purchase_url: null,
      price_observed_at: verifiedAt,
      price_verified_at: verifiedAt,
      verification_status: IONOS_SOURCE.verificationStatus,
      source_status_stale: false,
    });
  }

  if (offers.length < 100) throw new Error(`IONOS payload yielded only ${offers.length} usable rows`);
  return offers;
}

export async function fetchIonos(now: Date = new Date()): Promise<RawOffer[]> {
  const html = await fetchText(IONOS_PRICES_URL);
  return parseIonos(html, now.toISOString());
}