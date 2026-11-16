# Registrar price sync report

- Run: `2026-11-16T13:07:57.196Z`
- Dataset: `2026-11-16T13:07:57.196Z`
- Offers: **3554** across **811** TLDs, **10** registrars (previous run: 3554, 0%)
- Verification: Verified 2850 · Snapshot 698 · Modelled 0 · Unverified 6
- Freshness: Recently verified 2850 · Verification not recent 17 · Stale 681 · Unverified 6
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 2 sources did not deliver usable data (namecheap, bestdomainregistrars); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 913 | 541 | 372 | 541 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-15 12:14:46Z | yes | current |
| dynadot | Verified | ok | 820 | 626 | 194 | 626 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-15 12:14:46Z | yes | current |
| gandi | Verified | ok | 854 | 759 | 95 | 759 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-15 12:14:46Z | yes | current |
| hover | Verified | ok | 514 | 497 | 17 | 497 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-15 12:14:46Z | yes | current |
| ionos | Verified | kept-previous | 0 | 427 | 0 | 427 | 427 | 2026-11-16 13:07:57Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | no | current |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-11-16 13:07:57Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 1393 | 1377 | 16 | 268 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-10-21 | 2026-10-21 | no | aging |
| pikkly | Snapshot | ok | 3329 | 3232 | 97 | 398 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-11-10 | 2026-11-10 | no | current |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 38 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | 2026-08-19 | 2026-08-19 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 387 | 0 | 387 | 0 | 2026-08-04 | 2026-08-04 | **frozen** | pikkly |
| Dynadot (`dynadot`) | 630 | 630 | 0 | 0 | 2026-11-16 13:07:57Z | 2026-11-10 | current | dynadot, pikkly |
| Gandi (`gandi`) | 765 | 765 | 0 | 0 | 2026-11-16 13:07:57Z | 2026-11-10 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 6 | 6 | 0 | 0 | 2026-10-21 | 2026-10-21 | aging | bestdomainregistrars |
| Hover (`hover`) | 498 | 498 | 0 | 0 | 2026-11-16 13:07:57Z | 2026-11-10 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | current | ionos |
| Namecheap (`namecheap`) | 32 | 0 | 32 | 0 | 2026-08-19 | 2026-08-19 | **frozen** | opendomaindata |
| Porkbun (`porkbun`) | 541 | 541 | 0 | 0 | 2026-11-16 13:07:57Z | 2026-11-16 13:07:57Z | current | porkbun |
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
| porkbun | .nyc | register | 26.26 | 5.66 | -78.4% |
| dynadot | .bot | register | 50 | 14.2 | -71.6% |
| dynadot | .hot | register | 43.02 | 13.06 | -69.6% |
| dynadot | .deal | register | 32.32 | 9.85 | -69.5% |
| dynadot | .fast | register | 24.29 | 7.71 | -68.3% |
| dynadot | .now | register | 32.32 | 10.92 | -66.2% |
| dynadot | .free | register | 32.32 | 11.45 | -64.6% |
| dynadot | .talk | register | 32.32 | 11.45 | -64.6% |
| dynadot | .spot | register | 21.62 | 7.71 | -64.3% |
| dynadot | .eat | register | 343.06 | 123.06 | -64.1% |
| dynadot | .fly | register | 343.06 | 123.06 | -64.1% |
| dynadot | .here | register | 343.06 | 123.06 | -64.1% |
| dynadot | .moi | register | 21.4 | 7.71 | -64% |
| dynadot | .you | register | 18.94 | 7.71 | -59.3% |
| porkbun | .bot | register | 52.01 | 22 | -57.7% |
| porkbun | .deal | register | 31.41 | 14 | -55.4% |
| porkbun | .hot | register | 41.71 | 19 | -54.4% |
| porkbun | .fast | register | 23.69 | 11 | -53.6% |
| porkbun | .now | register | 31.41 | 15 | -52.2% |
| porkbun | .free | register | 31.41 | 16 | -49.1% |
| porkbun | .talk | register | 31.41 | 16 | -49.1% |
| porkbun | .moi | register | 21.11 | 11 | -47.9% |
| porkbun | .spot | register | 21.11 | 11 | -47.9% |
| porkbun | .you | register | 18.54 | 11 | -40.7% |

## Summary

3554 offers across 811 TLDs and 10 registrars. 2850 (80%) were read directly from the registrar's own published price list; 698 come from openly licensed dated snapshots; 0 are policy-derived; 6 cannot be dated. 681 offers (19%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 2 sources did not deliver usable data (namecheap, bestdomainregistrars); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots. Sources not fully refreshed: ionos (kept-previous), namecheap (kept-previous).
