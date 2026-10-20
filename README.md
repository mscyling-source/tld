# TLD Directory

An independent, open-source reference for top-level domains (TLDs) built with verified IANA data.

## Features

- **Complete TLD Directory** — Browse all 1,400+ delegated TLDs from the IANA Root Zone Database
- **Search & Filter** — Find TLDs by name, registry, type, or first letter (instant client-side filtering)
- **Category Pages** — Generic TLDs, Country-code TLDs, Sponsored TLDs, Internationalized TLDs, Special-use TLDs
- **A–Z Index** — Letter-based browsing for all TLDs
- **TLD Detail Pages** — Type, manager, official links (IANA, registry, WHOIS, RDAP), data quality indicators
- **Comparison Tool** — Side-by-side comparison of multiple TLDs
- **10+ Original Guides** — Practical articles on domains, DNS, registration, and choosing extensions
- **Transparent Data Sources** — All data traced to IANA with weekly automated sync
- **SEO-Ready** — Static HTML, sitemap.xml, robots.txt, canonical URLs, structured data, Open Graph
- **Privacy-First** — No tracking, no cookies, no third-party scripts
- **Fast** — Static site generation (SSG) via Astro, deployed to Cloudflare Pages

## Tech Stack

- **Astro 7** — Static site generation (SSG)
- **TypeScript** — Type-safe data pipeline
- **Tailwind CSS 4** — Utility-first styling
- **Vitest** — Unit tests
- **GitHub Actions** — Automated weekly IANA sync
- **Cloudflare Pages** — Free, global hosting

## Getting Started

### Prerequisites

- Node.js 22.12+ (Astro 7 requires it; `.nvmrc` pins `22`)
- npm 10+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Visit `http://localhost:4321`

### Build

```bash
npm run build
```

Output in `dist/` — ready for static hosting.

### Test

```bash
npm run test
```

### Sync TLD Data (Manual)

```bash
npm run sync:tlds
```

Fetches latest IANA data, validates, and updates `data/tlds.json` + `data/meta.json`.

## Project Structure

```
├── public/
│   └── robots.txt
├── src/
│   ├── components/       # Astro components (Layout, Hero, TldTable, FilterBar, etc.)
│   ├── config/
│   │   └── site.ts       # Central brand/site configuration
│   ├── lib/
│   │   ├── iana.ts       # IANA parsing + normalization (pure functions, tested)
│   │   ├── search.ts     # Search/filter/sort/pagination (pure functions, tested)
│   │   ├── store.ts      # Server-side data access (build-time)
│   │   └── types.ts      # TypeScript interfaces
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   ├── tlds/                 # TLD directory + A-Z index
│   │   ├── tld/[tld]/            # TLD detail pages
│   │   ├── category/[type]/      # Category pages
│   │   ├── guides/               # 10+ original guides
│   │   ├── tools/compare/        # Comparison tool
│   │   ├── data-sources/         # Data methodology
│   │   ├── about/, contact/, privacy/, terms/, adsense-readiness/
│   │   └── 404.astro
│   └── styles/global.css
├── scripts/
│   ├── sync-tlds.ts      # Weekly IANA sync (GitHub Actions)
│   └── init-data.ts      # Initialize data from local files
├── data/
│   ├── tlds.json         # Canonical TLD dataset (1,400+ records)
│   └── meta.json         # Sync metadata + history
├── tests/
│   ├── fixtures.ts       # Test fixtures (IANA sample data)
│   ├── iana.test.ts      # IANA parsing tests
│   └── search.test.ts    # Search/filter tests
├── .github/workflows/
│   └── sync-tlds.yml     # Weekly automated sync
├── astro.config.mjs
├── tsconfig.json
└── vitest.config.ts
```

## Deployment architecture

**Architecture A — GitHub Actions syncs data; Cloudflare Pages builds and deploys.**

```
.github/workflows/sync-tlds.yml
   └─ weekly: fetch IANA → validate → npm run build (verify) → npm test
              → commit data/*.json → push to main
                                         │
Cloudflare Pages (Git integration)
   └─ sees the push → npm ci → npm run build → publish dist/
```

The workflow deliberately **does not** use `cloudflare/pages-action`: that action needs
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets and would deploy *in addition to* the
Git-triggered build, producing a duplicate deploy. Keeping one deploy per commit means the only
thing to configure in Cloudflare is the Git integration.

### Production URL configuration

The origin is read from an environment variable, with a placeholder fallback:

| Precedence | Variable | Example |
|---|---|---|
| 1 | `PUBLIC_SITE_URL` | `https://your-domain.com` |
| 2 | `SITE_URL` | `https://your-domain.com` |
| 3 | built-in fallback | `https://tlddirectory.com` |

`PUBLIC_SITE_URL` drives canonical tags, `sitemap-index.xml`, `robots.txt` and every
Open Graph URL — so switching to the real domain is a single env var, not a code edit.

Set it in **Cloudflare Pages → your project → Settings → Environment variables** for both
Production and Preview. For a local `.env`, use the same name (Astro loads it automatically).

Malformed values (no scheme, no dot in the hostname) abort the build with a clear message.

### Testing on the `*.pages.dev` domain

Before a custom domain exists you can verify everything on the Cloudflare-provided hostname:

```
PUBLIC_SITE_URL="https://<project>.pages.dev" npm run build
```

or set the same value as a Preview env var in Cloudflare, so preview deploys emit canonicals
and a sitemap pointing at the preview host rather than the placeholder origin.

## Data Pipeline

1. **Source**: IANA Root Zone Database (HTML table) + Delegated TLD List (text file)
2. **Parse**: Extract TLD, type, manager, status from HTML; validate delegated list
3. **Normalize**: Map IANA types to canonical values; decode IDN punycode
4. **Enrich**: Fetch per-TLD delegation pages for WHOIS/RDAP/URL/dates (for "Not assigned" TLDs)
5. **Validate**: Reject malformed data, duplicates, implausibly small datasets
6. **Output**: `data/tlds.json` (canonical dataset) + `data/meta.json` (sync metadata)
7. **Build**: Astro SSG generates ~1,490 static HTML pages from dataset

> **Upstream change (2026):** IANA redesigned the Root Zone Database and now publishes three
> types — Generic, Country Code, Special Use — instead of the previous six. The old
> "Sponsored"/"Generic Restricted"/"Infrastructure" labels are no longer published. See
> `src/lib/iana.ts` (both layouts are parsed) and `/data-sources/` on the live site.

## Editorial content vs IANA data

| Data | Location | Written by | Overwritten by sync? |
|---|---|---|---|
| Type, manager, WHOIS/RDAP, status | `data/tlds.json` | `scripts/sync-tlds.ts` | **Yes** |
| Editorial notes (42 TLDs) | `src/content/tldNotes.ts` | curated, with per-source URLs + `checked_on` dates | **No** |

Notes are merged only at render time. Each note records the URLs it was compiled from and the
date they were fetched, and marks registration rules as *not independently verified* unless a
linked source states them — IANA's delegation record does not publish eligibility, restrictions
or pricing.

## Configuration

All branding in `src/config/site.ts`:
- Site name, tagline, description
- Contact email
- Social links
- Navigation/footer links
- Popular TLDs for homepage

## Data Quality Levels

- **Verified** — Type, manager, delegation status confirmed against IANA
- **Verified + Editorial** — Verified + human-reviewed editorial profile
- **Incomplete** — Missing manager info (IANA shows "Not assigned")

## Contributing

1. Fork and clone
2. Create feature branch
3. Make changes with tests
4. Run `npm run test && npm run build`
5. Submit PR

## License

Code: MIT — see LICENSE
Data: IANA public domain (see IANA legal notices)
Editorial content: All rights reserved

## Disclaimer

Not affiliated with ICANN, IANA, any registry, or any registrar. Data sourced from public IANA publications. Always verify with official registry before making registration decisions.