/**
 * Source adapter: best-domain-registrars.com factual pricing datasets.
 *
 * URL:      https://www.best-domain-registrars.com/data/pricing.csv
 *           https://www.best-domain-registrars.com/data/verification-status.json
 * Licence:  CC BY 4.0 (the site states this per endpoint) — attribution
 *           required, rendered on /data-sources/ and stored in the dataset.
 * Access:   robots.txt is `User-agent: * / Allow: /`; CORS is `*`; the
 *           datasets are published precisely for third-party reuse.
 *
 * Why this source matters
 *   It is the only openly licensed dataset that ships its own *verification
 *   taxonomy* per registrar, so we can tell a figure read from a registrar's
 *   own price list apart from a modelled one and from placeholder sample data.
 *   Two rows the previous dataset presented as verified facts are exposed here:
 *     - Squarespace rows are `sample` (placeholder, upstream read was blocked)
 *     - Cloudflare rows are `model_confirmed` (derived from the at-cost policy)
 *   We therefore map the taxonomy onto `verification_status` and DROP the
 *   `sample` rows entirely rather than publishing numbers nobody verified.
 *   Upstream `verified` becomes our `source_snapshot`: it attests that the
 *   publisher read the registrar, not that *we* did, and we never claim a
 *   first-party read we did not perform.
 *
 * Every row keeps the dataset's own `last_checked` as `price_observed_at`, so
 * a snapshot from May is never displayed as though we read it today.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';
import { registrars } from '../../../src/config/registrars.js';
import { fetchJson, fetchText, parseCsv, toIsoDate } from '../http.js';

export const BDR_SOURCE = {
  id: 'bestdomainregistrars',
  name: 'Best Domain Registrars open pricing data',
  url: 'https://www.best-domain-registrars.com/data/',
  license: 'CC BY 4.0',
  attribution: 'Pricing data by Best Domain Registrars (CC BY 4.0) — best-domain-registrars.com',
  priority: 3,
  verificationStatus: 'source_snapshot' as VerificationStatus,
};

export const BDR_PRICING_URL = 'https://www.best-domain-registrars.com/data/pricing.csv';
export const BDR_VERIFICATION_URL =
  'https://www.best-domain-registrars.com/data/verification-status.json';

/** Upstream registrar ids → our canonical ids. */
const REGISTRAR_ID_MAP: Record<string, string> = {
  'cloudflare-registrar': 'cloudflare',
  'squarespace-domains': 'squarespace',
};

/**
 * Upstream verification statuses that must never reach the site as prices.
 * `sample` rows are placeholders the upstream pipeline could not read from a
 * primary source; publishing them would be exactly the "fabricated completeness"
 * this project forbids.
 */
const REJECTED_STATUSES = new Set(['sample']);

export interface BdrRow {
  registrar_id?: string;
  registrar_name?: string;
  tld?: string;
  first_year_price?: string;
  renewal_price?: string;
  transfer_price?: string;
  currency?: string;
  last_checked?: string;
  source_url?: string;
  restrictions?: string;
}

export interface BdrVerificationEntry {
  id?: string;
  status?: string;
  citable?: boolean;
  verification_status?: string | null;
  verification_summary?: string | null;
  pricing_last_checked?: string | null;
}

export interface BdrVerification {
  registrars?: Record<string, BdrVerificationEntry> | BdrVerificationEntry[];
}

export interface ParsedBdr {
  offers: RawOffer[];
  skipped: number;
  /** registrar id → upstream status, for the sync report. */
  statuses: Record<string, string>;
  oldestObservedAt: string | null;
}

/**
 * Map an upstream verification status onto our controlled vocabulary.
 *
 * Important: BDR's `verified` means *the publisher* read the registrar's price.
 * That is a third-party attestation, not a read performed by us, so it maps to
 * `source_snapshot` — calling it `verified` would let someone else's claim
 * masquerade as our own first-party read, and validation would (correctly)
 * reject it for having no `price_verified_at`.
 *
 * `model_confirmed` maps to `model_derived`, which is exactly the distinction
 * the publisher is drawing. `sample` rows are placeholder data and are dropped
 * before this value is used.
 */
export function mapVerificationStatus(upstream: string | undefined | null): VerificationStatus {
  switch ((upstream ?? '').trim()) {
    case 'verified':
    case 'source_snapshot':
      return 'source_snapshot';
    case 'model_confirmed':
      return 'model_derived';
    case 'no_pricing_published':
      return 'unverified';
    case 'sample':
    case 'unverified':
    case '':
    case undefined:
    case null:
      return 'unverified';
    default:
      return 'source_snapshot';
  }
}

/** Pure parse of the pricing CSV joined with the verification taxonomy. */
export function parseBdr(csvText: string, verification?: BdrVerification): ParsedBdr {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('Best Domain Registrars pricing CSV is empty');

  const byId = new Map<string, BdrVerificationEntry>();
  const regs = verification?.registrars;
  if (regs && !Array.isArray(regs)) {
    for (const [id, entry] of Object.entries(regs)) byId.set(id, entry);
  } else if (Array.isArray(regs)) {
    for (const entry of regs) if (entry?.id) byId.set(entry.id, entry);
  }

  const offers: RawOffer[] = [];
  const statuses: Record<string, string> = {};
  const seen = new Set<string>();
  let skipped = 0;
  let oldest: string | null = null;

  for (const row of rows as BdrRow[]) {
    const rawRegistrar = typeof row.registrar_id === 'string' ? row.registrar_id : '';
    const registrarId = REGISTRAR_ID_MAP[rawRegistrar] ?? rawRegistrar;
    if (!registrarId || !registrars[registrarId]) {
      skipped++;
      continue;
    }
    // Rows for registrars we do not list are simply not our business.
    if (!Object.values(REGISTRAR_ID_MAP).includes(registrarId) &&
        !Object.keys(registrars).includes(registrarId)) {
      skipped++;
      continue;
    }

    const entry = byId.get(rawRegistrar);
    const upstreamStatus = entry?.status ?? entry?.verification_status ?? '';
    statuses[registrarId] = upstreamStatus || statuses[registrarId] || 'unknown';

    // Placeholder rows are dropped, never published.
    if (upstreamStatus && REJECTED_STATUSES.has(upstreamStatus.trim())) {
      skipped++;
      continue;
    }

    const tld = (row.tld ?? '').replace(/^\.+/, '').toLowerCase();
    if (!tld) {
      skipped++;
      continue;
    }
    const key = `${registrarId}|${tld}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }

    const invalid: string[] = [];
    const safe = (v: unknown, field: string): number | null => {
      try {
        return normalizePrice(v);
      } catch {
        invalid.push(field);
        return null;
      }
    };
    const register = safe(row.first_year_price, 'first_year_price');
    const renewal = safe(row.renewal_price, 'renewal_price');
    const transfer = safe(row.transfer_price, 'transfer_price');
    if (invalid.length > 0) {
      // Garbage in one figure casts doubt on the whole quote.
      skipped++;
      continue;
    }
    if (register === null && renewal === null && transfer === null) {
      skipped++;
      continue;
    }

    const observedAt = toIsoDate(row.last_checked);
    if (observedAt && (oldest === null || observedAt < oldest)) oldest = observedAt;

    // Non-USD rows are dropped rather than silently converted.
    if (row.currency && row.currency.toUpperCase() !== 'USD') {
      skipped++;
      continue;
    }

    offers.push({
      tld,
      registrar_id: registrarId,
      registrar_name: registrars[registrarId].name,
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      // The CSV carries no promotion flag: never invent one.
      promotional: false,
      promo_code: null,
      promo_restrictions: null,
      promotion_expires_at: null,
      source_id: BDR_SOURCE.id,
      source_url:
        typeof row.source_url === 'string' && /^https?:\/\//.test(row.source_url)
          ? row.source_url
          : BDR_SOURCE.url,
      purchase_url: null,
      // A dataset snapshot: observed on the dataset's own date, never verified by us.
      price_observed_at: observedAt,
      price_verified_at: null,
      verification_status: mapVerificationStatus(upstreamStatus),
      source_status_stale: false,
    });
    seen.add(key);
  }

  return { offers, skipped, statuses, oldestObservedAt: oldest };
}

/** Fetch both documents and parse. Verification metadata is optional. */
export async function fetchBdr(): Promise<RawOffer[]> {
  const [csvText, verification] = await Promise.all([
    fetchText(BDR_PRICING_URL),
    fetchJson<BdrVerification>(BDR_VERIFICATION_URL).catch(() => undefined),
  ]);
  return parseBdr(csvText, verification).offers;
}