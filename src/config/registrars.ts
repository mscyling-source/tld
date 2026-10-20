/**
 * Registrar registry: display names, official outbound links, and the
 * affiliate extension point.
 *
 * Link policy (Phase 7):
 *   - Every offer gets an ordinary link to the registrar. Ordinary links
 *     carry no tracking parameters of any kind.
 *   - Affiliate IDs are NEVER invented. When a real affiliate partnership
 *     exists, fill in `affiliate.buildUrl` for that registrar; the UI then
 *     switches the link template and adds `rel="sponsored"` plus the
 *     disclosure text. Rankings never read this field — prices decide
 *     "cheapest", never commission.
 *   - `tldPageUrl` is only defined where the per-TLD URL pattern has been
 *     verified against real source data (Porkbun's /tld/<tld> pages).
 *     Everything else falls back to the official homepage rather than a
 *     guessed search URL.
 */

export interface RegistrarInfo {
  id: string;
  name: string;
  /** Official registrar homepage (verified brand domain). */
  website: string;
  /** Per-TLD purchase page — only where the pattern is verified. */
  tldPageUrl?: (tld: string) => string;
  /**
   * Affiliate link builder. Absent (the default) ⇒ ordinary link.
   * Set only from a real affiliate agreement; see docs/PRICING-DATA.md.
   */
  affiliate?: (tld: string) => string;
}

export const registrars: Record<string, RegistrarInfo> = {
  porkbun: {
    id: 'porkbun',
    name: 'Porkbun',
    website: 'https://porkbun.com',
    tldPageUrl: tld => `https://porkbun.com/tld/${tld}`,
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Registrar',
    website: 'https://www.cloudflare.com/products/registrar/',
  },
  dynadot: {
    id: 'dynadot',
    name: 'Dynadot',
    website: 'https://www.dynadot.com',
  },
  gandi: {
    id: 'gandi',
    name: 'Gandi',
    website: 'https://www.gandi.net',
  },
  hover: {
    id: 'hover',
    name: 'Hover',
    website: 'https://www.hover.com',
  },
  ionos: {
    id: 'ionos',
    name: 'IONOS',
    website: 'https://www.ionos.com',
  },
  godaddy: {
    id: 'godaddy',
    name: 'GoDaddy',
    website: 'https://www.godaddy.com',
  },
  namecheap: {
    id: 'namecheap',
    name: 'Namecheap',
    website: 'https://www.namecheap.com',
  },
  spaceship: {
    id: 'spaceship',
    name: 'Spaceship',
    website: 'https://www.spaceship.com',
  },
  squarespace: {
    id: 'squarespace',
    name: 'Squarespace Domains',
    website: 'https://www.squarespace.com/domains/',
  },
};

/** Display name for a registrar id; falls back to a title-cased id. */
export function registrarName(id: string): string {
  return registrars[id]?.name ?? id;
}

/**
 * Best available purchase URL for a registrar+TLD.
 * Verified per-TLD page → registered affiliate link (future) → homepage.
 */
export function purchaseUrlFor(registrarId: string, tld: string): string {
  const info = registrars[registrarId];
  if (!info) return '';
  if (info.affiliate) return info.affiliate(tld);
  if (info.tldPageUrl) return info.tldPageUrl(tld);
  return info.website;
}

/** True when this registrar has a configured affiliate relationship. */
export function hasAffiliate(registrarId: string): boolean {
  return typeof registrars[registrarId]?.affiliate === 'function';
}

/** `rel` value for an outbound registrar link (affiliate links marked sponsored). */
export function outboundRel(registrarId: string): string {
  return hasAffiliate(registrarId)
    ? 'sponsored nofollow noopener'
    : 'noopener';
}

/** Any currently-active affiliate relationship (drives the disclosure line). */
export const activeAffiliates: string[] = Object.values(registrars)
  .filter(r => typeof r.affiliate === 'function')
  .map(r => r.name);
