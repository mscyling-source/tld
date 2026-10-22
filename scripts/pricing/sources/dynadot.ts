/**
 * Source adapter: Dynadot — official pricing page, server-rendered payload.
 *
 * URL:      https://www.dynadot.com/domain/prices
 * Access:   robots.txt disallows only /market/* and the /domain/*search*
 *           endpoints; /domain/prices is allowed. Plain GET, no JavaScript
 *           execution, no authentication, no anti-bot bypass.
 * Method:   Dynadot is a Nuxt 3 app that ships its whole catalogue in a
 *           `<script id="__NUXT_DATA__">` devalue payload. We decode that
 *           payload rather than scraping rendered text, so the figures are
 *           exactly the ones the page renders.
 * Coverage: the full catalogue (~820 TLDs) in a single request, with
 *           reg_price / renew_price / tr_price and restriction notes.
 *
 * Because we read this from Dynadot's own page, rows are `verified` and carry
 * the actual read time in `price_verified_at` — which is the whole point of
 * separating that from the fetch/observation dates used by snapshot sources.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { fetchText } from '../http.js';

export const DYNADOT_SOURCE = {
  id: 'dynadot',
  name: 'Dynadot pricing page',
  url: 'https://www.dynadot.com/domain/prices',
  license: 'Publicly published pricing page (read-only access)',
  attribution: 'Prices read from Dynadot’s published price list at dynadot.com',
  priority: 0,
  verificationStatus: 'verified' as VerificationStatus,
};

export const DYNADOT_PRICES_URL = 'https://www.dynadot.com/domain/prices';

/** Values Dynadot uses as "no such figure published". */
const EMPTY_TOKENS = new Set(['-1', '-', '', 'n/a', 'free']);

interface DynadotRow {
  name?: string;
  name_utf?: string;
  reg_price?: string | number;
  renew_price?: string | number;
  tr_price?: string | number;
  original_reg_price?: string | number;
  restrictions?: string;
}

/**
 * Decode Nuxt's `__NUXT_DATA__` devalue array into plain JS values.
 *
 * devalue flattens a value graph into an array where every object/array entry
 * is referenced by index; negative indices encode special values. Pure and
 * unit-testable against a captured payload.
 */
export function decodeDevalue(payload: unknown): unknown {
  if (!Array.isArray(payload)) return null;
  const arr = payload as unknown[];
  const hydrate = (index: number, depth: number): unknown => {
    if (depth > 60) return null;
    if (typeof index !== 'number' || !Number.isInteger(index)) return null;
    if (index < 0 || index >= arr.length) return null;
    const value = arr[index];
    if (Array.isArray(value)) return value.map(v => (typeof v === 'number' ? hydrate(v, depth + 1) : v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = typeof v === 'number' ? hydrate(v, depth + 1) : v;
      }
      return out;
    }
    return value;
  };
  return hydrate(0, 0);
}

/** Locate the `current_tlds` catalogue inside the decoded payload. */
export function findTldCatalogue(root: unknown): DynadotRow[] {
  const found: DynadotRow[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 25 || !node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      // A catalogue is a large array whose first element has reg_price.
      if (
        node.length > 50 &&
        typeof node[0] === 'object' &&
        node[0] !== null &&
        'reg_price' in (node[0] as DynadotRow)
      ) {
        found.push(...(node as DynadotRow[]));
        return;
      }
      for (const child of node) walk(child, depth + 1);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) walk(value, depth + 1);
  };
  walk(root, 0);
  if (found.length === 0) throw new Error('Dynadot payload: no TLD catalogue found');
  return found;
}

/** Pure parse of the official page HTML. */
export function parseDynadot(html: string, verifiedAt: string): RawOffer[] {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Dynadot page has no __NUXT_DATA__ payload');
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    throw new Error('Dynadot __NUXT_DATA__ payload is not valid JSON');
  }
  const catalogue = findTldCatalogue(decodeDevalue(payload));

  const offers: RawOffer[] = [];
  for (const row of catalogue) {
    const tld = (row.name ?? '').replace(/^\.+/, '').toLowerCase();
    if (!tld) continue;
    if (!registrars.dynadot) continue;

    const price = (value: unknown): number | null => {
      if (typeof value === 'number') return normalizePrice(value);
      if (typeof value !== 'string') return null;
      if (EMPTY_TOKENS.has(value.trim().toLowerCase())) return null;
      return normalizePrice(value);
    };

    let register: number | null;
    let renewal: number | null;
    let transfer: number | null;
    try {
      register = price(row.reg_price);
      renewal = price(row.renew_price);
      transfer = price(row.tr_price);
    } catch {
      continue; // an unparsable figure makes the whole row untrustworthy
    }
    if (register === null && renewal === null && transfer === null) continue;

    // Dynadot prints a struck original price when the current one is reduced;
    // that difference is exactly what makes the registration figure promotional.
    let promotional = false;
    try {
      const original = price(row.original_reg_price);
      promotional = original !== null && register !== null && original > register;
    } catch {
      promotional = false;
    }

    const restrictions = (row.restrictions ?? '').trim();

    offers.push({
      tld,
      registrar_id: 'dynadot',
      registrar_name: registrars.dynadot.name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional,
      promo_code: null,
      promo_restrictions: restrictions && restrictions !== '-' ? restrictions : null,
      promotion_expires_at: null, // Dynadot publishes no end date — never invent one
      source_id: DYNADOT_SOURCE.id,
      source_url: `https://www.dynadot.com/domain/search?domain=${tld}`,
      purchase_url: null,
      // Read from Dynadot's own page right now: this is a real verification.
      price_observed_at: verifiedAt,
      price_verified_at: verifiedAt,
      verification_status: DYNADOT_SOURCE.verificationStatus,
      source_status_stale: false,
    });
  }
  if (offers.length === 0) throw new Error('Dynadot payload contained no usable prices');
  return offers;
}

export async function fetchDynadot(now: Date = new Date()): Promise<RawOffer[]> {
  const html = await fetchText(DYNADOT_PRICES_URL);
  return parseDynadot(html, now.toISOString());
}