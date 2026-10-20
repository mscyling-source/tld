/**
 * Central brand / site configuration.
 *
 * Everything that might change when the project is re-branded or moved to a
 * different domain lives here (the canonical origin itself is configured in
 * `astro.config.mjs` → `site`, because Astro needs it at config time).
 */

export const siteConfig = {
  name: 'TLD Directory',
  /** Short name used in the header logo mark. */
  shortName: 'TLD',
  tagline: 'Independent domain price comparison & TLD reference',
  description:
    'Compare domain registration, renewal and transfer prices across registrars to find the cheapest place to buy an extension — backed by verified IANA TLD data, official sources and practical guides.',
  /** Published contact address (also shown on /contact/). */
  contactEmail: 'hello@tlddirectory.com',
  /** Optional social profiles. Leave empty strings to hide a link. */
  social: {
    x: '',
    github: '',
    linkedin: '',
  },
  language: 'en',
  /** Year the site launched — used in the footer. */
  foundedYear: 2026,
} as const;

export const navLinks = [
  { href: '/#compare', label: 'Prices' },
  { href: '/tlds/', label: 'All TLDs' },
  { href: '/category/', label: 'Categories' },
  { href: '/tools/compare/', label: 'Compare' },
  { href: '/guides/', label: 'Guides' },
  { href: '/data-sources/', label: 'Data Sources' },
] as const;

export const footerLinks = [
  {
    title: 'Explore',
    items: [
      { href: '/#compare', label: 'Price comparison' },
      { href: '/tlds/', label: 'All TLDs' },
      { href: '/category/generic/', label: 'Generic TLDs' },
      { href: '/category/country-code/', label: 'Country-code TLDs' },
      { href: '/category/internationalized/', label: 'Internationalized TLDs' },
      { href: '/category/special-use/', label: 'Special-use TLDs' },
      { href: '/tools/compare/', label: 'TLD comparison' },
    ],
  },
  {
    title: 'Learn',
    items: [
      { href: '/guides/', label: 'All guides' },
      { href: '/guides/what-is-a-top-level-domain/', label: 'What is a TLD?' },
      { href: '/guides/registry-vs-registrar/', label: 'Registry vs registrar' },
      { href: '/guides/how-to-choose-a-domain-extension/', label: 'Choosing an extension' },
      { href: '/guides/how-dns-and-domain-names-work/', label: 'How DNS works' },
    ],
  },
  {
    title: 'About',
    items: [
      { href: '/about/', label: 'About' },
      { href: '/contact/', label: 'Contact' },
      { href: '/data-sources/', label: 'Data sources' },
      { href: '/privacy/', label: 'Privacy policy' },
      { href: '/terms/', label: 'Terms of use' },
      { href: '/adsense-readiness/', label: 'Site quality checklist' },
    ],
  },
] as const;

/**
 * Popular TLDs shown on the home page.
 *
 * Every entry is validated against the synced IANA dataset at build time —
 * an entry that is not present in the dataset is dropped instead of being
 * displayed as "verified".
 */
export const popularTlds = [
  'com',
  'org',
  'net',
  'ai',
  'io',
  'dev',
  'app',
  'co',
  'me',
  'info',
] as const;
