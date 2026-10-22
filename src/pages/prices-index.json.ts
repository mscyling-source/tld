/**
 * Static JSON endpoint consumed by the homepage price comparison table and by
 * anyone who wants the dataset without parsing the HTML.
 *
 * `totals` is deliberately included: a consumer of this file should be able to
 * see how much of it was read first-party, how much is a dated snapshot, and
 * how much is stale — without having to re-derive it from the rows.
 */
import type { APIRoute } from 'astro';
import { buildComparisonRows, getPriceStats } from '../lib/pricing.js';

export const GET: APIRoute = async () => {
  const [rows, stats] = await Promise.all([buildComparisonRows(), getPriceStats()]);
  return new Response(
    JSON.stringify({
      schema_version: 2,
      generated_at: stats?.generatedAt ?? null,
      currency: 'USD',
      totals: {
        tlids: stats?.tlids ?? 0,
        registrars: stats?.registrars ?? 0,
        offers: stats?.offers ?? 0,
        verified_offers: stats?.verifiedOffers ?? 0,
        snapshot_offers: stats?.snapshotOffers ?? 0,
        stale_offers: stats?.staleOffers ?? 0,
      },
      sources: stats?.sources ?? [],
      rows,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
};
