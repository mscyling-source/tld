/**
 * Build-time pricing store.
 *
 * Reads `data/prices.json` (written by scripts/sync-prices.ts) and joins it
 * with the IANA catalog for types. All functions run during `astro build` —
 * no runtime I/O.
 *
 * Freshness is recomputed from each offer's source `last_checked` at build
 * time, so a rebuild can never make old prices look "current": quality only
 * ever degrades with age (source-flagged stale rows never upgrade).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ComparisonRow, PriceDataset, PriceMeta, PriceOffer } from './pricingTypes.js';
import { cheapestPoint, effectiveQuality } from './pricingCalc.js';
import { loadAllRecords } from './store.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRICES_PATH = path.join(DATA_DIR, 'prices.json');
const PRICES_META_PATH = path.join(DATA_DIR, 'prices-meta.json');

let cache: { dataset: PriceDataset | null; meta: PriceMeta | null } | null = null;

async function readPrices(): Promise<{ dataset: PriceDataset | null; meta: PriceMeta | null }> {
  if (cache) return cache;
  const read = async (p: string) => {
    try {
      return JSON.parse(await fs.readFile(p, 'utf-8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  cache = { dataset: await read(PRICES_PATH), meta: await read(PRICES_META_PATH) };
  return cache;
}

/** Full price dataset (null before the first successful sync). */
export async function readPriceDataset(): Promise<PriceDataset | null> {
  return (await readPrices()).dataset;
}

/** Price sync metadata (last run, counts, history). */
export async function readPriceMeta(): Promise<PriceMeta | null> {
  return (await readPrices()).meta;
}

/** Freshness-adjusted offers for one TLD (`com` or `.com`). */
export async function getOffersForTld(tld: string): Promise<PriceOffer[]> {
  const ds = await readPrices();
  if (!ds?.dataset) return [];
  const bare = tld.replace(/^\./, '').toLowerCase();
  const now = new Date();
  return ds.dataset.offers
    .filter(o => o.tld === bare)
    .map(o => ({ ...o, quality: effectiveQuality(o, now) }));
}

/**
 * Per-TLD cheapest-price rows for the homepage comparison table.
 * Only TLDs with at least one offer appear — every other extension is
 * simply "no price data yet", never a guess.
 */
export async function buildComparisonRows(): Promise<ComparisonRow[]> {
  const ds = await readPrices();
  if (!ds?.dataset) return [];
  const now = new Date();

  const records = await loadAllRecords();
  const typeByTld = new Map<string, string | null>();
  for (const r of records) typeByTld.set(r.ascii_name, r.normalized_type);

  const byTld = new Map<string, PriceOffer[]>();
  for (const offer of ds.dataset.offers) {
    const list = byTld.get(offer.tld) ?? [];
    list.push(offer);
    byTld.set(offer.tld, list);
  }

  const rows: ComparisonRow[] = [];
  for (const [tld, offers] of byTld) {
    // Refresh quality against the build clock for honest sorting/filtering.
    const fresh = offers.map(o => ({ ...o, quality: effectiveQuality(o, now) }));
    const register = cheapestPoint(fresh, 'register_usd', now);
    const renewal = cheapestPoint(fresh, 'renewal_usd', now);
    const transfer = cheapestPoint(fresh, 'transfer_usd', now);
    const threeYear = cheapestPoint(fresh, 'three_year_usd', now);

    const firstPoint = register ?? renewal ?? transfer ?? threeYear;
    const registrars = [...new Set(fresh.map(o => o.registrar_name))].sort((a, b) =>
      a.localeCompare(b, 'en'),
    );
    const latest = fresh.reduce(
      (max, o) => (Date.parse(o.last_checked) > Date.parse(max) ? o.last_checked : max),
      fresh[0].last_checked,
    );

    rows.push({
      suffix: `.${tld}`,
      tld,
      type: typeByTld.get(tld) ?? null,
      offers: fresh.length,
      verified_offers: fresh.filter(o => o.quality === 'verified').length,
      register,
      renewal,
      transfer,
      three_year: threeYear,
      visit_url: firstPoint
        ? fresh.find(o => o.registrar_id === firstPoint.registrar_id)?.purchase_url ?? ''
        : '',
      visit_registrar: firstPoint?.registrar_name ?? '',
      registrars,
      latest_checked: latest,
    });
  }

  return rows.sort((a, b) => a.suffix.localeCompare(b.suffix, 'en'));
}

/** Headline numbers for the homepage / footer. */
export async function getPriceStats(): Promise<{
  tlids: number;
  registrars: number;
  offers: number;
  generatedAt: string | null;
  sources: Array<{ id: string; name: string; url: string; license: string; attribution: string | null; status: string }>;
} | null> {
  const { dataset, meta } = await readPrices();
  if (!dataset) return null;
  const registrars = new Set(dataset.offers.map(o => o.registrar_id));
  return {
    tlids: new Set(dataset.offers.map(o => o.tld)).size,
    registrars: registrars.size,
    offers: dataset.offers.length,
    generatedAt: dataset.generated_at,
    sources: dataset.sources.map(s => ({
      id: s.id,
      name: s.name,
      url: s.url,
      license: s.license,
      attribution: s.attribution,
      status: s.status,
    })),
  };
}
