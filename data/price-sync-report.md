# Registrar price sync report

- Run: `2026-10-23T11:09:35.227Z`
- Dataset: `2026-10-23T11:09:35.227Z`
- Offers: **3549** across **811** TLDs, **10** registrars
- Verification: Verified 2844 · Snapshot 699 · Modelled 0 · Unverified 6
- Freshness: Recently verified 2844 · Verification not recent 18 · Stale 681 · Unverified 6
- Oldest evidence date: `2026-05-12`

| Source | Tier | Status | Rows | Rejected | Oldest observation | Error |
|---|---|---|---|---|---|---|
| porkbun | Verified | ok | 540 | 372 | 2026-10-23T11:09:35.227Z | — |
| dynadot | Verified | kept-previous | 621 | 0 | 2026-10-23T07:52:41.892Z | Dynadot payload contained no usable prices |
| gandi | Verified | ok | 759 | 94 | 2026-10-23T11:09:35.227Z | — |
| hover | Verified | ok | 497 | 17 | 2026-10-23T11:09:35.227Z | — |
| ionos | Verified | ok | 427 | 4 | 2026-10-23T11:09:35.227Z | — |
| bestdomainregistrars | Snapshot | ok | 1377 | 16 | 2026-05-12 | — |
| pikkly | Snapshot | ok | 3231 | 97 | 2026-08-04 | — |
| opendomaindata | Snapshot | ok | 593 | 12 | 2026-05-12 | — |

## Sources needing attention

- dynadot (kept-previous)

## Significant price changes (>20%)

| Registrar | TLD | Field | Previous | Current | Change |
|---|---|---|---|---|---|
| gandi | .viajes | register | 66.88 | 143.38 | +114.4% |
| gandi | .viajes | transfer | 56.67 | 121.5 | +114.4% |
| gandi | .viajes | renewal | 127.98 | 274.25 | +114.3% |
| gandi | .cruises | register | 91.67 | 66.88 | -27% |
| gandi | .cruises | transfer | 77.68 | 56.67 | -27% |
| gandi | .business | renewal | 39.98 | 47.98 | +20% |

## Summary

3549 offers across 811 TLDs and 10 registrars. 2844 (80%) were read directly from the registrar's own published price list; 699 come from openly licensed dated snapshots; 0 are policy-derived; 6 cannot be dated. 681 offers (19%) are older than 30 days and are shown as stale. Oldest evidence: 2026-05-12. Sources not fully refreshed: dynadot (kept-previous).
