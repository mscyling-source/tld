# Pricing Data — Source Evaluation & Pipeline

This document records the Phase 4 investigation: which registrar pricing
sources were evaluated, why the current three were chosen, and how the
pipeline behaves. The site must never display a fabricated price — if a
figure isn't published by a source, the UI shows **"Price unavailable"**.

## Data layout

| File | Contents | Writer |
|---|---|---|
| `data/tlds.json` | IANA delegation metadata (1,437 TLDs) | `npm run sync:tlds` (IANA only) |
| `data/prices.json` | Registrar offers, one row per (registrar, TLD) | `npm run sync:prices` |
| `data/prices-meta.json` | Last attempt/success, counts, history, errors | `npm run sync:prices` |

The two pipelines never write each other's files. Price rows reference the
IANA catalog by bare TLD label; rows whose TLD isn't in the catalog are
**rejected** (e.g. registry second-level names like `com.mx`, which have no
page here).

## Selected sources

### 1. Porkbun API — primary, official, keyless

- **Endpoint:** `https://api.porkbun.com/api/json/v3/pricing/get`
- **Access:** none required — Porkbun's own documentation states *"Does not
  require authentication. Prices are in US dollars."*
- **Auth:** none. No API key, no account, no rate-limit surprises documented
  for the pricing endpoint.
- **Coverage:** every TLD Porkbun sells (~900 list entries).
- **Fields:** `registration`, `renewal`, `transfer`, optional `coupons`.
- **Freshness:** checked at fetch time (daily) → always "verified".
- **Terms:** official API intended for programmatic use; not scraping.
- **Purchase links:** per-TLD pages `https://porkbun.com/tld/<tld>` (pattern
  verified against real source data).

### 2. Pikkly open data — multi-registrar, CC BY 4.0

- **URL:** `https://pikkly.dev/data/domains/prices.json`
- **Access:** static JSON, no auth, rebuilt **daily** (`generated_at`).
- **Licence:** **CC BY 4.0** — attribution *"Price data by Pikkly"* +
  link to `https://pikkly.dev` (rendered on `/data-sources/` and in
  `data/prices.json` source metadata).
- **Coverage:** 6 registrars × ~3,300 rows: Porkbun, Cloudflare, Dynadot,
  Gandi, Hover, IONOS. Fields: `first_year_usd`, `renewal_usd`,
  `transfer_usd` (nullable), per-row `source_url`, `last_checked`, `status`.
- **Freshness handling (conservative):**
  - rows with `meta.dump_date` (e.g. Cloudflare's community dump) use the
    **dump date** as `last_checked`, not the daily rebuild time;
  - rows the source flags `stale` are pinned stale forever;
  - rows flagged `unavailable` (source down / null value) are **skipped** so
    they can't overwrite good previous data.
- **Terms:** openly published JSON dump specifically for reuse; we mirror the
  publisher's attribution requirements.

### 3. Open Domain Data `tld_pricing` — breadth, CC BY 4.0

- **URL:** `https://www.opendomaindata.org/api/tld_pricing.json`
- **Access:** bulk JSON, no auth.
- **Licence:** **CC BY 4.0** — citation *"Open Domain Data (2026).
  tld_pricing, opendomaindata.org"*, shown on `/data-sources/`.
- **Cadence:** monthly snapshot; each record carries its own `last_checked`
  (often weeks old → automatically classified "stale" past 30 days).
- **Coverage (why it matters):** the **only** source for GoDaddy,
  Namecheap, Spaceship and Squarespace Domains; plus Porkbun/Dynadot/
  Cloudflare rows. Fields: `register_usd`, `renew_usd`, `transfer_usd`,
  `promotional` flag, `sources[]`, `verification_status`.
- **Currency:** dataset header declares USD normalisation; a non-USD header
  makes the whole payload fail closed.

### Combined coverage (from the first live sync)

- **3,306 offers · 811 TLDs · 10 registrars** — Porkbun, Cloudflare,
  Dynadot, Gandi, Hover, IONOS, GoDaddy, Namecheap, Spaceship,
  Squarespace Domains.
- 1,058 cross-source duplicates resolved by freshness; 2,846 offers
  "verified", 460 "stale" at first sync.

## Evaluated and rejected

| Source | Why not used (yet) |
|---|---|
| **name.com API** | Requires signup + API key; reseller pricing tiers need approval. Adapter-ready when a key exists. |
| **Porkbun / Dynadot / Namesilo / DNSimple authenticated APIs** | All require account keys. Porkbun's *public* pricing endpoint made its key unnecessary; the others stay future adapters. |
| **Namecheap API** | Requires an approved account with linked funds; developer terms restrict redistribution. |
| **TLD-List / TLDbee / Pikkly comparison pages** | Scraping comparison sites violates their purpose/terms; **Pikkly's published JSON dump** (CC BY 4.0) is the sanctioned machine-readable alternative and is used instead. |
| **Commercial pricing APIs** | Paid; no budget approved. Architecture keeps them pluggable. |
| **Registrar website scraping** | Rejected by policy: anti-bot circumvention, fragile markup, ToS risk. |
| **Cloudflare community price dumps** | Reachable only *via* Pikkly's licensed dataset (direct scraping of a GitHub dump is allowed by repo licence but the dump is dated/stale — Pikkly's normalised copy with attribution is preferred). |

## Adapter architecture

```
scripts/pricing/
  sources/porkbun.ts          # parse + fetch, one file per provider
  sources/pikkly.ts
  sources/opendomaindata.ts
  sources/index.ts            # SourceAdapter registry (add a provider = 1 file + 1 line)
  validate.ts                 # unknown TLD / bad price / currency / URL / duplicates
  merge.ts                    # one offer per (registrar, TLD); freshest wins
scripts/sync-prices.ts        # orchestration, guards, atomic writes, meta
```

`SourceAdapter` = `{ id, name, url, license, attribution, priority,
requiresEnv[], fetchOffers() }`. A credentialed provider lists its env var
names in `requiresEnv`; the sync run treats a missing var as a failed source
(keeping previous rows) rather than failing the whole run. Credentials come
from GitHub Actions secrets only — never committed.

## Validation rules (row → rejected)

- **unknown TLD** — not in `data/tlds.json`
- **invalid-price** — present but ≤0, NaN, or > $100,000 (also when a source
  string fails to parse: the row carries `invalid_fields`)
- **missing-currency** — row doesn't declare USD (all sources are
  USD-normalised upstream; no FX conversion happens here)
- **invalid-url** / **invalid-timestamp** — non-http(s) source/purchase URL,
  or unparsable `last_checked`
- **duplicate** — same (registrar, TLD) twice inside one source batch
- **no-price** — all three price fields null
- **missing-identity** — empty registrar id/name

## Dataset guards (run → run)

1. Source fetch throws → previous rows for that source kept
   (`kept-previous`), other sources still update.
2. Source returns **0 valid rows** → treated as failure; previous rows kept.
3. Source shrinks by **>50%** vs previous run → `shrunk-kept-previous`.
4. **All** sources failed → exit 1, `data/prices.json` **byte-for-byte
   untouched**, failure recorded in `data/prices-meta.json` only.
5. Writes are atomic (`.tmp` + rename).
6. Freshness (`verified`/`stale`, 30-day threshold) is derived from each
   source's own `last_checked` — a site rebuild **never** re-dates prices.

## Three-year cost formula

```
three_year_usd = register_usd + 2 × renewal_usd     (null unless both exist)
```

Shown only when the source publishes both figures. Promotional first-year
prices are kept in the registration column with a visible `promo` flag and
are never used to label a "best long-term value" — that badge follows the
3-year column, which is driven by standard renewal prices.

## Adding a credentialed provider later

1. Create `scripts/pricing/sources/<provider>.ts` with a pure `parse*`
   function (fixture-testable) and a `fetch*` that reads
   `process.env.<SECRET>` from `requiresEnv`.
2. Register it in `scripts/pricing/sources/index.ts`.
3. Add the secret in GitHub → Settings → Secrets → Actions, and document it
   here.
4. Add a fixture + parse/validation tests in `tests/pricing.test.ts`.

No affiliate IDs are ever baked into data. Affiliate links are configured
per-registrar in `src/config/registrars.ts` (`affiliate.buildUrl`) only from
a real agreement; rankings never read that field.
