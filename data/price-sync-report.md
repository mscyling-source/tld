# Registrar price sync report

- Run: `2026-11-24T15:15:57.655Z`
- Dataset: `2026-11-24T15:15:57.655Z`
- Offers: **4247** across **811** TLDs, **10** registrars (previous run: 3558, +19.4%)
- Verification: Verified 2854 · Snapshot 1131 · Modelled 0 · Unverified 262
- Freshness: Recently verified 2427 · Verification not recent 1394 · Stale 164 · Unverified 262
- Oldest evidence date: `2026-05-12`
- Coverage: **incomplete** — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 3 sources did not deliver usable data (ionos, namecheap, pikkly); no current quote exists for squarespace — their figures are historical snapshots.

## Sources

| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 913 | 541 | 372 | 541 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-23 15:20:42Z | yes | current |
| dynadot | Verified | ok | 820 | 626 | 194 | 626 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-23 15:20:42Z | yes | current |
| gandi | Verified | ok | 855 | 760 | 95 | 760 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-23 15:20:42Z | yes | current |
| hover | Verified | ok | 517 | 500 | 17 | 500 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-23 15:20:42Z | yes | current |
| ionos | Verified | kept-previous | 0 | 427 | 0 | 427 | 427 | 2026-11-24 15:15:57Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | no | aging |
| namecheap | Verified | kept-previous | 0 | 0 | 0 | 0 | 0 | 2026-11-24 15:15:57Z | — | — | — | no | no data |
| bestdomainregistrars | Snapshot | ok | 2627 | 2580 | 47 | 1217 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-23 | 2026-10-21 | yes | current |
| pikkly | Snapshot | ok | 3329 | 3232 | 97 | 175 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-11-10 | 2026-11-10 | no | aging |
| opendomaindata | Snapshot | ok | 605 | 593 | 12 | 1 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | 2026-05-12 | 2026-08-19 | no | **frozen** |

## Registrars

| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |
|---|---|---|---|---|---|---|---|---|
| Cloudflare Registrar (`cloudflare`) | 389 | 225 | 164 | 0 | 2026-11-10 | 2026-08-04 | aging | bestdomainregistrars, pikkly |
| Dynadot (`dynadot`) | 630 | 630 | 0 | 0 | 2026-11-24 15:15:57Z | 2026-11-10 | current | dynadot, pikkly |
| Gandi (`gandi`) | 766 | 766 | 0 | 0 | 2026-11-24 15:15:57Z | 2026-11-10 | current | gandi, pikkly |
| GoDaddy (`godaddy`) | 195 | 195 | 0 | 0 | 2026-11-23 | 2026-11-23 | current | bestdomainregistrars |
| Hover (`hover`) | 501 | 501 | 0 | 0 | 2026-11-24 15:15:57Z | 2026-11-10 | current | hover, pikkly |
| IONOS (`ionos`) | 427 | 427 | 0 | 0 | 2026-11-10 12:58:16Z | 2026-11-10 12:58:16Z | aging | ionos |
| Namecheap (`namecheap`) | 274 | 274 | 0 | 0 | 2026-11-23 | 2026-11-23 | current | bestdomainregistrars |
| Porkbun (`porkbun`) | 541 | 541 | 0 | 0 | 2026-11-24 15:15:57Z | 2026-11-24 15:15:57Z | current | porkbun |
| Spaceship (`spaceship`) | 262 | 262 | 0 | 0 | 2026-11-09 | 2026-11-09 | aging | bestdomainregistrars |
| Squarespace Domains (`squarespace`) | 262 | 0 | 0 | 262 | 2026-11-11 | 2026-05-12 | no data | bestdomainregistrars, opendomaindata |

## Sources that downloaded but delivered no new evidence

These sources were read successfully and their payload was accepted, but nothing inside it is newer than 30 days. The workflow being green does not mean these prices are current.

- **opendomaindata** — newest evidence 2026-05-12, previous 2026-08-19, 1 published rows.

## Registrars with no current quote

Every published figure for these registrars is older than the stale threshold or undated, so the site shows their prices as historical snapshots and never as the current best price.

- **Squarespace Domains** — 262 offers, newest evidence 2026-11-11, sources: bestdomainregistrars, opendomaindata.

## Sources needing attention

- ionos (kept-previous)
- namecheap (kept-previous)

## Significant price changes (>20%)

| Registrar | TLD | Field | Previous | Current | Change |
|---|---|---|---|---|---|
| spaceship | .me | register | 1.48 | 8.7 | +487.8% |
| spaceship | .biz | register | 1.24 | 6.68 | +438.7% |
| spaceship | .rent | register | 1.18 | 4.55 | +285.6% |
| spaceship | .co | register | 4.98 | 15.53 | +211.8% |
| namecheap | .host | renewal | 47.48 | 125.98 | +165.3% |
| namecheap | .vip | renewal | 10.98 | 24.98 | +127.5% |
| cloudflare | .co | register | 15 | 30 | +100% |
| squarespace | .com | transfer | 11 | 22 | +100% |
| cloudflare | .store | register | 42.2 | 4.99 | -88.2% |
| cloudflare | .fun | register | 30.2 | 4.99 | -83.5% |
| cloudflare | .online | register | 27.7 | 4.99 | -82% |
| cloudflare | .site | register | 27.7 | 4.99 | -82% |
| cloudflare | .space | register | 25.2 | 4.99 | -80.2% |
| cloudflare | .tech | register | 49.2 | 9.99 | -79.7% |
| namecheap | .biz | register | 8.48 | 2.48 | -70.8% |
| namecheap | .store | renewal | 43.98 | 66.98 | +52.3% |
| spaceship | .fans | register | 8.46 | 4.18 | -50.6% |
| namecheap | .club | register | 4.98 | 2.48 | -50.2% |
| namecheap | .host | register | 9.99 | 4.98 | -50.2% |
| namecheap | .fun | renewal | 33.48 | 48.98 | +46.3% |
| spaceship | .events | renewal | 36.43 | 51.95 | +42.6% |
| cloudflare | .app | register | 14.2 | 8.2 | -42.3% |
| squarespace | .org | register | 15 | 9 | -40% |
| spaceship | .ltd | renewal | 25.04 | 34.36 | +37.2% |
| spaceship | .store | renewal | 32.88 | 20.68 | -37.1% |
| spaceship | .domains | register | 34.36 | 46.78 | +36.1% |
| spaceship | .domains | renewal | 34.36 | 46.78 | +36.1% |
| cloudflare | .io | register | 50 | 32 | -36% |
| namecheap | .tech | renewal | 58.98 | 78.98 | +33.9% |
| squarespace | .co | register | 30 | 40 | +33.3% |
| squarespace | .co | renewal | 30 | 40 | +33.3% |
| squarespace | .net | transfer | 15 | 20 | +33.3% |
| squarespace | .org | transfer | 15 | 20 | +33.3% |
| cloudflare | .dev | register | 12.2 | 8.2 | -32.8% |
| spaceship | .app | register | 6.41 | 8.48 | +32.3% |
| spaceship | .dev | register | 6.41 | 8.48 | +32.3% |
| spaceship | .one | register | 6.41 | 4.34 | -32.3% |
| namecheap | .app | register | 10.98 | 7.48 | -31.9% |
| namecheap | .dev | register | 10.98 | 7.48 | -31.9% |
| spaceship | .garden | register | 1.78 | 1.24 | -30.3% |

_…and 20 more._

## Summary

4247 offers across 811 TLDs and 10 registrars. 2854 (67%) were read directly from the registrar's own published price list; 1131 come from openly licensed dated snapshots; 0 are policy-derived; 262 cannot be dated. 164 offers (4%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Coverage: incomplete — 1 source downloaded successfully but carries no evidence newer than 30 days (opendomaindata); 3 sources did not deliver usable data (ionos, namecheap, pikkly); no current quote exists for squarespace — their figures are historical snapshots. Sources not fully refreshed: ionos (kept-previous), namecheap (kept-previous).
