# Registrar price sync report

- Run: `2026-11-27T14:19:14.744Z`
- Dataset: `2026-11-27T14:19:14.744Z`
- Offers: **4249** across **811** TLDs, **10** registrars (previous run: 4249, 0%)
- Verification: Verified 2856 · Snapshot 1131 · Modelled 0 · Unverified 262
- Freshness: Recently verified 2429 · Verification not recent 1394 · Stale 164 · Unverified 262
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 3 sources did not deliver usable data (ionos, namecheap, pikkly); no current quote exists for squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 912 | 541 | 371 | 541 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-26 14:25:59Z | yes | current |
| dynadot | Verified | ok | 822 | 628 | 194 | 628 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-26 14:25:59Z | yes | current |
| gandi | Verified | ok | 855 | 760 | 95 | 760 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-26 14:25:59Z | yes | current |
| hover | Verified | ok | 517 | 500 | 17 | 500 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-26 14:25:59Z | yes | current |
| ionos | Verified | kept-previous | 0 | 427 | 0 | 427 | 427 | 2026-11-27 14:19:14Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | no | aging |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-11-27 14:19:14Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 2627 | 2580 | 47 | 1217 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-23 | 2026-11-23 | no | current |
| pikkly | Snapshot | ok | 3329 | 3232 | 97 | 175 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-11-10 | 2026-11-10 | no | aging |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 1 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | 2026-05-12 | 2026-05-12 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 389 | 225 | 164 | 0 | 2026-11-10 | 2026-08-04 | aging | bestdomainregistrars, pikkly |
| Dynadot (`dynadot`) | 632 | 632 | 0 | 0 | 2026-11-27 14:19:14Z | 2026-11-10 | current | dynadot, pikkly |
| Gandi (`gandi`) | 766 | 766 | 0 | 0 | 2026-11-27 14:19:14Z | 2026-11-10 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 195 | 195 | 0 | 0 | 2026-11-23 | 2026-11-23 | current | bestdomainregistrars |
| Hover (`hover`) | 501 | 501 | 0 | 0 | 2026-11-27 14:19:14Z | 2026-11-10 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | aging | ionos |
| Namecheap (`namecheap`) | 274 | 274 | 0 | 0 | 2026-11-23 | 2026-11-23 | current | bestdomainregistrars |
| Porkbun (`porkbun`) | 541 | 541 | 0 | 0 | 2026-11-27 14:19:14Z | 2026-11-27 14:19:14Z | current | porkbun |
| Spaceship (`spaceship`) | 262 | 262 | 0 | 0 | 2026-11-09 | 2026-11-09 | aging | bestdomainregistrars |
| Squarespace Domains (`squarespace`) | 262 | 0 | 0 | 262 | 2026-11-11 | 2026-05-12 | no data | bestdomainregistrars, opendomaindata |

## Sources that downloaded but delivered no new evidence

These sources were read successfully and their payload was accepted, but nothing inside it is newer than 30 days. The workflow being green does not mean these prices are current.

- **opendomaindata** — newest evidence 2026-05-12, previous 2026-05-12, 1 published rows.

## Registrars with no current quote

Every published figure for these registrars is older than the stale threshold or undated, so the site shows their prices as historical snapshots and never as the current best price.

- **Squarespace Domains** — 262 offers, newest evidence 2026-11-11, sources: bestdomainregistrars, opendomaindata.

## Sources needing attention

- ionos (kept-previous)
- namecheap (kept-previous)

## Significant price changes (>20%)

| Registrar | TLD | Field | Previous | Current | Change |
|---|---|---|---|---|---|
| porkbun | .me | register | 17.27 | 2.17 | -87.4% |
| porkbun | .co | register | 15.76 | 2.37 | -85% |
| dynadot | .co | register | 15.5 | 2.6 | -83.2% |
| dynadot | .me | register | 9.21 | 1.81 | -80.3% |
| dynadot | .id | register | 14 | 9.85 | -29.6% |
| porkbun | .cloud | register | 3.88 | 2.87 | -26% |
| porkbun | .one | register | 1.99 | 1.53 | -23.1% |
| porkbun | .mx | register | 17.99 | 13.99 | -22.2% |

## Summary

4249 offers across 811 TLDs and 10 registrars. 2856 (67%) were read directly from the registrar's own published price list; 1131 come from openly licensed dated snapshots; 0 are policy-derived; 262 cannot be dated. 164 offers (4%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 3 sources did not deliver usable data (ionos, namecheap, pikkly); no current quote exists for squarespace — their figures are historical snapshots. Sources not fully refreshed: ionos (kept-previous), namecheap (kept-previous).
