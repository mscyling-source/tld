# Registrar price sync report

- Run: `2026-11-03T12:20:27.167Z`
- Dataset: `2026-11-03T12:20:27.167Z`
- Offers: **3550** across **811** TLDs, **10** registrars (previous run: 3550, 0%)
- Verification: Verified 2846 · Snapshot 698 · Modelled 0 · Unverified 6
- Freshness: Recently verified 2846 · Verification not recent 17 · Stale 681 · Unverified 6
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 2 sources did not deliver usable data (namecheap, bestdomainregistrars); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 913 | 541 | 372 | 541 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-02 12:51:34Z | yes | current |
| dynadot | Verified | ok | 816 | 622 | 194 | 622 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-02 12:51:34Z | yes | current |
| gandi | Verified | ok | 853 | 759 | 94 | 759 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-02 12:51:34Z | yes | current |
| hover | Verified | ok | 514 | 497 | 17 | 497 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-02 12:51:34Z | yes | current |
| ionos | Verified | ok | 431 | 427 | 4 | 427 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-02 12:51:34Z | yes | current |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-11-03 12:20:27Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 1393 | 1377 | 16 | 268 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-10-21 | 2026-10-21 | no | aging |
| pikkly | Snapshot | ok | 3329 | 3232 | 97 | 398 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-11-03 | 2026-10-28 | yes | current |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 38 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | 2026-08-19 | 2026-08-19 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 387 | 0 | 387 | 0 | 2026-08-04 | 2026-08-04 | **frozen** | pikkly |
| Dynadot (`dynadot`) | 626 | 626 | 0 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 | current | dynadot, pikkly |
| Gandi (`gandi`) | 765 | 765 | 0 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 6 | 6 | 0 | 0 | 2026-10-21 | 2026-10-21 | aging | bestdomainregistrars |
| Hover (`hover`) | 498 | 498 | 0 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | current | ionos |
| Namecheap (`namecheap`) | 32 | 0 | 32 | 0 | 2026-08-19 | 2026-08-19 | **frozen** | opendomaindata |
| Porkbun (`porkbun`) | 541 | 541 | 0 | 0 | 2026-11-03 12:20:27Z | 2026-11-03 12:20:27Z | current | porkbun |
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

## Significant price changes (>20%)

| Registrar | TLD | Field | Previous | Current | Change |
|---|---|---|---|---|---|
| porkbun | .realty | register | 93.2 | 10.8 | -88.4% |
| porkbun | .property | register | 52.01 | 10.8 | -79.2% |
| porkbun | .love | register | 8.75 | 2.56 | -70.7% |
| porkbun | .icu | register | 3.59 | 1.54 | -57.1% |
| porkbun | .diy | register | 4.63 | 2.56 | -44.7% |
| porkbun | .food | register | 4.63 | 2.56 | -44.7% |
| porkbun | .lifestyle | register | 4.63 | 2.56 | -44.7% |
| porkbun | .living | register | 4.63 | 2.56 | -44.7% |
| porkbun | .bar | register | 2.57 | 1.53 | -40.5% |
| porkbun | .art | register | 3.6 | 2.18 | -39.4% |
| porkbun | .bond | register | 1.8 | 1.28 | -28.9% |
| porkbun | .cfd | register | 1.8 | 1.28 | -28.9% |
| porkbun | .cyou | register | 1.8 | 1.28 | -28.9% |
| porkbun | .sbs | register | 1.8 | 1.28 | -28.9% |
| porkbun | .qpon | register | 2.05 | 1.54 | -24.9% |
| porkbun | .buzz | register | 2.05 | 1.64 | -20% |

## Summary

3550 offers across 811 TLDs and 10 registrars. 2846 (80%) were read directly from the registrar's own published price list; 698 come from openly licensed dated snapshots; 0 are policy-derived; 6 cannot be dated. 681 offers (19%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 2 sources did not deliver usable data (namecheap, bestdomainregistrars); no current quote exists for cloudflare, namecheap, spaceship, squarespace — their figures are historical snapshots. Sources not fully refreshed: namecheap (kept-previous).
