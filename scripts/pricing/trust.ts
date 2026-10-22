/**
 * Trust policy applied to merged offers before they are published.
 *
 * Some registrars' third-party price data is known to be placeholder rather
 * than observed (see `UNTRUSTED_REGISTRAR_PRICES`). Those rows are kept — the
 * site can still show that the registrar exists — but they lose every claim of
 * trustworthiness: no verification tier, no verification date, no freshness
 * band. That means they can never earn a "cheapest" badge, and the UI renders
 * them with an explicit "Unverified" label.
 *
 * Pure and side-effect free so the rule is unit-testable.
 */

import type { PriceOffer } from '../../src/lib/pricingTypes.js';
import { UNTRUSTED_REGISTRAR_PRICES } from '../../src/config/sources.js';

export interface TrustPolicyResult {
  offers: PriceOffer[];
  /** Registrar ids that were downgraded in this pass. */
  quarantined: string[];
}

export function applyTrustPolicy(offers: PriceOffer[]): TrustPolicyResult {
  const quarantined = new Set<string>();
  const out = offers.map(offer => {
    if (UNTRUSTED_REGISTRAR_PRICES[offer.registrar_id] === undefined) return offer;
    quarantined.add(offer.registrar_id);
    return {
      ...offer,
      verification_status: 'unverified' as const,
      price_verified_at: null,
      freshness: 'unknown' as const,
      quality: 'stale' as const,
    };
  });
  return { offers: out, quarantined: [...quarantined].sort() };
}

/** The documented reason a registrar's prices are quarantined, if any. */
export function quarantineReason(registrarId: string): string | null {
  return UNTRUSTED_REGISTRAR_PRICES[registrarId] ?? null;
}
