/**
 * Source adapter registry.
 *
 * Adding a provider = one new file exporting a `SourceAdapter`, one line
 * here. No credentials are hardcoded anywhere: sources that require API
 * keys read them from environment variables (GitHub Actions secrets) and
 * are marked `requiresEnv`. A missing env var marks that source `failed`
 * for the run while every other source still updates — one provider can
 * never wipe another provider's rows.
 *
 * Current status (see docs/PRICING-DATA.md for the full evaluation):
 *   - porkbun        official public API, no auth
 *   - pikkly         CC BY 4.0 open dataset, no auth
 *   - opendomaindata CC BY 4.0 open dataset, no auth
 */

import type { RawOffer } from '../../../src/lib/pricingTypes.js';
import { PORKBUN_SOURCE, fetchPorkbun } from './porkbun.js';
import { PIKKLY_SOURCE, fetchPikkly } from './pikkly.js';
import { ODD_SOURCE, fetchOdd } from './opendomaindata.js';

export interface SourceAdapter {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string | null;
  priority: number;
  /** Env vars this source needs (none for keyless sources). */
  requiresEnv: string[];
  fetchOffers: () => Promise<RawOffer[]>;
}

function adapter(
  meta: { id: string; name: string; url: string; license: string; attribution: string | null; priority: number },
  fetchOffers: () => Promise<RawOffer[]>,
  requiresEnv: string[] = [],
): SourceAdapter {
  return { ...meta, requiresEnv, fetchOffers };
}

export const sourceAdapters: SourceAdapter[] = [
  adapter(PORKBUN_SOURCE, fetchPorkbun),
  adapter(PIKKLY_SOURCE, fetchPikkly),
  adapter(ODD_SOURCE, fetchOdd),
];

export function missingEnvFor(adapter: SourceAdapter): string[] {
  return adapter.requiresEnv.filter(name => !process.env[name]);
}
