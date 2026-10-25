# Registrar price sync report

- Run: `2026-10-25T03:16:24.986Z`
- Dataset: `2026-10-25T03:16:24.986Z`
- Offers: **3549** across **811** TLDs, **10** registrars (previous run: 3549, 0%)
- Verification: Verified 2845 · Snapshot 698 · Modelled 0 · Unverified 6
- Freshness: Recently verified 2845 · Verification not recent 17 · Stale 681 · Unverified 6
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 1 source did not deliver usable data (namecheap); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 912 | 540 | 372 | 540 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 02:56:19Z | yes | current |
| dynadot | Verified | ok | 816 | 622 | 194 | 622 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 02:56:19Z | yes | current |
| gandi | Verified | ok | 853 | 759 | 94 | 759 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 02:56:19Z | yes | current |
| hover | Verified | ok | 514 | 497 | 17 | 497 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 02:56:19Z | yes | current |
| ionos | Verified | ok | 431 | 427 | 4 | 427 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-25 02:56:19Z | yes | current |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-10-25 03:16:24Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 1393 | 1377 | 16 | 268 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-21 | 2026-10-21 | no | current |
| pikkly | Snapshot | ok | 3328 | 3231 | 97 | 398 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-10-24 | 2026-10-24 | no | current |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 38 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | 2026-08-19 | 2026-08-19 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 387 | 0 | 387 | 0 | 2026-08-04 | 2026-08-04 | **frozen** | pikkly |
| Dynadot (`dynadot`) | 626 | 626 | 0 | 0 | 2026-10-25 03:16:24Z | 2026-10-24 | current | dynadot, pikkly |
| Gandi (`gandi`) | 765 | 765 | 0 | 0 | 2026-10-25 03:16:24Z | 2026-10-24 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 6 | 6 | 0 | 0 | 2026-10-21 | 2026-10-21 | current | bestdomainregistrars |
| Hover (`hover`) | 498 | 498 | 0 | 0 | 2026-10-25 03:16:24Z | 2026-10-24 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | current | ionos |
| Namecheap (`namecheap`) | 32 | 0 | 32 | 0 | 2026-08-19 | 2026-08-19 | **frozen** | opendomaindata |
| Porkbun (`porkbun`) | 540 | 540 | 0 | 0 | 2026-10-25 03:16:24Z | 2026-10-25 03:16:24Z | current | porkbun |
| Spaceship (`spaceship`) | 262 | 0 | 262 | 0 | 2026-09-02 | 2026-09-02 | **frozen** | bestdomainregistrars |
| Squarespace Domains (`squarespace`) | 6 | 0 | 0 | 6 | 2026-05-12 | 2026-05-12 | no data | opendomaindata |

## Sources that downloaded but delivered no new evidence

These sources were read successfully and their payload was accepted, but nothing inside it is newer than 30 days. The workflow being green does not mean these prices are current.

- **opendomaindata** — newest evidence 2026-08-19, previous 2026-08-19, 38 published rows.

## Registrars with no current quote

Every published figure for these registrars is older than the stale threshold or undated, so the site shows their prices as historical snapshots and never as the current best price.

- **Cloudflare Registrar** — 387 offers, newest evidence 2026-08-04, sources: pikkly.
- **Namecheap** — 32 offers, newest evidence 2026-08-19, sources: opendomaindata.
- **Spaceship** — 262 offers, newest evidence 2026-09-02, sources: bestdomainregistrars.
- **Squarespace Domains** — 6 offers, newest evidence 2026-05-12, sources: opendomaindata.

## Sources needing attention

- namecheap (kept-previous)

## Summary

3549 offers across 811 TLDs and 10 registrars. 2845 (80%) were read directly from the registrar's own published price list; 698 come from openly licensed dated snapshots; 0 are policy-derived; 6 cannot be dated. 681 offers (19%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 1 source did not deliver usable data (namecheap); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots. Sources not fully refreshed: namecheap (kept-previous).
