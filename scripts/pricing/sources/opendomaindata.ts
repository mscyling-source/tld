/**
 * Source adapter: Open Domain Data — tld_pricing dataset.
 *
 * URL:      https://www.opendomaindata.org/api/tld_pricing.json (bulk JSON)
 * Licence:  CC BY 4.0 — citation: "Open Domain Data (2026). tld_pricing,
 *           opendomaindata.org/datasets/tld-pricing" (rendered on the site).
 * Cadence:  monthly snapshot (records carry their own last_checked, often
 *           several weeks old — freshness classification handles that).
 * Coverage: 7 registrars (Cloudflare, Dynadot, GoDaddy, Namecheap, Porkbun,
 *           Spaceship, Squarespace) — adds GoDaddy/Namecheap/Spaceship/
 *           Squarespace, which no other source covers.
 * Fields:   register_usd, renew_usd, transfer_usd (nullable), promotional
 *           flag, sources[], verification_status, per-record last_checked.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { toIsoDate } from '../http.js';

export const ODD_SOURCE = {
  id: 'opendomaindata',
  name: 'Open Domain Data',
  url: 'https://www.opendomaindata.org/datasets/tld-pricing',
  license: 'CC BY 4.0',
  attribution: 'Open Domain Data (2026). tld_pricing, opendomaindata.org — licensed CC BY 4.0',
  priority: 2, // monthly snapshot — wins only when strictly fresher than the others
  // Monthly snapshot. Per-record dates are kept as observation dates; a record
  // that declares itself verified upstream keeps that claim, but a record with
  // no usable date becomes `unverified` rather than borrowing the fetch time.
  verificationStatus: 'source_snapshot' as VerificationStatus,
};

export const ODD_PRICING_URL = 'https://www.opendomaindata.org/api/tld_pricing.json';

/** Open Domain Data registrar ids → our canonical ids. */
const REGISTRAR_ID_MAP: Record<string, string> = {
  'cloudflare-registrar': 'cloudflare',
  'squarespace-domains': 'squarespace',
};

export interface OddRow {
  registrar_id?: string;
  tld?: string;
  register_usd?: number | string | null;
  renew_usd?: number | string | null;
  transfer_usd?: number | string | null;
  promotional?: boolean;
  sources?: string[];
  verification_status?: string;
  last_checked?: string;
  source_url?: string;
}

export interface OddPayload {
  dataset?: string;
  license?: string;
  currency?: string;
  records?: OddRow[];
}

/** Pure parse of an Open Domain Data payload (fixture-testable). */
export function parseOdd(payload: OddPayload): { offers: RawOffer[]; skipped: number } {
  if (!payload || payload.dataset !== 'tld_pricing' || !Array.isArray(payload.records)) {
    throw new Error('Open Domain Data payload invalid (missing dataset/records)');
  }
  if (payload.currency && payload.currency !== 'USD') {
    // Dataset header declares a non-USD basis — every row would need FX.
    throw new Error(`Open Domain Data currency not normalised to USD: ${payload.currency}`);
  }
  const offers: RawOffer[] = [];
  let skipped = 0;

  for (const row of payload.records) {
    if (!row || typeof row.registrar_id !== 'string' || typeof row.tld !== 'string') {
      skipped++;
      continue;
    }
    const registrarId = REGISTRAR_ID_MAP[row.registrar_id] ?? row.registrar_id;
    if (!registrars[registrarId]) {
      skipped++; // unknown registrar — not merged under a guessed identity
      continue;
    }
    const tld = row.tld.replace(/^\.+/, '').toLowerCase();
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
    const register = safePrice(row.register_usd, 'register_usd');
    const renewal = safePrice(row.renew_usd, 'renew_usd');
    const transfer = safePrice(row.transfer_usd, 'transfer_usd');

    // The record's own date is the observation date. A record with no usable
    // date stays `unverified` — it never inherits the fetch timestamp.
    const observedAt = toIsoDate(row.last_checked);
    const upstreamStatus = (row.verification_status ?? '').trim().toLowerCase();
    const declaredVerified = upstreamStatus === 'verified' || upstreamStatus === 'verified_primary';
    const verificationStatus: VerificationStatus = observedAt
      ? declaredVerified
        ? 'verified'
        : ODD_SOURCE.verificationStatus
      : 'unverified';

    offers.push({
      tld,
      registrar_id: registrarId,
      registrar_name: registrars[registrarId].name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional: row.promotional === true,
      promo_code: null, // dataset publishes no codes — never invent one
      promo_restrictions: null,
      promotion_expires_at: null,
      source_id: ODD_SOURCE.id,
      source_url:
        typeof row.source_url === 'string' && /^https?:\/\//.test(row.source_url)
          ? row.source_url
          : ODD_SOURCE.url,
      purchase_url: null, // resolved from the registrar registry at sync time
      price_observed_at: observedAt,
      // Upstream attests it read the figure from the registrar; we did not
      // verify it ourselves, so we keep its observation date as the evidence.
      price_verified_at: null,
      verification_status: verificationStatus,
      source_status_stale: false,
      invalid_fields: invalid.length ? invalid : undefined,
    });
  }
  return { offers, skipped };
}

/** Network fetch for the sync pipeline. */
export async function fetchOdd(): Promise<RawOffer[]> {
  const res = await fetch(ODD_PRICING_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Open Domain Data HTTP ${res.status}`);
  const payload = (await res.json()) as OddPayload;
  return parseOdd(payload).offers;
}
