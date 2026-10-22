/**
 * Source adapter: Hover — official pricing page, server-embedded JSON.
 *
 * URL:      https://www.hover.com/domain-pricing
 * Access:   robots.txt disallows only search results, the welcome/thank-you
 *           pages and /api/dns; the pricing page is allowed. Plain GET, no
 *           JavaScript execution, no authentication, no anti-bot bypass.
 * Method:   the page ships its price table as a `data-props` JSON attribute
 *           used to hydrate the client component. We read that JSON directly.
 *
 * Payload semantics (verified against a second independent CC BY dataset and
 * against Hover's own rendered table):
 *   `prices[tld]` is an array whose first entry is a flag and whose remaining
 *   entries are money values in registration → renewal → transfer order. When
 *   a TLD is on a first-year offer the array is longer (e.g. `me` =
 *   [flag, 8.99, 24.99, 24.99, 24.99, 24.99, 24.99]): the first money value is
 *   the promotional first-year price and the second is the standard renewal
 *   rate. We read positions 1/2/3, which is exactly what the page renders.
 *   The leading flag marks availability, not price; we never treat it as money.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { decodeEntities, fetchText } from '../http.js';

export const HOVER_SOURCE = {
  id: 'hover',
  name: 'Hover pricing page',
  url: 'https://www.hover.com/domain-pricing',
  license: 'Publicly published pricing page (read-only access)',
  attribution: 'Prices read from Hover’s published domain pricing page at hover.com',
  priority: 0,
  verificationStatus: 'verified' as VerificationStatus,
};

export const HOVER_PRICING_URL = 'https://www.hover.com/domain-pricing';

interface HoverPayload {
  prices?: Record<string, unknown[]>;
}

/** Pure parse of the official page HTML. */
export function parseHover(html: string, verifiedAt: string): RawOffer[] {
  const match = html.match(/data-props='([^']*)'/);
  if (!match) throw new Error('Hover pricing page has no data-props payload');
  let payload: HoverPayload;
  try {
    payload = JSON.parse(decodeEntities(match[1])) as HoverPayload;
  } catch {
    throw new Error('Hover data-props payload is not valid JSON');
  }
  const prices = payload.prices;
  if (!prices || typeof prices !== 'object') throw new Error('Hover payload has no prices object');

  const offers: RawOffer[] = [];
  for (const [rawTld, values] of Object.entries(prices)) {
    if (!Array.isArray(values) || values.length < 4) continue;
    const tld = rawTld.replace(/^\.+/, '').toLowerCase();
    if (!tld) continue;

    // values[0] is an availability flag, never a price.
    const money = values.slice(1, 4);
    if (!money.every(v => typeof v === 'number')) continue;

    let register: number | null;
    let renewal: number | null;
    let transfer: number | null;
    try {
      [register, renewal, transfer] = money.map(v => normalizePrice(v));
    } catch {
      continue;
    }
    if (register === null && renewal === null && transfer === null) continue;

    // A longer array plus a first-year figure below the renewal rate means the
    // registration price is a promotion, which is how Hover presents it.
    const promotional = register !== null && renewal !== null && register < renewal;

    offers.push({
      tld,
      registrar_id: 'hover',
      registrar_name: registrars.hover.name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional,
      promo_code: null,
      promo_restrictions: promotional
        ? 'First-year promotional price; Hover’s standard renewal rate applies from year 2.'
        : null,
      promotion_expires_at: null, // Hover publishes no end date — never invent one
      source_id: HOVER_SOURCE.id,
      source_url: HOVER_PRICING_URL,
      purchase_url: null,
      price_observed_at: verifiedAt,
      price_verified_at: verifiedAt,
      verification_status: HOVER_SOURCE.verificationStatus,
      source_status_stale: false,
    });
  }

  if (offers.length < 100) {
    throw new Error(`Hover payload yielded only ${offers.length} usable rows`);
  }
  return offers;
}

export async function fetchHover(now: Date = new Date()): Promise<RawOffer[]> {
  const html = await fetchText(HOVER_PRICING_URL);
  return parseHover(html, now.toISOString());
}