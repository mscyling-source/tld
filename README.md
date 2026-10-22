# TLD Directory

An independent, open-source price-comparison and reference site for top-level domains (TLDs), built with verified IANA data and openly-licensed registrar pricing.

## Features

- **Registrar Price Comparison** — Homepage table comparing first-year registration, renewal, transfer and 3-year cost across registrars, with search, sorting, category filters and a first-party-prices-only mode
- **Per-TLD Price Tables** — Every detail page lists each registrar's offer with promo terms, evidence date, verification tier and a direct purchase link
- **Honest Price Provenance** — Every price states how it was obtained (**Verified** from the registrar's own price list, **Snapshot** from a dated open dataset, **Modelled**, or **Unverified**) and how old that evidence is (**Recently verified** ≤ 7 days, **not recent** 8–30 days, **Stale** > 30 days). A download timestamp can never make a price look freshly verified.
- **Complete TLD Directory** — Browse all 1,400+ delegated TLDs from the IANA Root Zone Database
- **Search & Filter** — Find TLDs by name, registry, type, or first letter (instant client-side filtering)
- **Category Pages** — Generic TLDs, Country-code TLDs, Sponsored TLDs, Internationalized TLDs, Special-use TLDs
- **A–Z Index** — Letter-based browsing for all TLDs
- **TLD Detail Pages** — Type, manager, official links (IANA, registry, WHOIS, RDAP), data quality indicators
- **Comparison Tool** — Side-by-side comparison of multiple TLDs
- **10+ Original Guides** — Practical articles on domains, DNS, registration, and choosing extensions
- **Transparent Data Sources** — IANA metadata with weekly sync; pricing read directly from five registrars' own published price lists plus three CC BY 4.0 datasets, with a daily, guarded sync and a per-run monitoring report (see `docs/PRICING-DATA.md`)
- **SEO-Ready** — Static HTML, sitemap.xml, robots.txt, canonical URLs, structured data, Open Graph
- **Privacy-First** — No tracking, no cookies, no third-party scripts
- **Fast** — Static site generation (SSG) via Astro, deployed to Cloudflare Pages

## Tech Stack

- **Astro 7** — Static site generation (SSG)
- **TypeScript** — Type-safe data pipeline
- **Tailwind CSS 4** — Utility-first styling
- **Vitest** — Unit tests
- **GitHub Actions** — Automated weekly IANA sync + daily pricing sync
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

### Sync Registrar Pricing (Manual)

```bash
npm run sync:prices
```

Reads five registrars' own published price lists (Porkbun API, Dynadot, Gandi, Hover, IONOS) and
three CC BY 4.0 datasets (Best Domain Registrars, Pikkly, Open Domain Data), validates every row,
guards against empty/shrinking sources, and writes:

| File | Contents |
|---|---|
| `data/prices.json` | Schema v2 offers — three provenance timestamps + verification tier per row |
| `data/prices-meta.json` | Last attempt/success, counts by tier and freshness, history |
| `data/price-sync-report.json` | Machine-readable monitoring report for the run |
| `data/price-sync-report.md` | Human-readable summary (also the CI step summary) |

Full source evaluation, provenance rules and failure semantics: `docs/PRICING-DATA.md`.

## Project Structure

```
├── public/
│   └── robots.txt
├── src/
│   ├── components/       # Astro components (Layout, Hero, TldTable, FilterBar, etc.)
│   ├── config/
│   │   ├── site.ts       # Central brand/site configuration
│   │   ├── freshness.ts  # Freshness thresholds, verification tiers, badge labels
│   │   ├── sources.ts    # Which sources count as first-party reads
│   │   └── registrars.ts # Registrar registry + affiliate extension point
│   ├── lib/
│   │   ├── iana.ts       # IANA parsing + normalization (pure functions, tested)
│   │   ├── pricing.ts    # Build-time pricing store + aggregation
│   │   ├── pricingCalc.ts# Three-year math, evidence dates, freshness, sorting (tested)
│   │   ├── search.ts     # Search/filter/sort/pagination (pure functions, tested)
│   │   ├── store.ts      # Server-side data access (build-time)
│   │   ├── types.ts      # TypeScript interfaces
│   │   └── pricingTypes.ts # Pricing data model, schema v2 (separate from IANA)
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
│   ├── sync-prices.ts    # Daily pricing sync (GitHub Actions)
│   ├── deploy-decision.ts# Decides whether a build must be published
│   ├── pricing/          # http helpers, source adapters, validate, merge, migrate, report
│   └── init-data.ts      # Initialize data from local files
├── data/
│   ├── tlds.json         # Canonical TLD dataset (1,400+ records)
│   ├── meta.json         # Sync metadata + history
│   ├── prices.json       # Registrar offers, schema v2 (one per registrar+TLD)
│   ├── prices-meta.json  # Price sync metadata + history
│   ├── price-sync-report.json # Per-run provenance report (machine-readable)
│   └── price-sync-report.md   # Per-run provenance report (human-readable)
├── tests/
│   ├── fixtures.ts       # Test fixtures (IANA sample data)
│   ├── iana.test.ts      # IANA parsing tests
│   ├── search.test.ts    # Search/filter tests
│   ├── pricing.test.ts   # Pricing pipeline + dataset tests
│   ├── deployDecision.test.ts # Publish-skip decision rules
│   └── workflow.test.ts  # Workflow contract (triggers, secrets, deploy order)
├── .github/workflows/
│   ├── sync-tlds.yml     # Weekly automated sync
│   └── sync-prices.yml   # Daily pricing sync + build + publish
├── astro.config.mjs
├── tsconfig.json
└── vitest.config.ts
```

## Deployment architecture

**Direct upload — GitHub Actions builds and publishes to the existing Cloudflare Pages
project `tld-directory`.** The repository is *not* connected to Cloudflare Git integration,
so a commit to `main` does not rebuild the site; the workflow publishes explicitly.

```
.github/workflows/sync-tlds.yml
   └─ weekly: fetch IANA → validate → npm run build (verify) → npm test
              → commit data/tlds.json + data/meta.json → push to main

.github/workflows/sync-prices.yml
   └─ daily (04:45 UTC): fetch pricing sources → validate/guard → provenance checks
              → publish report to run summary + artefacts → npm test
              → commit data/prices*.json + price-sync-report.* (only if changed) → push to main
              → npm run build (PUBLIC_SITE_URL=https://tld-directory.pages.dev)
              → wrangler pages deploy dist --project-name tld-directory --branch main
              → verify the live site serves the new dataset
```

Publishing is skipped when the live deployment already serves the current commit, so a
daily run with no changes costs no upload. Runs are serialised
(`concurrency: sync-prices`, `cancel-in-progress: false`) and the deploy step refuses to
overwrite a newer live deployment.

Two repository secrets are required for the publish step — `CLOUDFLARE_API_TOKEN`
(Pages:Edit) and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow fails with an
actionable message and the site keeps serving the last successful deployment; manual
publishing still works. Full setup, recovery recipes and verification steps:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Production URL configuration

The origin is read from an environment variable, with a placeholder fallback:

| Precedence | Variable | Example |
|---|---|---|
| 1 | `PUBLIC_SITE_URL` | `https://your-domain.com` |
| 2 | `SITE_URL` | `https://your-domain.com` |
| 3 | built-in fallback | `https://tlddirectory.com` |

`PUBLIC_SITE_URL` drives canonical tags, `sitemap-index.xml`, `robots.txt` and every
Open Graph URL — so switching to the real domain is a single env var, not a code edit.

The daily workflow builds with `PUBLIC_SITE_URL=https://tld-directory.pages.dev`, so the
preview's canonicals, sitemap and robots.txt all point at the preview host. For a local
build use the same variable, e.g. `PUBLIC_SITE_URL=https://tld-directory.pages.dev npm run build`.

Malformed values (no scheme, no dot in the hostname) abort the build with a clear message.

### Testing on the `*.pages.dev` domain

Before a custom domain exists you can verify everything on the Cloudflare-provided hostname:

```
PUBLIC_SITE_URL="https://tld-directory.pages.dev" npm run build
```

The same variable is used by the daily publish workflow, so a locally built site and the
published site emit identical canonicals, sitemaps and robots.txt.

### Publishing manually

```bash
PUBLIC_SITE_URL=https://tld-directory.pages.dev npm run build
npx wrangler@4.151.3 pages deploy dist --project-name tld-directory --branch main
```

This targets the existing project — it never creates one. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full runbook.

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