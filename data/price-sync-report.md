# Registrar price sync report

- Run: `2026-11-18T13:25:36.713Z`
- Dataset: `2026-11-18T13:25:36.713Z`
- Offers: **3558** across **811** TLDs, **10** registrars (previous run: 3554, +0.1%)
- Verification: Verified 2854 · Snapshot 698 · Modelled 0 · Unverified 6
- Freshness: Recently verified 2427 · Verification not recent 444 · Stale 681 · Unverified 6
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 4 sources did not deliver usable data (ionos, namecheap, bestdomainregistrars, pikkly); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 913 | 541 | 372 | 541 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-17 13:49:30Z | yes | current |
| dynadot | Verified | ok | 820 | 626 | 194 | 626 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-17 13:49:30Z | yes | current |
| gandi | Verified | ok | 855 | 760 | 95 | 760 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-17 13:49:30Z | yes | current |
| hover | Verified | ok | 517 | 500 | 17 | 500 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-17 13:49:30Z | yes | current |
| ionos | Verified | kept-previous | 0 | 427 | 0 | 427 | 427 | 2026-11-18 13:25:36Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | no | aging |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-11-18 13:25:36Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 1393 | 1377 | 16 | 268 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-10-21 | 2026-10-21 | no | aging |
| pikkly | Snapshot | ok | 3329 | 3232 | 97 | 398 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-11-10 | 2026-11-10 | no | aging |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 38 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | 2026-08-19 | 2026-08-19 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 387 | 0 | 387 | 0 | 2026-08-04 | 2026-08-04 | **frozen** | pikkly |
| Dynadot (`dynadot`) | 630 | 630 | 0 | 0 | 2026-11-18 13:25:36Z | 2026-11-10 | current | dynadot, pikkly |
| Gandi (`gandi`) | 766 | 766 | 0 | 0 | 2026-11-18 13:25:36Z | 2026-11-10 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 6 | 6 | 0 | 0 | 2026-10-21 | 2026-10-21 | aging | bestdomainregistrars |
| Hover (`hover`) | 501 | 501 | 0 | 0 | 2026-11-18 13:25:36Z | 2026-11-10 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | aging | ionos |
| Namecheap (`namecheap`) | 32 | 0 | 32 | 0 | 2026-08-19 | 2026-08-19 | **frozen** | opendomaindata |
| Porkbun (`porkbun`) | 541 | 541 | 0 | 0 | 2026-11-18 13:25:36Z | 2026-11-18 13:25:36Z | current | porkbun |
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

- ionos (kept-previous)
- namecheap (kept-previous)

## Significant price changes (>20%)

| Registrar | TLD | Field | Previous | Current | Change |
|---|---|---|---|---|---|
| dynadot | .eat | register | 123.06 | 13.06 | -89.4% |
| dynadot | .fly | register | 123.06 | 13.06 | -89.4% |
| dynadot | .here | register | 123.06 | 13.06 | -89.4% |

## Summary

3558 offers across 811 TLDs and 10 registrars. 2854 (80%) were read directly from the registrar's own published price list; 698 come from openly licensed dated snapshots; 0 are policy-derived; 6 cannot be dated. 681 offers (19%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 4 sources did not deliver usable data (ionos, namecheap, bestdomainregistrars, pikkly); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots. Sources not fully refreshed: ionos (kept-previous), namecheap (kept-previous).
