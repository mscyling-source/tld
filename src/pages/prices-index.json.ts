/**
 * Static JSON endpoint consumed by the homepage price comparison table.
 * Generated at build time; one request, no external APIs at runtime.
 */
import type { APIRoute } from 'astro';
import { buildComparisonRows, getPriceStats } from '../lib/pricing.js';

export const GET: APIRoute = async () => {
  const [rows, stats] = await Promise.all([buildComparisonRows(), getPriceStats()]);
  return new Response(
    JSON.stringify({
      generated_at: stats?.generatedAt ?? null,
      rows,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
};
