/**
 * Registrar pricing data model.
 *
 * Deliberately separate from the IANA catalog (`src/lib/types.ts`):
 * `data/tlds.json` holds delegation facts sourced from IANA, while
 * `data/prices.json` holds retail offers sourced from registrar price
 * lists and openly-licensed datasets. The two pipelines never write to
 * each other's files.
 *
 * Rules encoded in this schema:
 *   - A missing value is `null` — never `0`, never guessed.
 *   - Every offer carries its own source URL and check timestamp, so the
 *     UI can show "last checked" per row instead of claiming real-time data.
 *   - `currency` is always `'USD'`: all upstream sources publish
 *     USD-normalised figures (Porkbun quotes USD directly; Pikkly and
 *     Open Domain Data normalise to USD and state so in their payloads).
 */

export type PriceQuality = 'verified' | 'stale';

/** One registrar's offer for one TLD (merged, unique per registrar+TLD). */
export interface PriceOffer {
  /** Bare ASCII label, lowercase, no leading dot (e.g. `com`, `co.uk`). */
  tld: string;
  /** Canonical registrar id (e.g. `porkbun`, `cloudflare`). */
  registrar_id: string;
  /** Display name (e.g. `Porkbun`). */
  registrar_name: string;
  currency: 'USD';
  /** First-year registration price. null = source does not publish it. */
  register_usd: number | null;
  /** Standard annual renewal price. null = not published. */
  renewal_usd: number | null;
  /** Transfer-in price (usually includes a 1-year extension). null = not published. */
  transfer_usd: number | null;
  /** True when the source explicitly flags the registration price as promotional. */
  promotional: boolean;
  /** Promotion code when the source publishes one. Never invented. */
  promo_code: string | null;
  /** Documented eligibility restrictions for the promotion. Never invented. */
  promo_restrictions: string | null;
  /**
   * Best-effort 3-year ownership cost = registration + 2 × renewal.
   * Only set when BOTH prices exist; otherwise null (see `calcThreeYear`).
   */
  three_year_usd: number | null;
  /** Source adapter that produced this row (`porkbun` | `pikkly` | `opendomaindata`). */
  source_id: string;
  /** Per-row source page (where the price was observed). */
  source_url: string;
  /** Ordinary (non-affiliate) link to the registrar for purchasing; null when no link is known. */
  purchase_url: string | null;
  /**
   * Effective last-checked date: the most conservative timestamp the source
   * exposes (e.g. Pikkly rows sourced from a dated dump use the dump date,
   * not the daily rebuild time).
   */
  last_checked: string;
  /** Computed at sync time from `last_checked` — recomputed at build time too. */
  quality: PriceQuality;
  /** True when the upstream source itself flagged the row as stale. */
  source_status_stale: boolean;
}

/** A single price figure plus which registrar offers it and how fresh it is. */
export interface PricePoint {
  usd: number;
  registrar_id: string;
  registrar_name: string;
  quality: PriceQuality;
  last_checked: string;
}

/** Per-TLD aggregation used by the homepage comparison table. */
export interface ComparisonRow {
  suffix: string;
  tld: string;
  type: string | null;
  offers: number;
  verified_offers: number;
  register: PricePoint | null;
  renewal: PricePoint | null;
  transfer: PricePoint | null;
  three_year: PricePoint | null;
  /** Best-effort outbound link: registrar of the cheapest registration (or next available). */
  visit_url: string;
  visit_registrar: string;
  /** Display names of every registrar with an offer for this TLD. */
  registrars: string[];
  /** Freshest `last_checked` across this TLD's offers. */
  latest_checked: string;
}

/** Source provenance recorded in `data/prices.json`. */
export interface PriceSourceInfo {
  id: string;
  name: string;
  /** Human-facing source page. */
  url: string;
  license: string;
  /** Attribution string required by the licence (null when not required). */
  attribution: string | null;
  rows: number;
  fetched_at: string;
  status: 'ok' | 'kept-previous' | 'failed' | 'shrunk-kept-previous';
  error?: string;
}

export interface PriceDataset {
  schema_version: 1;
  generated_at: string;
  currency: 'USD';
  sources: PriceSourceInfo[];
  offers: PriceOffer[];
}

export interface PriceMeta {
  last_success_at: string | null;
  last_attempt_at: string;
  status: 'ok' | 'partial' | 'failed';
  last_error: string | null;
  counts: {
    offers: number;
    tlids: number;
    registrars: number;
    verified_offers: number;
    stale_offers: number;
    by_source: Record<string, number>;
  };
  history: Array<{ at: string; status: string; offers: number; note?: string }>;
}

/** Intermediate offer shape produced by source adapters, before merge/quality. */
export interface RawOffer {
  tld: string;
  registrar_id: string;
  registrar_name: string;
  currency: string;
  register_usd: number | null;
  renewal_usd: number | null;
  transfer_usd: number | null;
  promotional: boolean;
  promo_code: string | null;
  promo_restrictions: string | null;
  source_id: string;
  source_url: string;
  /** Set when the source publishes an explicit purchase/deep link. */
  purchase_url: string | null;
  /** ISO date the price was observed (conservative). */
  last_checked: string;
  /** Set when the upstream source itself marked this row stale. */
  source_status_stale: boolean;
  /**
   * Field names whose source value was present but unusable (negative,
   * NaN, above the sanity ceiling). A non-empty list rejects the row —
   * garbage in one figure casts doubt on the whole quote.
   */
  invalid_fields?: string[];
}

export interface SourceBatch {
  sourceId: string;
  /** Lower wins when two sources tie on freshness. */
  priority: number;
  offers: RawOffer[];
}
