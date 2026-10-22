/**
 * Which sources are first-party reads.
 *
 * A row whose `source_id` is in this set was read by this pipeline from the
 * registrar's own published price list, so it may be classified `verified`.
 * Everything else is a third-party snapshot and must never be.
 *
 * This matters when reading a pre-v2 file: v1 rows carried no
 * `verification_status`, so the only way to classify them honestly is to ask
 * which source produced them. In v1 the only first-party source was `porkbun`
 * (the other four first-party adapters were added with schema v2, and their
 * v1-era rows were carried by Pikkly under `source_id: 'pikkly'`).
 */

export const FIRST_PARTY_SOURCE_IDS: ReadonlySet<string> = new Set([
  'porkbun',
  'dynadot',
  'gandi',
  'hover',
  'ionos',
]);

/** True when rows from this source are first-party reads we performed. */
export function isFirstPartySource(sourceId: string): boolean {
  return FIRST_PARTY_SOURCE_IDS.has(sourceId);
}

/**
 * Registrars whose third-party price data is known to be placeholder.
 *
 * Best Domain Registrars publishes a per-registrar verification taxonomy and
 * marks Squarespace as `sample` — its upstream read was blocked, so the numbers
 * are placeholders rather than observed prices. Open Domain Data repeats the
 * same figures under `public_sources`, which does not carry that warning.
 *
 * Rather than silently publishing them as ordinary dated snapshots (or
 * silently deleting them), their rows are kept but downgraded to `unverified`:
 * the site shows the figures with an explicit "Unverified" badge, they never
 * earn a "cheapest" label, and the reason is documented here and on
 * /data-sources/. Remove an entry only when a source can show it read the
 * registrar directly.
 */
export const UNTRUSTED_REGISTRAR_PRICES: Record<string, string> = {
  squarespace:
    'Squarespace pricing is placeholder data: Best Domain Registrars marks it as a sample because the upstream read was blocked.',
};

