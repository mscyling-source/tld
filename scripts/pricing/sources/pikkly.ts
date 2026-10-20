/**
 * Source adapter: Pikkly open dataset — domain prices.
 *
 * URL:      https://pikkly.dev/data/domains/prices.json (static JSON)
 * Licence:  CC BY 4.0 — attribution required: "Price data by Pikkly"
 *           with a link to https://pikkly.dev (rendered on the site and in
 *           data/prices.json source metadata).
 * Cadence:  rebuilt daily.
 * Coverage: 6 registrars (Porkbun, Cloudflare, Dynadot, Gandi, Hover, IONOS),
 *           ~3,300 TLD rows; fields first_year_usd / renewal_usd / transfer_usd.
 *
 * Freshness handled conservatively:
 *   - rows sourced from a dated dump (meta.dump_date, e.g. Cloudflare's
 *     community price dump) use THAT date as last_checked, not the daily
 *     rebuild time;
 *   - rows the source itself flags `stale` are pinned stale (never
 *     re-verified by our rebuild);
 *   - rows flagged `unavailable` (source down, null value) are skipped —
 *     they must not overwrite good previous data.
 */

import type { RawOffer } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';

export const PIKKLY_SOURCE = {
  id: 'pikkly',
  name: 'Pikkly open data',
  url: 'https://pikkly.dev/data',
  license: 'CC BY 4.0',
  attribution: 'Price data by Pikkly (https://pikkly.dev)',
  priority: 1,
};

export const PIKKLY_PRICES_URL = 'https://pikkly.dev/data/domains/prices.json';

export interface PikklyRow {
  id?: string;
  provider?: string;
  product?: string;
  sku?: string;
  price_usd?: number | string | null;
  currency_original?: string;
  price_original?: number | null;
  first_year_usd?: number | string | null;
  renewal_usd?: number | string | null;
  transfer_usd?: number | string | null;
  source_url?: string;
  source?: string;
  last_checked?: string;
  status?: string;
  meta?: { dump_date?: string; note?: string; [k: string]: unknown };
}

export interface PikklyPayload {
  dataset?: string;
  generated_at?: string;
  license?: string;
  records?: PikklyRow[];
}

/** Map a Pikkly provider id onto our canonical registrar id. */
function canonicalRegistrarId(provider: string): string | null {
  return registrars[provider] ? provider : null;
}

/** Pure parse of a Pikkly domains payload (fixture-testable). */
export function parsePikkly(payload: PikklyPayload): { offers: RawOffer[]; skipped: number } {
  if (!payload || payload.dataset !== 'domains' || !Array.isArray(payload.records)) {
    throw new Error('Pikkly domains payload invalid (missing dataset/records)');
  }
  const offers: RawOffer[] = [];
  let skipped = 0;

  for (const row of payload.records) {
    if (!row || row.product !== 'domain') {
      skipped++;
      continue;
    }
    // Source flagged: down / value null — must not replace known-good data.
    if (row.status === 'unavailable') {
      skipped++;
      continue;
    }
    const provider = typeof row.provider === 'string' ? row.provider : '';
    const registrarId = canonicalRegistrarId(provider);
    if (!registrarId) {
      skipped++; // unknown provider — not merged under a guessed identity
      continue;
    }
    const rawSku = typeof row.sku === 'string' ? row.sku : '';
    const tld = rawSku.replace(/^\.+/, '').toLowerCase();
    if (!tld) {
      skipped++;
      continue;
    }

    const invalid: string[] = [];
    const safePrice = (v: unknown, field: string): number | null => {
      try {
        return normalizePrice(v);
      } catch {
        invalid.push(field);
        return null;
      }
    };
    const register = safePrice(row.first_year_usd, 'first_year_usd');
    const renewal = safePrice(row.renewal_usd, 'renewal_usd');
    const transfer = safePrice(row.transfer_usd, 'transfer_usd');

    // Effective check date: prefer the dated dump (conservative) over the
    // daily rebuild timestamp.
    const dumpDate = typeof row.meta?.dump_date === 'string' ? row.meta.dump_date : null;
    const lastChecked = dumpDate && !Number.isNaN(Date.parse(dumpDate)) ? dumpDate : (row.last_checked ?? '');

    offers.push({
      tld,
      registrar_id: registrarId,
      registrar_name: registrars[registrarId].name,
      currency: 'USD', // price_usd is the dataset's USD-normalised figure
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      // Pikkly does not flag promos per row — never guess one.
      promotional: false,
      promo_code: null,
      promo_restrictions: null,
      source_id: PIKKLY_SOURCE.id,
      source_url: typeof row.source_url === 'string' && row.source_url ? row.source_url : PIKKLY_SOURCE.url,
      purchase_url: null, // resolved from the registrar registry at sync time
      last_checked: lastChecked,
      source_status_stale: row.status === 'stale',
      invalid_fields: invalid.length ? invalid : undefined,
    });
  }
  return { offers, skipped };
}

/** Network fetch for the sync pipeline. */
export async function fetchPikkly(): Promise<RawOffer[]> {
  const res = await fetch(PIKKLY_PRICES_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Pikkly prices HTTP ${res.status}`);
  const payload = (await res.json()) as PikklyPayload;
  return parsePikkly(payload).offers;
}
