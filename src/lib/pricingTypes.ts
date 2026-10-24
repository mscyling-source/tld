/**
 * Registrar pricing data model (schema v2).
 *
 * Deliberately separate from the IANA catalog (`src/lib/types.ts`):
 * `data/tlds.json` holds delegation facts sourced from IANA, while
 * `data/prices.json` holds retail offers sourced from registrar price
 * lists and openly-licensed datasets. The two pipelines never write to
 * each other's files.
 *
 * Rules encoded in this schema:
 *   - A missing value is `null` — never `0`, never guessed.
 *   - Every offer carries THREE distinct timestamps, because they answer
 *     three different questions and conflating them is what made the old
 *     dataset dishonest:
 *       `source_fetched_at` — when WE downloaded the source file. Says
 *                             nothing about how old the numbers inside it are.
 *       `price_observed_at`— when the SOURCE says it saw the price (a dated
 *                             snapshot's own observation date).
 *       `price_verified_at`— when WE read the figure from the registrar's own
 *                             published source. Null for snapshot rows.
 *     `last_checked` is retained as a compatibility alias and is defined as
 *     the *evidence* date (verified → verified, else observed), never the
 *     fetch date. See `effectiveEvidenceDate`.
 *   - `verification_status` records HOW a figure was obtained, independently
 *     of how old it is. A 3-year-old snapshot is `source_snapshot`, not
 *     `verified`, no matter that we downloaded it this morning.
 *   - `currency` is always `'USD'`: all upstream sources publish
 *     USD-normalised figures (Porkbun quotes USD directly; Pikkly, Open
 *     Domain Data and the registrar pages themselves state USD).
 *
 * Schema v1 → v2 migration lives in `scripts/pricing/migrate.ts`; v1 files
 * keep working because every new field is optional at read time.
 */

/**
 * How a price figure was obtained. Defined here (not in the config module) so
 * the data model has no import cycle; `src/config/freshness.ts` imports these
 * and owns the thresholds and labels.
 */
export type VerificationStatus = 'verified' | 'source_snapshot' | 'model_derived' | 'unverified';

/** How old the evidence behind a figure is, derived at build time. */
export type PriceFreshness = 'recent' | 'aging' | 'stale' | 'unknown';

/** The four comparable price figures carried by an offer. */
export type PriceField = 'register_usd' | 'renewal_usd' | 'transfer_usd' | 'three_year_usd';

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
   * Explicit promotion end date published by a trustworthy source, ISO date.
   * Never derived from anything else. When present and in the past, the offer
   * must not be shown as an active promotion.
   */
  promotion_expires_at: string | null;
  /**
   * Best-effort 3-year ownership cost = registration + 2 × renewal.
   * Only set when BOTH prices exist; otherwise null (see `calcThreeYear`).
   */
  three_year_usd: number | null;
  /** Source adapter that produced this row (`porkbun` | `pikkly` | …). */
  source_id: string;
  /** Human-readable source name for display ("Porkbun pricing API"). */
  source_name: string;
  /** Per-row source page (where the price was observed). */
  source_url: string;
  /** Ordinary (non-affiliate) link to the registrar for purchasing; null when no link is known. */
  purchase_url: string | null;

  /* ---- v2 provenance: three timestamps that must never be conflated ---- */

  /** When we downloaded this source. Says nothing about the figures' age. */
  source_fetched_at: string;
  /** When the source states it observed the price. null when unknown. */
  price_observed_at: string | null;
  /** When we read the figure from the registrar itself. null for snapshots. */
  price_verified_at: string | null;
  /** HOW the figure was obtained. Never derived from a fetch timestamp. */
  verification_status: VerificationStatus;

  /**
   * Compatibility alias for the pre-v2 frontend field. Defined as the
   * *evidence* date: `price_verified_at` for first-party reads, otherwise
   * `price_observed_at`. Never the fetch date. Kept so existing consumers and
   * older generated data keep working.
   */
  last_checked: string;

  /**
   * Derived at build time from `verification_status` + the evidence date
   * (see `src/config/freshness.ts`). Recomputed on every build so it can only
   * ever degrade with age, never be refreshed by a rebuild.
   */
  freshness: PriceFreshness;

  /**
   * Legacy v1 aggregate quality flag, still emitted so existing JSON consumers
   * do not break. `verified` ⇔ freshness is `recent` or `aging`.
   */
  quality: 'verified' | 'stale';

  /**
   * Set when the upstream source itself marked this row as stale. Such a row
   * can never be presented as fresh, whatever its own date says.
   */
  source_status_stale: boolean;
}

/**
 * A cheaper figure that was deliberately kept out of the headline because its
 * evidence is too old to be presented as a current quote.
 *
 * The figure is *disclosed*, not deleted: hiding a cheaper published price
 * would misrepresent the market just as badly as passing an eight-week-old
 * number off as today's price. It is carried on the winning `PricePoint` so
 * the UI can say "cheaper, but stale, here it is" next to the current price.
 */
export interface CheaperEvidence {
  usd: number;
  registrar_id: string;
  registrar_name: string;
  verification_status: VerificationStatus;
  freshness: PriceFreshness;
  last_checked: string;
}

/** A single price figure plus which registrar offers it and how fresh it is. */
export interface PricePoint {
  usd: number;
  registrar_id: string;
  registrar_name: string;
  verification_status: VerificationStatus;
  freshness: PriceFreshness;
  /** The evidence date behind this figure (see `effectiveEvidenceDate`). */
  last_checked: string;
  /** True when the source presents this figure as a first-year promotion. */
  promotional: boolean;
  /** True when the promotion's explicit end date has already passed. */
  promotion_expired: boolean;
  /** Legacy v1 quality flag, derived from `freshness`. */
  quality: 'verified' | 'stale';
  /**
   * A strictly cheaper quote whose evidence is stale or undated, excluded from
   * the ranking but disclosed. Null when the winner really is the cheapest.
   */
  cheaper_stale: CheaperEvidence | null;
  /**
   * True when no current quote exists for this field at all and this point is
   * the best stale/undated fallback. Callers must then say that current data is
   * insufficient instead of presenting the figure as today's best price.
   */
  no_current_evidence: boolean;
}

/** Per-TLD aggregation used by the homepage comparison table. */
export interface ComparisonRow {
  suffix: string;
  tld: string;
  type: string | null;
  offers: number;
  /** Offers read from a registrar's own published source (any age). */
  verified_offers: number;
  /** Offers whose evidence is older than the stale threshold or unknown. */
  stale_offers: number;
  register: PricePoint | null;
  renewal: PricePoint | null;
  transfer: PricePoint | null;
  three_year: PricePoint | null;
  /** Best-effort outbound link: registrar of the cheapest registration (or next available). */
  visit_url: string;
  visit_registrar: string;
  /** Display names of every registrar with an offer for this TLD. */
  registrars: string[];
  /** Freshest evidence date across this TLD's offers. */
  latest_checked: string;
  /**
   * True when NO offer for this TLD was read from a registrar's own source.
   * The UI must qualify the cheapest price in that case instead of presenting
   * it as a current best.
   */
  only_snapshots: boolean;
}

/**
 * How much current evidence a source is actually delivering, as opposed to
 * whether the download succeeded.
 *
 * The distinction matters more than any other in this file. A source can be
 * downloaded perfectly every day and still deliver nothing new — that is
 * exactly what a frozen third-party snapshot looks like, and reporting it as
 * `ok` is how a green pipeline ends up serving eight-week-old prices.
 */
export type SourceEvidenceState = 'current' | 'aging' | 'frozen' | 'none';

/** Source provenance recorded in `data/prices.json`. */
export interface PriceSourceInfo {
  id: string;
  name: string;
  /** Human-facing source page. */
  url: string;
  license: string;
  /** Attribution string required by the licence (null when not required). */
  attribution: string | null;
  /** How this source's figures are obtained (drives offer classification). */
  verification_status: VerificationStatus;
  /** Rows this source contributes to the published dataset (after merge). */
  rows: number;
  /**
   * @deprecated Compatibility alias for `last_successful_fetch_at`. Kept
   * because older consumers read it; never write a timestamp here that is not
   * a *successful* fetch, or a failed run would look like a fresh one.
   */
  fetched_at: string;
  /** Oldest observation date carried by the source's rows, when known. */
  oldest_observed_at: string | null;
  status: 'ok' | 'kept-previous' | 'failed' | 'shrunk-kept-previous';
  error?: string;
  /** Rows rejected by validation, grouped by reason. */
  rejections?: Record<string, number>;

  /* ---- per-source lifecycle: three timestamps, never conflated ---- */

  /** When this run tried to read the source. Always this run's clock. */
  last_attempt_at: string;
  /**
   * When the adapter last returned at least one valid row that we adopted.
   * Null when it has never succeeded. A failed or fallback run does NOT
   * advance this — otherwise "last successful fetch" would just mean "last
   * time cron fired".
   */
  last_successful_fetch_at: string | null;
  /**
   * The newest price-evidence date among this source's published rows.
   *
   * This is the field that answers "are these prices current?". For a
   * first-party read it equals the read time; for a snapshot it is the
   * upstream dataset's own observation date, which does not move when we
   * re-download an unchanged file.
   */
  price_evidence_at: string | null;
  /** `price_evidence_at` as recorded by the previous run, for comparison. */
  previous_price_evidence_at: string | null;
  /**
   * True when `price_evidence_at` is strictly newer than the previous run's.
   * False means we downloaded the source again and got no newer evidence —
   * the signature of a frozen upstream.
   */
  evidence_advanced: boolean;
  /** Evidence band for the source as a whole (see `SourceEvidenceState`). */
  evidence_state: SourceEvidenceState;
  /** Rows carried over from the previous dataset because the fetch failed. */
  retained_from_previous: number;
  /** Rows the adapter returned before validation (0 when it never ran). */
  attempted: number;
  /** Rows that passed validation. */
  parsed: number;
  /** Rows rejected by validation, all reasons. */
  rejected_total: number;
  /** Rows from this source that survived the cross-source merge. */
  published_rows: number;
}

export interface PriceDataset {
  schema_version: 2;
  generated_at: string;
  currency: 'USD';
  sources: PriceSourceInfo[];
  offers: PriceOffer[];
}

/** Coverage verdict published in `data/prices-meta.json`. */
export interface PriceCoverage {
  /**
   * True only when every source delivered current evidence, no source fell
   * back to previous rows, and every registrar has at least one offer whose
   * evidence is within the stale threshold.
   */
  complete: boolean;
  /** Sources whose newest evidence is within `RECENT_WITHIN_DAYS`. */
  current_sources: string[];
  /** Sources that downloaded fine but carry evidence older than the stale threshold. */
  frozen_sources: string[];
  /** Sources that failed, were skipped for missing credentials, or fell back. */
  stale_sources: string[];
  /** Registrars for which no offer has evidence inside the stale threshold. */
  registrars_without_current_evidence: string[];
  /** Human-readable one-line verdict, rendered verbatim in the report. */
  note: string;
}

export interface PriceMeta {
  last_success_at: string | null;
  last_attempt_at: string;
  status: 'ok' | 'partial' | 'failed';
  last_error: string | null;
  /**
   * Whether the published dataset is actually backed by current evidence.
   *
   * `status` answers "did the collection run succeed?"; this answers "is the
   * data current?". They are different questions and the pipeline used to
   * report only the first, so a run that re-downloaded four frozen snapshots
   * looked exactly like a run that refreshed everything.
   */
  coverage?: PriceCoverage;
  counts: {
    offers: number;
    tlids: number;
    registrars: number;
    /** Offers read from a registrar's own published source (any age). */
    verified_offers: number;
    /**
     * Offers in the `stale` band alone (evidence older than
     * `STALE_AFTER_DAYS`). Deliberately NOT `stale + unknown`: `unknown` has
     * its own counter, and folding it in here made this file disagree with
     * both `price-sync-report.json` → `totals.by_freshness.stale` and the
     * site's own `PriceStats.staleOffers`. Every counter in this object names
     * exactly one band.
     */
    stale_offers: number;
    recent_offers: number;
    aging_offers: number;
    unknown_offers: number;
    by_source: Record<string, number>;
    by_verification: Record<VerificationStatus, number>;
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
  promotion_expires_at?: string | null;
  source_id: string;
  source_url: string;
  /** Set when the source publishes an explicit purchase/deep link. */
  purchase_url: string | null;
  /** When the source states it observed this price (null when unknown). */
  price_observed_at: string | null;
  /** Set only when we read the figure from the registrar's own source. */
  price_verified_at?: string | null;
  /** How this row was obtained. Defaults to `source_snapshot` when absent. */
  verification_status?: VerificationStatus;
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