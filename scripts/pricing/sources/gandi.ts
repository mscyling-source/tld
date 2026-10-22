/**
 * Source adapter: Gandi — official price list, server-rendered HTML table.
 *
 * URL:      https://www.gandi.net/en-US/domain/tld?prefix=<letter>
 * Access:   robots.txt disallows paths ending in "/prices" and any query string
 *           of the form "?tld=", but the per-letter TLD listing pages are
 *           allowed and are the canonical published price list. Plain GET with
 *           a descriptive UA, one request per letter with a short delay; no
 *           JavaScript execution, no auth, no anti-bot bypass.
 * Method:   the table is fully server-rendered, so we read the rows directly.
 *           Columns are TLD · Creation · Transfer · Renewal · Owner change ·
 *           Restore (the en-US storefront quotes USD).
 * Coverage: ~1,000 TLDs across 27 prefix pages (a–z plus `xn--`).
 *
 * Promotions: a promoted TLD prints `Promo <struck> <current>` in the Creation
 * cell. We take the current (promotional) figure and record that a promotion
 * applies, exactly as the page presents it.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { fetchText, htmlToText, sleep } from '../http.js';

export const GANDI_SOURCE = {
  id: 'gandi',
  name: 'Gandi price list',
  url: 'https://www.gandi.net/en-US/domain/tld',
  license: 'Publicly published price list (read-only access)',
  attribution: 'Prices read from Gandi’s published TLD price list at gandi.net',
  priority: 0,
  verificationStatus: 'verified' as VerificationStatus,
};

export const GANDI_TLD_BASE = 'https://www.gandi.net/en-US/domain/tld';

/** Letters Gandi splits its list by, plus the IDN prefix. */
export const GANDI_PREFIXES: string[] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  'xn--',
];

/** Delay between prefix requests — one page per second is well inside normal use. */
const REQUEST_DELAY_MS = 1_000;

/** Pure parse of one prefix page. */
export function parseGandiPage(html: string, verifiedAt: string): RawOffer[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g);
  if (!rows || rows.length === 0) throw new Error('Gandi price page has no table rows');

  const offers: RawOffer[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? []).map(htmlToText);
    if (cells.length < 4) continue;
    const tldCell = cells[0].trim();
    if (!tldCell.startsWith('.')) continue;
    const tld = tldCell.replace(/^\.+/, '').toLowerCase();
    if (!tld || seen.has(tld)) continue;

    const creationRaw = cells[1] ?? '';
    const transferRaw = cells[2] ?? '';
    const renewalRaw = cells[3] ?? '';

    // A promoted row prints "Promo $34.84 $15.99": the LAST money value is the
    // current price, the earlier one is the struck regular price.
    const promotional = /\bpromo\b/i.test(creationRaw);
    const moneyValues = (cell: string): string[] =>
      (htmlToText(cell).match(/\$[\d,]+(?:\.\d+)?/g) ?? []);
    const lastMoney = (cell: string): string | null => {
      const values = moneyValues(cell);
      return values.length > 0 ? values[values.length - 1] : null;
    };

    let register: number | null;
    let renewal: number | null;
    let transfer: number | null;
    try {
      register = normalizePrice(lastMoney(creationRaw));
      renewal = normalizePrice(lastMoney(renewalRaw));
      transfer = normalizePrice(lastMoney(transferRaw));
    } catch {
      continue;
    }
    if (register === null && renewal === null && transfer === null) continue;

    offers.push({
      tld,
      registrar_id: 'gandi',
      registrar_name: registrars.gandi.name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional,
      promo_code: null,
      promo_restrictions: promotional
        ? 'First-year promotional price published on Gandi’s price list; standard rate applies on renewal.'
        : null,
      promotion_expires_at: null, // Gandi publishes no end date — never invent one
      source_id: GANDI_SOURCE.id,
      source_url: `${GANDI_TLD_BASE}?prefix=${tld.charAt(0)}`,
      purchase_url: null,
      price_observed_at: verifiedAt,
      price_verified_at: verifiedAt,
      verification_status: GANDI_SOURCE.verificationStatus,
      source_status_stale: false,
    });
    seen.add(tld);
  }

  // Sanity: a page that yields nothing means our parsing broke, not that the
  // registrar stopped selling — fail loudly so last-known-good data survives.
  if (offers.length < 5) throw new Error(`Gandi page yielded only ${offers.length} rows`);
  return offers;
}

export async function fetchGandi(now: Date = new Date()): Promise<RawOffer[]> {
  const verifiedAt = now.toISOString();
  const byTld = new Map<string, RawOffer>();
  let failures = 0;

  for (const prefix of GANDI_PREFIXES) {
    const url = `${GANDI_TLD_BASE}?prefix=${encodeURIComponent(prefix)}`;
    try {
      const html = await fetchText(url);
      for (const offer of parseGandiPage(html, verifiedAt)) {
        if (!byTld.has(offer.tld)) byTld.set(offer.tld, offer);
      }
    } catch {
      failures++;
    }
    if (prefix !== GANDI_PREFIXES[GANDI_PREFIXES.length - 1]) await sleep(REQUEST_DELAY_MS);
  }

  if (byTld.size === 0) {
    throw new Error(`Gandi: every prefix page failed (${failures}/${GANDI_PREFIXES.length})`);
  }
  // Losing a handful of letter pages is tolerable and logged by the caller via
  // row counts; losing everything is not.
  return [...byTld.values()];
}