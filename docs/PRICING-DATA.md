# Pricing Data — Source Evaluation, Provenance & Pipeline

This document is the technical reference for the registrar price pipeline: which
sources are read, how each figure is dated, how conflicts are resolved, and what
the site is allowed to claim about a price.

The governing rule is simple: **the site must never display a fabricated price,
and must never claim a price is fresher than its evidence.** If a source doesn't
publish a figure, the UI shows **"Price unavailable"**.

---

## 1. Why the schema changed (v1 → v2)

The v1 dataset carried a single `last_checked` per offer, written by the sync
run. That conflated three different questions:

| Question | v1 answer |
|---|---|
| When did *we* download this source? | `last_checked` |
| When does the *source* say it observed this price? | lost |
| When did *we* read it from the registrar itself? | lost |

Because the sync overwrote `last_checked` on every run, **every price looked
freshly verified every morning** — including a Cloudflare row from a community
dump dated 2026-08-04 and a GoDaddy row from a monthly snapshot dated
2026-05-12. The "Last checked" column on the site was therefore reporting our
download time, not the age of the evidence.

v2 separates the timestamps and adds an explicit verification tier.

## 2. Data layout

| File | Contents | Writer |
|---|---|---|
| `data/tlds.json` | IANA delegation metadata (1,437 TLDs) | `npm run sync:tlds` |
| `data/prices.json` | Registrar offers, one row per (registrar, TLD), **schema v2** | `npm run sync:prices` |
| `data/prices-meta.json` | Last attempt/success, counts by tier and freshness, history | `npm run sync:prices` |
| `data/price-sync-report.json` | Machine-readable monitoring report for the run | `npm run sync:prices` |
| `data/price-sync-report.md` | Human-readable summary (also the CI step summary) | `npm run sync:prices` |

The TLD and price pipelines never write each other's files. Price rows reference
the IANA catalog by bare TLD label; rows whose TLD isn't in the catalog are
**rejected** (e.g. registry second-level names like `com.mx`, which have no page
here).

## 3. Provenance model

### 3.1 Three timestamps

| Field | Meaning | Written by |
|---|---|---|
| `source_fetched_at` | When **we** downloaded the source. Says nothing about how old the numbers inside are. | every adapter |
| `price_observed_at` | When the **source** says it observed the price (a dated snapshot's own date). | snapshot adapters |
| `price_verified_at` | When **we** read the figure from the registrar's own published source. `null` for snapshots. | first-party adapters |

`last_checked` is retained as a compatibility alias and is defined as the
**evidence date**: `price_verified_at` when present, otherwise
`price_observed_at`, otherwise `''`. It is **never** the fetch date. This is
enforced in `effectiveEvidenceDate()` (`src/lib/pricingCalc.ts`) and re-checked
by the workflow before publishing.

### 3.2 Verification tiers

| `verification_status` | Meaning | UI label |
|---|---|---|
| `verified` | Read from the registrar's own published price list during a sync run | **Verified** |
| `source_snapshot` | Carried by an openly licensed dated dataset | **Snapshot** |
| `model_derived` | Derived from a documented pricing policy, not a published list | **Modelled** |
| `unverified` | No trustworthy observation date, or upstream flagged it as a placeholder | **Unverified** |

A tier is a property of *how* a figure was obtained, not of how old it is. A
three-year-old snapshot is still `source_snapshot`.

### 3.3 Freshness bands

Derived at build time from the tier plus the evidence date
(`src/config/freshness.ts`):

| Band | Rule | UI label |
|---|---|---|
| `recent` | evidence ≤ 7 days old **and** tier is `verified` | Recently verified |
| `aging` | evidence 8–30 days old, or any snapshot regardless of age | Verification not recent |
| `stale` | evidence > 30 days old, or the source flagged the row stale | Stale |
| `unknown` | no parsable date, date > 1 day in the future, or tier `unverified` | Unverified |

`RECENT_WITHIN_DAYS = 7`, `STALE_AFTER_DAYS = 30`,
`MAX_FUTURE_SKEW_DAYS = 1`. Freshness is **recomputed on every build** from the
evidence date, so a rebuild can only make a price look older, never newer.

### 3.4 Ranking: current evidence wins

`cheapestPoint()` (`src/lib/pricingCalc.ts`) splits the candidates before it
compares prices:

1. **Current pool** — `recent` or `aging`. The cheapest of these is the figure
   the site presents as the price for that extension.
2. **Stale pool** — `stale` or `unknown`. It is only used when the current pool
   is empty; otherwise the cheapest stale figure is attached to the winner as
   `cheaper_stale` and rendered underneath the price with a `↓` marker.

Both halves matter. Ranking purely by price would let a two-month-old snapshot
occupy the "cheapest renewal" slot for `.com` — the exact complaint that led to
this rule: Spaceship's `$10.18` from 2026-09-02 was shown ahead of Dynadot's
verified `$10.88` from the same morning. Ranking purely by freshness and
dropping stale rows would hide a genuinely published, genuinely lower price.
So the stale figure is **disclosed, not deleted**: it keeps its own badges and
its own evidence date, and the reader can see exactly why it was not ranked.

This is a presentation rule only. No price is altered, no date is invented, and
a stale row never becomes `verified` to qualify for the ranking.

### 3.5 Per-source lifecycle: a successful download is not a price update

The offer-level timestamps above answer "how old is this figure?". They do not
answer the question an operator actually asks: **"did the run fetch anything
new?"** Those are different questions, and conflating them is how a pipeline
ends up green every day while serving two-month-old prices.

Each source record in `data/prices.json` therefore carries its own lifecycle
(`scripts/pricing/sourceState.ts`):

| Field | Meaning |
|---|---|
| `last_attempt_at` | When this run tried to read the source. Always this run's clock. |
| `last_successful_fetch_at` | When the adapter last returned rows we **adopted**. A failed, empty or shrunk fetch does not advance it. |
| `price_evidence_at` | The newest evidence date among the rows this source actually publishes. |
| `previous_price_evidence_at` | The same value from the previous run. |
| `evidence_advanced` | `true` only when `price_evidence_at` is **strictly newer** than the previous run's. |
| `evidence_state` | `current` (≤ 7d) · `aging` (8–30d) · `frozen` (> 30d) · `none` (undated). |
| `attempted` / `parsed` / `rejected_total` / `retained_from_previous` | Row accounting, so a fallback is visible rather than implied. |
| `published_rows` | How many of this source's rows survived the merge into the dataset. |

**`frozen` is the state that matters.** It means: the HTTP request succeeded,
the payload parsed, the rows validated — and nothing inside the payload is newer
than 30 days. Re-downloading the same frozen snapshot produces
`evidence_advanced: false` forever. That is a property of the upstream
publisher, not of our code, and the only honest response is to say so.

`data/prices-meta.json` carries a matching `coverage` verdict:

```jsonc
{
  "complete": false,
  "current_sources": ["porkbun", "dynadot", "gandi", "hover", "ionos"],
  "frozen_sources": ["opendomaindata"],
  "stale_sources": [],
  "registrars_without_current_evidence": ["cloudflare", "namecheap", "spaceship", "squarespace"],
  "note": "…"
}
```

`complete` is `true` only when every source is `current`, no source fell back,
**and** every registrar has at least one offer inside the stale threshold. The
verdict is deliberately stricter than `meta.status`, which only reports whether
the collection run succeeded.

## 4. Sources

### 4.1 First-party reads → `verified`

All five are read live on every run. Each writes `price_verified_at` = the run
clock and `price_observed_at` = the same instant.

| Source | Endpoint | Access notes |
|---|---|---|
| **Porkbun** | `api.porkbun.com/api/json/v3/pricing/get` | Official public API, keyless, documented as not requiring auth. |
| **Dynadot** | `dynadot.com/domain/prices` | Server-rendered Nuxt `__NUXT_DATA__` payload, decoded from devalue. A struck `original_reg_price` above the current price marks a promotion. |
| **Gandi** | `gandi.net/en-US/domain/tld?prefix=<a–z>` | 27 server-rendered HTML tables, 1 s delay between requests. A `Promo $X $Y` cell is read as current = `$Y`. |
| **Hover** | `hover.com/domain-pricing` | `data-props` JSON on the page; array shape `[availabilityFlag, register, renewal, transfer, …]`. |
| **IONOS** | `ionos.com/domains/domain-name-prices` | Next.js `__NEXT_DATA__`; columns `welcomeOffer` (year 1), `specialOffer` (existing customer), `regularRenewalFee`, `domainTransfer`. The bundle price is never used. |

**Access policy.** Each adapter performs a plain HTTP GET with an identifying
user agent (`TLD-Directory-PriceSync/2.0`), only on paths the site's
`robots.txt` allows, at a low request rate. No authentication, no JavaScript
execution, no anti-bot circumvention, no per-domain availability lookups.

**Promotions.** A promotion is recorded only when the source itself presents
one (a struck original price, a `Promo` label, a first-year rate below the
renewal rate). `promotion_expires_at` is filled **only** from an explicit end
date the source publishes — never inferred. An expired promotion is rendered as
`Promotion ended` and is excluded from the "cheapest" badge.

### 4.2 Openly licensed datasets → `source_snapshot`

| Source | Licence | Cadence / notes |
|---|---|---|
| **Best Domain Registrars** (`best-domain-registrars.com/data`) | CC BY 4.0 | Per-registrar CSV **plus a verification taxonomy**. Rows marked `sample` are dropped entirely (currently Squarespace); `model_confirmed` becomes `model_derived` (currently Cloudflare); `verified` becomes `source_snapshot`, because that attestation belongs to the publisher — it is not a read we performed, and claiming it as `verified` would let a third party's claim masquerade as ours. |
| **Pikkly** (`pikkly.dev/data/domains/prices.json`) | CC BY 4.0 | Rebuilt daily; rows with `meta.dump_date` use the dump date, not the rebuild time. Source-flagged `stale` rows stay stale; `unavailable` rows are skipped. |
| **Open Domain Data** (`opendomaindata.org/api/tld_pricing.json`) | CC BY 4.0 | Monthly snapshot, USD-normalised. Each record carries its own `last_checked`. |

Attribution strings are stored in `data/prices.json` → `sources[].attribution`
and rendered on `/data-sources/`. A CC BY source without an attribution string
fails the workflow's dataset check.

### 4.3 Evaluated and rejected

Measured again on **2026-10-24** with a descriptive user agent and no
challenge-solving. Every status below is an observed HTTP result, not an
assumption carried over from an earlier note.

| Source | Observed | Why not used |
|---|---|---|
| **Spaceship** | `GET /pricing/` → **403** (Cloudflare "Just a moment…" interstitial) | Bot challenge. Reading it would need JavaScript execution or challenge evasion, which the access policy forbids. No public price API. |
| **Namecheap** | `GET /domains/domain-pricing/` → **403**; API docs → **403** | Same interstitial. The documented XML API (`namecheap.users.getPricing`) needs `ApiUser` + `ApiKey` + the calling IP allow-listed on the account. Blocked on credentials, not on code. |
| **GoDaddy** | `GET /tlds/com-domain` → **403**, `robots.txt` → **403** | Same interstitial. The public API needs a key/secret pair; no documented per-TLD price endpoint exists. |
| **Cloudflare Registrar** | `domains.cloudflare.com/api/tlds` → **403**; marketing page carries no figures | Sells at cost and publishes no per-TLD price list. Pikkly's licensed, normalised copy is the only machine-readable source, which is why Cloudflare rows are `source_snapshot` and can go stale. |
| **Squarespace Domains** | `squarespace.com/domain-pricing` → **404**; `domains.squarespace.com` → 200 but is a search page with no price table | No published list. Upstream marks its rows `sample`, so they are quarantined as `unverified`. |
| **name.com / DNSimple APIs** | — | Require account keys. Adapter-ready when a key exists. |
| **Commercial pricing APIs** | — | Paid; no budget approved. The adapter registry keeps them pluggable. |
| **Cloudflare community dumps** | — | Reachable only via Pikkly's licensed, normalised copy — preferred over mirroring a dated GitHub dump. |
| **Comparison-site scraping** | — | Violates their terms; the sanctioned machine-readable alternatives above are used instead. |
| **Per-domain quote scraping** | — | Rejected by policy: anti-bot circumvention, ToS risk, and it produces a price for a *name*, not a published list price. |

**What the frozen sources actually cost us.** On 2026-10-24 the five
third-party-only registrars carried these evidence dates, none of which our
pipeline can advance:

| Registrar | Published rows | Newest evidence | Age at 2026-10-24 | Upstream that owns the date |
|---|---|---|---|---|
| Cloudflare Registrar | 387 | 2026-08-04 | 81 days | Pikkly (community dump date) |
| Namecheap | 32 | 2026-08-19 | 66 days | Open Domain Data (monthly) |
| Spaceship | 262 | 2026-09-02 | 52 days | Best Domain Registrars |
| GoDaddy | 6 | 2026-10-21 | 3 days | Best Domain Registrars |
| Squarespace Domains | 6 | 2026-05-12 (undated) | — | Open Domain Data (placeholder) |

These are shown as **Stale**/**Unverified**, excluded from cheapest-price
ranking, and listed under "Registrars with no current quote" in every run
summary. No first-party adapter is shipped for them because none could be
validated against a live response — see §14.

## 5. Merge: how conflicts are resolved

One offer survives per `(registrar, TLD)`. Ranking, in order
(`scripts/pricing/merge.ts`):

1. **Verification tier** — `verified` > `source_snapshot` > `model_derived` >
   `unverified`. Checked **before** age on purpose: a snapshot downloaded an
   hour ago is still a snapshot and must not displace a first-party read.
2. **Evidence age** — within the same tier, the fresher observation wins.
3. **Source priority** — stable tie-break so output is deterministic.

Distinct registrars are never collapsed: a comparison needs all of them.

`upgradedByVerification` counts the cases where tier beat age — the exact
situations the old merge got wrong.

## 6. Validation (row → rejected)

- **unknown-tld** — not in `data/tlds.json`
- **invalid-price** — present but ≤ 0, NaN, or > $100,000; also when a source
  string fails to parse (the row carries `invalid_fields`)
- **missing-currency** — row doesn't declare USD (no FX conversion happens here)
- **invalid-url** / **invalid-timestamp** — non-http(s) source/purchase URL, or
  an unparsable date
- **unverifiable** — a `verified` claim with **no** `price_verified_at`, or an
  unknown `verification_status`. This is the guard that stops an adapter from
  "verifying" rows using the fetch clock.
- **duplicate** — same (registrar, TLD) twice inside one source batch
- **no-price** — all three price fields null
- **missing-identity** — empty registrar id/name

Deliberately **not** a reject rule: a snapshot row with no observation date.
Those are kept and surface as `unverified`, because dropping them would silently
shrink the catalogue.

## 7. Migration (v1 → v2)

`scripts/pricing/migrate.ts` upgrades any dataset on disk, and is idempotent:

- `last_checked` → `price_observed_at`
- `price_verified_at` set **only** for sources that are first-party reads we
  perform (`porkbun`); everything else stays `null`
- `verification_status` = `verified` only for those rows, otherwise
  `source_snapshot`
- `source_fetched_at` filled from the dataset's own `generated_at`, never from
  `now`
- `changed: false` when the input is already v2

The build-time store (`src/lib/pricing.ts`) applies the same rules in memory, so
an un-migrated file still renders honestly.

## 8. Monitoring report

Every run writes two files that answer one question: *how much of what we
publish do we actually stand behind?*

`data/price-sync-report.json` contains:

- `totals.by_verification` and `totals.by_freshness` — counts per tier and band
- `totals.oldest_observed_at` / `newest_observed_at` — the evidence span
- `totals.previous_offers` / `offer_count_change_pct` — the same count last run,
  so a collapse is visible and enforceable
- `sources[]` — per-source lifecycle: `status`, `attempted`, `rows`,
  `published_rows`, `rejected`, `retained_from_previous`, `last_attempt_at`,
  `last_successful_fetch_at`, `price_evidence_at`,
  `previous_price_evidence_at`, `evidence_advanced`, `evidence_state`, `error`
- `registrars_detail[]` — per-registrar `offers`, `current`, `stale`, `unknown`,
  `newest_evidence_at`, `oldest_evidence_at`, `evidence_state`, `sources`. This
  is the reader-facing view: a source can be healthy while covering one
  registrar from a frozen dump.
- `coverage` — the same verdict as `prices-meta.json`, so the report cannot
  claim more than the dataset does
- `frozen_sources[]` — sources that downloaded fine and delivered nothing newer
  than 30 days
- `significant_changes[]` — figures that moved by ≥ 20% since the previous run
- `degraded_sources[]` — sources that failed or fell back to previous data
- `summary` — one-paragraph plain-language statement, including the coverage
  verdict

`data/price-sync-report.md` is the same content rendered for humans and is
appended to the GitHub Actions run summary. It leads with two tables — one per
source, one per registrar — plus explicit sections for frozen upstreams and
registrars with no current quote. The workflow also emits `::warning::`
annotations for each frozen or non-`ok` source, so the problem is visible on the
run page without opening the log. Both files are uploaded as artefacts on every
run (including failures) and committed alongside the dataset when the dataset
changes.

## 9. Dataset guards (run → run)

1. Source fetch throws → previous rows for that source kept
   (`kept-previous`), other sources still update.
2. Source returns **0 valid rows** → treated as failure; previous rows kept.
3. Source shrinks by **> 50%** vs the previous run → `shrunk-kept-previous`.
4. **All** sources failed → exit 1, `data/prices.json` **byte-for-byte
   untouched**, failure recorded in `data/prices-meta.json` only.
5. Writes are atomic (`.tmp` + rename).
6. Rows kept from a previous run retain their **original** `source_fetched_at`;
   the run does not claim today's fetch time for data it didn't fetch.
7. A fallback does **not** advance `last_successful_fetch_at` — otherwise "last
   successful fetch" would just mean "last time cron fired".
8. No offer may carry evidence dated **later** than the read that produced it
   (checked in the workflow, one day of tolerance for date-only upstream
   fields). This is what stops a fetch clock from masquerading as evidence.
9. `coverage.complete` may not be `true` while any source is `frozen`, and
   `coverage.frozen_sources` must match the dataset exactly.
10. The offer count may not fall by **more than 20%** against the previous run;
    a collapse is an integrity event, not a market event.
11. The report's per-registrar breakdown must account for every published offer
    exactly once.

## 10. Three-year cost

```
three_year_usd = register_usd + 2 × renewal_usd     (null unless both exist)
```

Promotional first-year prices stay in the registration column with a visible
promo flag and are never used for a "best long-term value" claim — that follows
the 3-year column, which is driven by standard renewal prices.

## 11. Adapter architecture

```
scripts/pricing/
  http.ts                     # dependency-free fetch/CSV/HTML helpers, shared UA
  sources/porkbun.ts          # one file per provider: pure parse* + fetch*
  sources/dynadot.ts          # (parse* is fixture-testable, fetch* does I/O)
  sources/gandi.ts
  sources/hover.ts
  sources/ionos.ts
  sources/bestdomainregistrars.ts
  sources/pikkly.ts
  sources/opendomaindata.ts
  sources/index.ts            # SourceAdapter registry: add a provider = 1 file + 1 line
  validate.ts                 # tier-aware row validation
  merge.ts                    # tier → age → priority
  sourceState.ts              # per-source attempt/success/evidence + coverage
  migrate.ts                  # v1 → v2, idempotent
  report.ts                   # JSON + Markdown monitoring report
scripts/sync-prices.ts        # orchestration, guards, atomic writes, meta, report
```

`SourceAdapter` = `{ id, name, url, license, attribution, priority,
verificationStatus, requiresEnv[], fetchOffers(now) }`. A credentialed provider
lists its env var names in `requiresEnv`; a missing var marks that source
`kept-previous` rather than failing the run. Credentials come from GitHub
Actions secrets only — never committed.

## 12. Adding a provider

1. Create `scripts/pricing/sources/<provider>.ts` exporting a pure
   `parse<Provider>()` and a `fetch<Provider>(now)`.
2. Decide the tier honestly. If you are not reading the registrar's own
   published source, it is **not** `verified`.
3. Register it in `scripts/pricing/sources/index.ts` with a priority and the
   correct `verificationStatus`.
4. Add a fixture plus parse/validation tests in `tests/pricing.test.ts`.
5. If it requires credentials, add the secret in GitHub → Settings → Secrets →
   Actions and document it here.

No affiliate IDs are ever baked into data. Affiliate links are configured
per-registrar in `src/config/registrars.ts` (`affiliate.buildUrl`) only from a
real agreement; rankings never read that field.

## 13. How the data reaches the live site

`.github/workflows/sync-prices.yml` runs daily (04:45 UTC) and:

1. syncs the sources above (`npm run sync:prices`),
2. verifies the dataset — schema v2, ≥ 500 offers, CC BY attribution present,
   the provenance invariants (a `verified` row has a `price_verified_at`, a
   non-verified row does not, and `last_checked` equals the evidence date), the
   per-source lifecycle invariants (§3.5: every source has an attempt time, a
   success time for `status: ok`, an `evidence_state`, and no offer dated later
   than the read that produced it), and the coverage verdict,
3. appends `data/price-sync-report.md` to the run summary and uploads the report
   as an artefact,
4. runs the test suite,
5. commits `data/prices.json`, `data/prices-meta.json` and the two report files
   to `main` **only when the dataset changed**,
6. builds with `PUBLIC_SITE_URL=https://tld-directory.pages.dev`,
7. publishes `dist/` with
   `wrangler pages deploy --project-name tld-directory --branch main`,
8. verifies the live site serves the dataset it just built.

The publish step is skipped when the live deployment already publishes the
current commit, and refuses to overwrite a *newer* live deployment. If the sync
fails, the deploy never runs and the site keeps serving the last successful
dataset — degraded sources are reported in the report and the run summary, never
silently dropped. Setup, secrets and recovery recipes: `docs/DEPLOYMENT.md` §3.

## 14. Credential-gated providers — what is required, and why no adapter ships yet

Four of the five stale registrars could in principle be read first-party, but
only through an authenticated API. **No adapter is shipped for them**, because
none could be validated against a live response: the documentation endpoints are
themselves behind the same bot challenge (`namecheap.com/support/api/...` →
HTTP 403 on 2026-10-24). Shipping an unvalidated parser would mean publishing
guesses about a paid API's response shape — and, for Namecheap, guessing whether
`Price` or `YourPrice` is the retail figure would risk publishing a reseller
rate as a public price. That is exactly the kind of fabrication this pipeline
exists to prevent.

What each one needs, precisely:

| Registrar | Credential / action required | Env vars (when implemented) | Notes |
|---|---|---|---|
| **Namecheap** | API access enabled on the account, then the **calling IP allow-listed**. GitHub-hosted runners use rotating egress IPs, so this needs a self-hosted runner or a fixed-IP proxy. | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_USERNAME` | `namecheap.users.getPricing`, `ProductType=DOMAIN`, categories `register`/`renew`/`transfer`. Must use the retail `Price` attribute, never `YourPrice`. |
| **Spaceship** | Reseller API key, if the account has API access. | `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` | No public price endpoint; the storefront is challenge-protected. |
| **GoDaddy** | API key + secret (production, not OTE). | `GODADDY_API_KEY`, `GODADDY_API_SECRET` | No documented per-TLD price endpoint; would need to be confirmed before any adapter is written. |
| **Cloudflare Registrar** | Not obtainable via API. Registrar API lists *your* domains, not prices. | — | Would require a licensed wholesale-price dataset. |
| **Squarespace** | None available. | — | No published list; upstream data is placeholder. |

Once credentials exist, the adapter shape is fixed by
`SourceAdapter.requiresEnv`: a missing var marks that source `kept-previous`,
keeps its previous rows, and never blocks the other seven sources. The first run
with real credentials must be inspected against the run summary before the
result is trusted — the adapter is only "fixed" once a live response has been
parsed into usable quotes.
