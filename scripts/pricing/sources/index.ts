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
 * Source tiers (see docs/PRICING-DATA.md):
 *   - First-party, read live each run → `verified`. These are the only
 *     sources allowed to claim a price was verified today:
 *       porkbun      official public API, no auth
 *       dynadot      official price page, server-rendered payload
 *       gandi        official price list, server-rendered table
 *       hover        official price page, embedded JSON
 *       ionos        official price list, embedded JSON
 *       namecheap    official API — needs a key and an allowlisted egress IP,
 *                    so it is skipped (not faked) until those exist
 *   - Third-party snapshots → `source_snapshot`. Downloaded daily, but the
 *     dates inside them are the dataset's own observation dates:
 *       bestdomainregistrars  CC BY 4.0, carries a verification taxonomy
 *       pikkly                 CC BY 4.0
 *       opendomaindata         CC BY 4.0, monthly
 *
 * Ordering note: first-party adapters run first so a failure is visible early,
 * but every source is independent — one failure never blocks another.
 */

import type { RawOffer, VerificationStatus } from '../../../src/lib/pricingTypes.js';
import { PORKBUN_SOURCE, fetchPorkbun } from './porkbun.js';
import { DYNADOT_SOURCE, fetchDynadot } from './dynadot.js';
import { GANDI_SOURCE, fetchGandi } from './gandi.js';
import { HOVER_SOURCE, fetchHover } from './hover.js';
import { IONOS_SOURCE, fetchIonos } from './ionos.js';
import {
  NAMECHEAP_REQUIRED_ENV,
  NAMECHEAP_SOURCE,
  fetchNamecheap,
} from './namecheap.js';
import { BDR_SOURCE, fetchBdr } from './bestdomainregistrars.js';
import { PIKKLY_SOURCE, fetchPikkly } from './pikkly.js';
import { ODD_SOURCE, fetchOdd } from './opendomaindata.js';

export interface SourceAdapter {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string | null;
  priority: number;
  /** How this source's figures are obtained; drives offer classification. */
  verificationStatus: VerificationStatus;
  /** Env vars this source needs (none for keyless sources). */
  requiresEnv: string[];
  /** Receives the sync clock so first-party adapters stamp a real read time. */
  fetchOffers: (now: Date) => Promise<RawOffer[]>;
}

function adapter(
  meta: {
    id: string;
    name: string;
    url: string;
    license: string;
    attribution: string | null;
    priority: number;
    verificationStatus: VerificationStatus;
  },
  fetchOffers: (now: Date) => Promise<RawOffer[]>,
  requiresEnv: string[] = [],
): SourceAdapter {
  return { ...meta, requiresEnv, fetchOffers };
}

export const sourceAdapters: SourceAdapter[] = [
  // First-party reads.
  adapter(PORKBUN_SOURCE, now => fetchPorkbun(now)),
  adapter(DYNADOT_SOURCE, now => fetchDynadot(now)),
  adapter(GANDI_SOURCE, now => fetchGandi(now)),
  adapter(HOVER_SOURCE, now => fetchHover(now)),
  adapter(IONOS_SOURCE, now => fetchIonos(now)),
  // Credential-gated: without the env vars this source reports itself as
  // unconfigured and keeps its previous rows, so adding it cannot break a run.
  adapter(NAMECHEAP_SOURCE, now => fetchNamecheap(now), NAMECHEAP_REQUIRED_ENV),
  // Openly licensed snapshots.
  adapter(BDR_SOURCE, () => fetchBdr()),
  adapter(PIKKLY_SOURCE, () => fetchPikkly()),
  adapter(ODD_SOURCE, () => fetchOdd()),
];

export function missingEnvFor(adapter: SourceAdapter): string[] {
  return adapter.requiresEnv.filter(name => !process.env[name]);
}