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

**A source that never succeeded must stay unsuccessful.** The deprecated
compatibility alias `fetched_at` is written as `last_successful_fetch_at`, and is
**`null`** when a source has never returned adopted rows. Writing the attempt
time there instead would let the *next* run read it back as a successful fetch,
so a permanently-unconfigured source (Namecheap without credentials, say) would
end up looking like it once worked. `previousSuccessfulFetchFrom` therefore
distinguishes *absent* (a dataset written before the field existed → fall back
to `fetched_at`) from *explicitly null* (a modern dataset saying "never
succeeded" → keep null). Both cases are pinned by tests.

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

Five are read live on every run with no credentials. A sixth, Namecheap, is
first-party but credential-gated and is skipped — not faked — until the
environment is configured (§14.1). Each writes `price_verified_at` = the run
clock and `price_observed_at` = the same instant.

| Source | Endpoint | Access notes |
|---|---|---|
| **Porkbun** | `api.porkbun.com/api/json/v3/pricing/get` | Official public API, keyless, documented as not requiring auth. |
| **Dynadot** | `dynadot.com/domain/prices` | Server-rendered Nuxt `__NUXT_DATA__` payload, decoded from devalue. A struck `original_reg_price` above the current price marks a promotion. See "Dynadot: Nuxt 4 migration and display currency" below. |
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

**Dynadot: Nuxt 4 migration and display currency.** On 2026-10-25 Dynadot
moved from a Nuxt 2 payload to a Nuxt 4 one, which broke the adapter in two
independent ways. Both are now covered by tests against a real captured
response.

1. *Payload shape.* The root is no longer a bare object; it is wrapped
   (`[["ShallowReactive", 1], {...}]`), and so are nested values
   (`["Ref", 7]`, `["EmptyRef"]`). `decodeDevalue` unwraps a fixed allow-list
   of Vue/devalue tags. An unknown tag is treated as ordinary data rather than
   silently unwrapped, so a real array that merely starts with a capitalised
   string cannot be mistaken for a wrapper.
2. *Currency.* The page renders in the visitor's selected currency, and with no
   preference the server picks one by geography — the same URL serves `$10.88`
   to one network and `€9.96` to another. The adapter sends the site's own
   `glbl_curr=USD` cookie (the cookie the page itself sets when a visitor picks
   US Dollar) and then **verifies** the payload really is priced in USD before
   publishing anything, using the row's declared `google_data.currency` and
   falling back to the printed symbol. A non-USD payload throws with the
   currencies it found (`currencies present: EUR×820`) and the source keeps its
   previous rows. A EUR figure is never converted, and never relabelled.

Verified against the live page on 2026-10-25: with the cookie the adapter
extracts 816 rows and `com` reads `10.88 / 10.88 / 10.88` — identical to the
USD figures the previous dataset held, confirming the cookie selects a currency
rather than changing the price.

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

Re-measured on **2026-10-25** with a descriptive user agent and no
challenge-solving. Every HTTP status below is an observed result from that day,
not an assumption carried over from an earlier note; the API conclusions are
quoted from the providers' own documentation, also re-read on 2026-10-25.

| Source | Observed 2026-10-25 | Why not used |
|---|---|---|
| **Spaceship** | `GET /pricing/` → **403**, `GET /domain-pricing/` → **403** (Cloudflare "Just a moment…" interstitial) | Bot challenge. Reading it would need JavaScript execution or challenge evasion, which the access policy forbids. The official API has no price catalogue — see below. |
| **Namecheap** | `GET /domains/domain-pricing/` → **403**; API docs → **403** | Same interstitial on the website. The documented XML API *is* usable and is implemented — see §14. |
| **GoDaddy** | `GET /tlds/com-domain` → **403**, `robots.txt` → **403** | Same interstitial on the website. The official API cannot supply a catalogue — see below. |
| **Cloudflare Registrar** | `domains.cloudflare.com/api/tlds` → **403**; marketing page carries no figures | Sells at cost and publishes no per-TLD price list, and the Registrar API has no price endpoint — see below. |
| **Squarespace Domains** | `squarespace.com/domain-pricing` → 301 → `www.squarespace.com/domain-pricing` → **404** (356 KB 404 page, no challenge, no figures); `domains.squarespace.com/domain-pricing` → **404** | No published list anywhere. Upstream marks its rows `sample`, so they are quarantined as `unverified`. |
| **name.com / DNSimple APIs** | — | Require account keys. Adapter-ready when a key exists. |
| **Commercial pricing APIs** | — | Paid; no budget approved. The adapter registry keeps them pluggable. |
| **Cloudflare community dumps** | Repo last pushed **2026-08-04** | Reachable only via Pikkly's licensed, normalised copy — preferred over mirroring a dated GitHub dump. The upstream tracker has not been updated since. |
| **Comparison-site scraping** | — | Violates their terms; the sanctioned machine-readable alternatives above are used instead. |
| **Per-domain quote scraping** | — | Rejected by policy: anti-bot circumvention, ToS risk, and it produces a price for a *name*, not a published list price. |

**What the three official APIs actually offer** (documentation re-read
2026-10-25; quoted verbatim):

- **Spaceship** (`docs.spaceship.dev`) exposes domain management, availability
  and settings endpoints only. There is no TLD price catalogue. The only price
  fields anywhere are `premiumPricing[].{operation,price,currency}` inside an
  availability response, and the documented example shows only
  `"operation": "register"` — nothing guarantees a renewal or transfer figure.
  Rate limits are 30 requests / 30 s for availability checks. **Conclusion: a
  per-domain availability quote is not a published TLD price, so no adapter is
  built.**
- **GoDaddy** Domains v3 (`developer.godaddy.com/doc/endpoint/domains`) is a
  quote-execute model: discover → quote → register → poll. The docs state
  *"Prices are indicative; locked pricing is only established at quote time"*
  and, under Conventions, *"Availability and suggestions return indicative
  prices; quotes lock the price."* There is no TLD catalogue endpoint; renewals
  and transfers are not even in v3. Rate limit 60 req/min per credential.
  **Conclusion: an indicative per-domain quote is not a catalogue price, so no
  adapter is built.**
- **Cloudflare Registrar** (`developers.cloudflare.com/api/resources/registrar/`)
  returns pricing only per queried domain: `domain-search` / `domain-check`
  give `pricing.{currency, registration_cost, renewal_cost}`, and
  `domain-transfer-check` gives `pricing.{currency, transfer_cost,
  renewal_cost}`. The `extensions` endpoint returns `ExtensionListResponse`
  with `metadata` and the registration/transfer **schemas** — no price fields.
  Every endpoint is scoped to `{account_id}` and needs a token with Registrar
  permissions plus a billing profile. **Conclusion: no catalogue endpoint; a
  per-domain quote would need 811 queries against an account-scoped API.**

**Alternative lawful sources for Cloudflare and Squarespace** (checked
2026-10-25, including actual record dates rather than file mtimes):

| Provider | Candidate source | Rows | Newest evidence | Verdict |
|---|---|---|---|---|
| Cloudflare | Pikkly (CC BY 4.0), traced to the `CF-Registrar-Tracker` community dump | 387 | 2026-08-04 | Best available, but the upstream repo's last push is 2026-08-04 — the tracker itself has stopped. |
| Cloudflare | Open Domain Data (CC BY 4.0), dataset `last_checked` 2026-08-19 | 7 | 2026-06-01 | Fewer rows and older than Pikkly. |
| Squarespace | Open Domain Data | 6 | 2026-05-12 | Marked `sample` by the publisher; already quarantined as `unverified`. |
| Squarespace | — | — | — | No lawful machine-readable source exists. |

**What the frozen sources actually cost us.** On 2026-10-25 the
third-party-only registrars carried these evidence dates, none of which our
pipeline can advance:

| Registrar | Published rows | Newest evidence | Age at 2026-10-25 | Upstream that owns the date |
|---|---|---|---|---|
| Cloudflare Registrar | 387 | 2026-08-04 | 82 days | Pikkly (community dump date) |
| Namecheap | 32 | 2026-08-19 | 67 days | Open Domain Data (monthly) |
| Spaceship | 262 | 2026-09-02 | 53 days | Best Domain Registrars |
| GoDaddy | 6 | 2026-10-21 | 4 days | Best Domain Registrars |
| Squarespace Domains | 6 | 2026-05-12 (undated) | — | Open Domain Data (placeholder) |

These are shown as **Stale**/**Unverified**, excluded from cheapest-price
ranking, and listed under "Registrars with no current quote" in every run
summary. Namecheap is the only one of them with a lawful, implemented path to
current prices — see §14.

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
12. `fetched_at` (the deprecated alias) is `null` for a source that has never
    succeeded, so the next run cannot read an attempt time back as a successful
    fetch. A legacy dataset that predates the lifecycle fields still falls back
    to `fetched_at`, because there it meant a *successful* fetch.

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
  xml.ts                      # strict sax-based XML reader (Namecheap's xml.response)
  sources/porkbun.ts          # one file per provider: pure parse* + fetch*
  sources/dynadot.ts          # (parse* is fixture-testable, fetch* does I/O)
  sources/gandi.ts
  sources/hover.ts
  sources/ionos.ts
  sources/namecheap.ts        # credential-gated; skipped (not faked) without env
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
scripts/probe-source.ts       # live credential probe: validate a gated source in one command
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

1. syncs the sources above (`npm run sync:prices`), passing the optional
   Namecheap secrets through — an unset secret is treated as "not configured",
   so adding these lines changes nothing for a repository without them,
2. when a Namecheap key *is* configured, runs `npm run probe:source namecheap`
   as a non-fatal step that appends its verdict to the run log (this is the
   fastest way to see whether the credentials and the IP allowlist actually
   work),
3. verifies the dataset — schema v2, ≥ 500 offers, CC BY attribution present,
   the provenance invariants (a `verified` row has a `price_verified_at`, a
   non-verified row does not, and `last_checked` equals the evidence date), the
   per-source lifecycle invariants (§3.5: every source has an attempt time, a
   success time for `status: ok`, an `evidence_state`, and no offer dated later
   than the read that produced it), and the coverage verdict,
4. appends `data/price-sync-report.md` to the run summary and uploads the report
   as an artefact,
5. runs the test suite,
6. commits `data/prices.json`, `data/prices-meta.json` and the two report files
   to `main` **only when the dataset changed**,
7. builds with `PUBLIC_SITE_URL=https://tld-directory.pages.dev`,
8. publishes `dist/` with
   `wrangler pages deploy --project-name tld-directory --branch main`,
8. verifies the live site serves the dataset it just built.

The publish step is skipped when the live deployment already publishes the
current commit, and refuses to overwrite a *newer* live deployment. If the sync
fails, the deploy never runs and the site keeps serving the last successful
dataset — degraded sources are reported in the report and the run summary, never
silently dropped. Setup, secrets and recovery recipes: `docs/DEPLOYMENT.md` §3.

## 14. Credential-gated providers — what is required, and why some have no adapter

Of the five registrars that cannot be read first-party, **Namecheap has a
complete, implemented adapter**; the other four have been investigated and have
no lawful path to a current price catalogue. Nothing below is claimed to work
without a live, validated response.

### 14.1 Namecheap — adapter implemented, awaiting credentials

`scripts/pricing/sources/namecheap.ts` calls the documented
`namecheap.users.getPricing` XML API (`api.namecheap.com/xml.response`), three
times — `ActionName=REGISTER`, `RENEW`, `TRANSFER` — and merges the results into
one offer per TLD.

**Status: implemented but never validated against a live response.** No
credential exists yet, so there is no evidence the documented schema matches
what the API returns. That is reported as a blocker, not as a fix.

What the adapter does, precisely:

- Publishes **`Price` only** — the documented "final price (it can be from
  regular, userprice, special price, promo price, tier price)". It **never**
  publishes `YourPrice` ("the user's price for the product"), which for a
  reseller account is the cost, not a retail quote. When `Price` is empty the
  row is skipped and counted; it is never back-filled from `YourPrice` or
  `RegularPrice`.
- Reads only `Duration="1"` + `DurationType="YEAR"`, and only `Currency="USD"`.
  A missing or non-USD currency skips the row rather than assuming.
- Fails closed: `Status != "OK"` throws with the documented error number; a
  missing `UserGetPricingResult` throws; a response with no usable 1-year USD
  price throws; a catalogue with fewer than 100 registration prices throws
  rather than replacing a working dataset.
- On an auth failure the error message carries the egress IPv4, because
  "which IP do I allowlist?" is the single most common cause of failure here.

**What you need to supply:**

| Requirement | Detail |
|---|---|
| `NAMECHEAP_API_USER` | The API user (usually the account username). Enable in Profile → Tools → API Access, and tick the API permission. |
| `NAMECHEAP_API_KEY` | The key generated on that page. Stored as a GitHub Actions repository secret. |
| `NAMECHEAP_USERNAME` | The username the command executes for (usually the same as the API user). |
| A fixed egress IPv4 on the account allowlist | **The hard requirement.** Namecheap rejects any IP that is not allow-listed. |
| `NAMECHEAP_CLIENT_IP` | Optional. Only needed when the address Namecheap should see is not the machine's own default egress (e.g. a fixed-IP proxy). |

**The GitHub-hosted-runner problem.** The workflow runs on GitHub's hosted
runners, whose egress addresses come from a rotating Azure pool. Namecheap's
allowlist is per-IP (or per-range), so a hosted runner cannot be allow-listed
reliably. Two workable options:

1. **Self-hosted runner** with a static IP — add that one address to the
   allowlist. Simplest and cheapest if a machine with a stable IP already
   exists.
2. **Fixed-IP egress proxy** — set `HTTPS_PROXY`/`HTTP_PROXY` for the sync step
   (Node's `fetch` honours them via `undici`'s proxy support) and set
   `NAMECHEAP_CLIENT_IP` to the proxy's address.

Do **not** put a real IP address or a key in the repository; both belong in
Actions secrets.

**Validating it yourself, in one command.** Once the three secrets exist and the
allowlist is set:

```bash
NAMECHEAP_API_USER=… NAMECHEAP_API_KEY=… NAMECHEAP_USERNAME=… \
  NAMECHEAP_CLIENT_IP=<the allowlisted address> \
  npm run probe:source namecheap --raw ./tmp/namecheap
```

`npm run probe:source` runs the production request path, prints the TLD count
per action with skip reasons, prints sample prices, and dumps the three response
bodies so the schema can be checked. The API key is redacted from every log
line. Exit code 0 with `VERDICT: validated` is the evidence needed before the
source can be called "fixed"; a `#1011150` / `#1017105` error means the calling
IP is not allow-listed, and the detected address is printed alongside it.

The workflow passes the four secrets through to the sync and, when a key is
present, runs the probe as a non-fatal step that appends its verdict to the run
log. A missing secret arrives as an empty string, which `missingEnvFor` treats
as absent: the source reports `kept-previous`, keeps its previous 32 rows, and
publishes nothing.

### 14.2 The other four — investigated, and why no adapter ships

| Registrar | Credential / action required | Env vars | Why no adapter |
|---|---|---|---|
| **Spaceship** | Reseller API key, if the account has API access. | `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` | The API has **no TLD price catalogue**. Prices appear only as `premiumPricing[]` inside a per-domain availability response, and the docs only show `operation: "register"` — nothing guarantees a renewal or transfer figure. A reseller key does not imply access to a public catalogue. |
| **GoDaddy** | API key + secret (production, not OTE). | `GODADDY_API_KEY`, `GODADDY_API_SECRET` | Domains v3 is quote-execute and the docs state *"Prices are indicative; locked pricing is only established at quote time."* There is no per-TLD catalogue endpoint, and renewals/transfers are not in v3. Treating an availability quote as a published catalogue price is exactly what this pipeline must not do. |
| **Cloudflare Registrar** | Not obtainable via API. | — | Every Registrar endpoint is account-scoped and returns pricing only per queried domain; `extensions` returns schemas, not prices. No lawful catalogue exists, and the community tracker that Pikkly mirrors has not been updated since 2026-08-04. |
| **Squarespace Domains** | None available. | — | No published price list (404) and no API. Upstream data is placeholder and already quarantined as `unverified`. |

Once credentials exist, the adapter shape is fixed by
`SourceAdapter.requiresEnv`: a missing var marks that source `kept-previous`,
keeps its previous rows, and never blocks the other sources. The first run with
real credentials must be inspected against the run summary before the result is
trusted — a source is only "fixed" once a live response has been parsed into
usable quotes.
