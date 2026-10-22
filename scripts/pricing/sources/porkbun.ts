/**
 * Source adapter: Porkbun official public pricing API.
 *
 * Endpoint: POST/GET https://api.porkbun.com/api/json/v3/pricing/get
 * Auth:     NONE — documented as public ("Does not require authentication",
 *           prices are US dollars). See https://porkbun.com/api/json/v3/spec
 * Coverage: every TLD Porkbun sells (~900).
 * Fields:   registration, renewal, transfer (list prices), optional coupons.
 * Licence:  official API intended for programmatic use — no scraping.
 *
 * Per-TLD purchase page: https://porkbun.com/tld/<tld> (pattern verified
 * against real source data; used as both source_url and purchase_url).
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { normalizePrice } from '../../../src/lib/pricingCalc.js';

export const PORKBUN_SOURCE = {
  id: 'porkbun',
  name: 'Porkbun API',
  url: 'https://porkbun.com/api/json/v3/documentation',
  license: 'Official public API (no authentication required)',
  attribution: null,
  priority: 0, // official API checked at fetch time — wins freshness ties
  verificationStatus: 'verified' as VerificationStatus,
};

export const PORKBUN_PRICING_URL = 'https://api.porkbun.com/api/json/v3/pricing/get';

interface PorkbunTldPricing {
  registration?: string | number;
  renewal?: string | number;
  transfer?: string | number;
  coupons?: unknown;
}

export interface PorkbunPayload {
  status?: string;
  pricing?: Record<string, PorkbunTldPricing>;
  unsupported?: string[];
}

/**
 * Extract a promo code from a coupon entry when the structure exposes one.
 * Unknown coupon shapes are ignored — codes are never guessed.
 */
function extractPromo(coupons: unknown): {
  code: string | null;
  restrictions: string | null;
  expiresAt: string | null;
} {
  if (!Array.isArray(coupons)) return { code: null, restrictions: null, expiresAt: null };
  for (const entry of coupons) {
    if (entry && typeof entry === 'object') {
      const anyEntry = entry as Record<string, unknown>;
      if (typeof anyEntry.code === 'string' && anyEntry.code.trim()) {
        const notes: string[] = [];
        if (typeof anyEntry.type === 'string') notes.push(`applies to ${anyEntry.type}`);
        if (typeof anyEntry.expires === 'string') notes.push(`expires ${anyEntry.expires}`);
        return {
          code: anyEntry.code.trim(),
          restrictions: notes.length ? notes.join(', ') : null,
          // Porkbun is the only source that publishes an explicit promo end
          // date; it is preserved verbatim so an expired promo can be hidden.
          expiresAt: typeof anyEntry.expires === 'string' ? anyEntry.expires : null,
        };
      }
    }
  }
  return { code: null, restrictions: null, expiresAt: null };
}

/** Pure parse of a Porkbun pricing payload (fixture-testable). */
export function parsePorkbun(payload: PorkbunPayload, observedAt: string): RawOffer[] {
  if (!payload || payload.status !== 'SUCCESS' || !payload.pricing || typeof payload.pricing !== 'object') {
    throw new Error(`Porkbun pricing payload invalid (status=${payload?.status ?? 'missing'})`);
  }
  const offers: RawOffer[] = [];
  for (const [rawTld, entry] of Object.entries(payload.pricing)) {
    const tld = rawTld.toLowerCase();
    if (!entry || typeof entry !== 'object') continue;
    // Normalise each field independently: one malformed figure is recorded
    // on `invalid_fields` (which rejects the row) while the valid fields
    // stay readable for diagnostics.
    const invalid: string[] = [];
    const safePrice = (v: unknown, field: string): number | null => {
      try {
        return normalizePrice(v);
      } catch {
        invalid.push(field);
        return null;
      }
    };
    const register = safePrice(entry.registration, 'registration');
    const renewal = safePrice(entry.renewal, 'renewal');
    const transfer = safePrice(entry.transfer, 'transfer');
    const promo = extractPromo(entry.coupons);
    const page = `https://porkbun.com/tld/${tld}`;
    offers.push({
      tld,
      registrar_id: 'porkbun',
      registrar_name: 'Porkbun',
      currency: 'USD',
      register_usd: register,
      renewal_usd: renewal,
      transfer_usd: transfer,
      promotional: promo.code !== null,
      promo_code: promo.code,
      promo_restrictions: promo.restrictions,
      promotion_expires_at: promo.expiresAt,
      source_id: PORKBUN_SOURCE.id,
      source_url: page,
      purchase_url: page,
      // Read from Porkbun's own API during this run: a genuine verification.
      price_observed_at: observedAt,
      price_verified_at: observedAt,
      verification_status: PORKBUN_SOURCE.verificationStatus,
      source_status_stale: false,
      invalid_fields: invalid.length ? invalid : undefined,
    });
  }
  return offers;
}

/** Network fetch for the sync pipeline. */
export async function fetchPorkbun(now: Date = new Date()): Promise<RawOffer[]> {
  const res = await fetch(PORKBUN_PRICING_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Porkbun pricing HTTP ${res.status}`);
  const payload = (await res.json()) as PorkbunPayload;
  return parsePorkbun(payload, now.toISOString());
}
