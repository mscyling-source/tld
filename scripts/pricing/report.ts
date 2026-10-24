/**
 * Price-sync report — machine-readable JSON plus a human-readable Markdown
 * summary, written to `data/`.
 *
 * The report exists to answer one question honestly: *how much of what we
 * publish do we actually stand behind?* It therefore reports evidence age and
 * verification status, not just row counts, and it never reports a fetch
 * timestamp as if it were a verification.
 *
 * Everything here is a pure function of the dataset plus the run's outcome, so
 * the rules are unit-testable without touching the network.
 */

import type {
  PriceCoverage,
  PriceDataset,
  PriceFreshness,
  PriceMeta,
  PriceOffer,
  SourceEvidenceState,
  VerificationStatus,
} from '../../src/lib/pricingTypes.js';
import { effectiveEvidenceDate, effectiveFreshness } from '../../src/lib/pricingCalc.js';
import {
  FRESHNESS_LABEL,
  RECENT_WITHIN_DAYS,
  STALE_AFTER_DAYS,
  VERIFICATION_LABEL,
} from '../../src/config/freshness.js';
import { buildCoverage } from './sourceState.js';

export interface SourceReport {
  source_id: string;
  source_name: string;
  status: string;
  verification_status: VerificationStatus;
  /** Rows this source contributed to the merge (before supersession). */
  rows: number;
  /** Rows the adapter returned before validation (0 when it never ran). */
  attempted: number;
  /** Rows from this source that are actually published in the dataset. */
  published_rows: number;
  rejected: number;
  rejections: Record<string, number>;
  /** @deprecated alias for `last_successful_fetch_at`. */
  fetched_at: string | null;
  last_attempt_at: string | null;
  last_successful_fetch_at: string | null;
  price_evidence_at: string | null;
  previous_price_evidence_at: string | null;
  evidence_advanced: boolean;
  evidence_state: SourceEvidenceState;
  retained_from_previous: number;
  oldest_observed_at: string | null;
  error: string | null;
}

/**
 * Per-registrar evidence summary.
 *
 * The source table answers "did the pipeline read anything new?". This one
 * answers the question a reader actually has: "is this registrar's price
 * current?" — which is not the same thing, because a source can be perfectly
 * healthy while covering one registrar from a frozen dump.
 */
export interface RegistrarReport {
  registrar_id: string;
  registrar_name: string;
  offers: number;
  /** Offers whose evidence is inside the stale threshold. */
  current: number;
  /** Offers in the `stale` band. */
  stale: number;
  /** Offers with no usable evidence date. */
  unknown: number;
  sources: string[];
  newest_evidence_at: string | null;
  oldest_evidence_at: string | null;
  evidence_state: SourceEvidenceState;
}

export interface PriceChange {
  tld: string;
  registrar_id: string;
  field: 'register_usd' | 'renewal_usd' | 'transfer_usd';
  previous_usd: number | null;
  current_usd: number | null;
  /** Percentage change, or null when either side is missing. */
  change_pct: number | null;
}

export interface PriceSyncReport {
  /** When this report was generated (run time). */
  run_at: string;
  dataset_generated_at: string;
  schema_version: number;
  totals: {
    offers: number;
    tlids: number;
    registrars: number;
    by_verification: Record<VerificationStatus, number>;
    by_freshness: Record<PriceFreshness, number>;
    /** Oldest evidence date across all published offers, or null. */
    oldest_observed_at: string | null;
    newest_observed_at: string | null;
    /** Offer count in the previous dataset, for drop detection. */
    previous_offers: number | null;
    /** Percentage change in offer count versus the previous dataset. */
    offer_count_change_pct: number | null;
  };
  sources: SourceReport[];
  /** Per-registrar evidence state — the reader-facing view. */
  registrars_detail: RegistrarReport[];
  /** Whether the published data is actually backed by current evidence. */
  coverage: PriceCoverage;
  /** Sources that downloaded fine but carry only frozen evidence. */
  frozen_sources: string[];
  /** Offers whose figures moved by more than the change threshold. */
  significant_changes: PriceChange[];
  /** Sources that failed or fell back to previous data. */
  degraded_sources: string[];
  /** Human-readable one-paragraph summary. */
  summary: string;
}

const CHANGE_THRESHOLD_PCT = 20;

/**
 * Counters published in `data/prices-meta.json`.
 *
 * Extracted from the sync so the rule is unit-testable: every counter names
 * exactly one band. `stale_offers` counts the `stale` band alone — folding
 * `unknown` into it (as an earlier version did) makes the meta file disagree
 * with both `data/prices.json` and `price-sync-report.json`, which is a
 * reporting bug even though no price is wrong.
 */
export function buildMetaCounts(offers: PriceOffer[]): PriceMeta['counts'] {
  const bySource: Record<string, number> = {};
  const byVerification: Record<VerificationStatus, number> = {
    verified: 0,
    source_snapshot: 0,
    model_derived: 0,
    unverified: 0,
  };
  const tlds = new Set<string>();
  const registrars = new Set<string>();
  let recent = 0;
  let aging = 0;
  let stale = 0;
  let unknown = 0;

  for (const offer of offers) {
    bySource[offer.source_id] = (bySource[offer.source_id] ?? 0) + 1;
    byVerification[offer.verification_status] = (byVerification[offer.verification_status] ?? 0) + 1;
    tlds.add(offer.tld);
    registrars.add(offer.registrar_id);
    if (offer.freshness === 'recent') recent++;
    else if (offer.freshness === 'aging') aging++;
    else if (offer.freshness === 'stale') stale++;
    else unknown++;
  }

  return {
    offers: offers.length,
    tlids: tlds.size,
    registrars: registrars.size,
    verified_offers: byVerification.verified,
    stale_offers: stale,
    recent_offers: recent,
    aging_offers: aging,
    unknown_offers: unknown,
    by_source: bySource,
    by_verification: byVerification,
  };
}

/** Compare two datasets and surface figures that moved materially. */
export function diffPrices(
  previous: PriceDataset | null,
  current: PriceDataset,
): PriceChange[] {
  if (!previous || !Array.isArray(previous.offers)) return [];
  const before = new Map<string, PriceOfferLike>();
  for (const o of previous.offers as unknown as PriceOfferLike[]) {
    before.set(`${o.registrar_id}|${o.tld}`, o);
  }
  const changes: PriceChange[] = [];
  for (const offer of current.offers) {
    const key = `${offer.registrar_id}|${offer.tld}`;
    const old = before.get(key);
    if (!old) continue;
    for (const field of ['register_usd', 'renewal_usd', 'transfer_usd'] as const) {
      const prev = typeof old[field] === 'number' ? old[field] : null;
      const curr = offer[field];
      if (prev === null && curr === null) continue;
      if (prev === curr) continue;
      if (prev === null || curr === null) {
        changes.push({
          tld: offer.tld,
          registrar_id: offer.registrar_id,
          field,
          previous_usd: prev,
          current_usd: curr,
          change_pct: null,
        });
        continue;
      }
      const pct = ((curr - prev) / prev) * 100;
      if (Math.abs(pct) >= CHANGE_THRESHOLD_PCT) {
        changes.push({
          tld: offer.tld,
          registrar_id: offer.registrar_id,
          field,
          previous_usd: prev,
          current_usd: curr,
          change_pct: Math.round(pct * 10) / 10,
        });
      }
    }
  }
  return changes.sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0));
}

interface PriceOfferLike {
  tld: string;
  registrar_id: string;
  register_usd: number | null;
  renewal_usd: number | null;
  transfer_usd: number | null;
}

/**
 * Group published offers by registrar and band their evidence.
 *
 * Pure, and used by both the report and the tests: the rule that matters is
 * that "current" means evidence inside `STALE_AFTER_DAYS`, not "we ran the
 * job today".
 */
export function buildRegistrarReports(offers: PriceOffer[], now: Date): RegistrarReport[] {
  const byRegistrar = new Map<string, PriceOffer[]>();
  for (const offer of offers) {
    const list = byRegistrar.get(offer.registrar_id) ?? [];
    list.push(offer);
    byRegistrar.set(offer.registrar_id, list);
  }

  const out: RegistrarReport[] = [];
  for (const [id, rows] of byRegistrar) {
    let current = 0;
    let stale = 0;
    let unknown = 0;
    let newest: string | null = null;
    let oldest: string | null = null;
    const sources = new Set<string>();
    for (const row of rows) {
      sources.add(row.source_id);
      const band = effectiveFreshness(row, now);
      if (band === 'recent' || band === 'aging') current++;
      else if (band === 'stale') stale++;
      else unknown++;
      const date = effectiveEvidenceDate(row);
      if (date) {
        if (newest === null || Date.parse(date) > Date.parse(newest)) newest = date;
        if (oldest === null || Date.parse(date) < Date.parse(oldest)) oldest = date;
      }
    }
    const newestAgeDays =
      newest === null ? Number.POSITIVE_INFINITY : (now.getTime() - Date.parse(newest)) / 86_400_000;
    // A registrar whose rows are all undated has no evidence to band, whatever
    // dates a quarantined row happens to carry.
    const evidence_state: SourceEvidenceState =
      unknown === rows.length
        ? 'none'
        : newest === null
          ? 'none'
          : newestAgeDays > STALE_AFTER_DAYS
            ? 'frozen'
            : newestAgeDays <= RECENT_WITHIN_DAYS
              ? 'current'
              : 'aging';
    out.push({
      registrar_id: id,
      registrar_name: rows[0]?.registrar_name ?? id,
      offers: rows.length,
      current,
      stale,
      unknown,
      sources: [...sources].sort(),
      newest_evidence_at: newest,
      oldest_evidence_at: oldest,
      evidence_state,
    });
  }
  return out.sort((a, b) => a.registrar_id.localeCompare(b.registrar_id, 'en'));
}

/** Build the machine-readable report. Pure. */
export function buildReport(input: {
  runAt: string;
  dataset: PriceDataset;
  sources: SourceReport[];
  changes: PriceChange[];
  now: Date;
  previous?: PriceDataset | null;
}): PriceSyncReport {
  const { dataset, sources, changes, now } = input;
  const offers = dataset.offers;

  const byVerification: Record<VerificationStatus, number> = {
    verified: 0,
    source_snapshot: 0,
    model_derived: 0,
    unverified: 0,
  };
  const byFreshness: Record<PriceFreshness, number> = {
    recent: 0,
    aging: 0,
    stale: 0,
    unknown: 0,
  };

  let oldest: string | null = null;
  let newest: string | null = null;
  for (const offer of offers) {
    byVerification[offer.verification_status] = (byVerification[offer.verification_status] ?? 0) + 1;
    byFreshness[offer.freshness] = (byFreshness[offer.freshness] ?? 0) + 1;
    const date = effectiveEvidenceDate(offer);
    if (date) {
      if (oldest === null || date < oldest) oldest = date;
      if (newest === null || date > newest) newest = date;
    }
  }

  const tlids = new Set(offers.map(o => o.tld)).size;
  const registrars = new Set(offers.map(o => o.registrar_id)).size;
  const degraded = sources
    .filter(s => s.status !== 'ok')
    .map(s => `${s.source_id} (${s.status})`);

  const registrarsDetail = buildRegistrarReports(offers, now);
  const coverage = buildCoverage(
    sources.map(s => ({ id: s.source_id, evidence_state: s.evidence_state })),
    offers,
    now,
  );
  const frozenSources = sources.filter(s => s.evidence_state === 'frozen').map(s => s.source_id);

  const previousOffers = input.previous?.offers?.length ?? null;
  const offerCountChangePct =
    previousOffers && previousOffers > 0
      ? Math.round(((offers.length - previousOffers) / previousOffers) * 1000) / 10
      : null;

  const verifiedShare = offers.length
    ? Math.round((byVerification.verified / offers.length) * 100)
    : 0;
  const staleShare = offers.length ? Math.round((byFreshness.stale / offers.length) * 100) : 0;

  const summary =
    `${offers.length} offers across ${tlids} TLDs and ${registrars} registrars. ` +
    `${byVerification.verified} (${verifiedShare}%) were read directly from the registrar's own ` +
    `published price list; ${byVerification.source_snapshot} come from openly licensed dated ` +
    `snapshots; ${byVerification.model_derived} are policy-derived; ${byVerification.unverified} ` +
    `cannot be dated. ${byFreshness.stale} offers (${staleShare}%) are older than ` +
    `${STALE_AFTER_DAYS} days and are shown as stale. Oldest evidence: ${oldest ?? 'unknown'}. ` +
    `Coverage: ${coverage.complete ? 'complete' : 'incomplete'} — ${coverage.note}` +
    (degraded.length ? ` Sources not fully refreshed: ${degraded.join(', ')}.` : '');

  return {
    run_at: input.runAt,
    dataset_generated_at: dataset.generated_at,
    schema_version: dataset.schema_version,
    totals: {
      offers: offers.length,
      tlids,
      registrars,
      by_verification: byVerification,
      by_freshness: byFreshness,
      oldest_observed_at: oldest,
      newest_observed_at: newest,
      previous_offers: previousOffers,
      offer_count_change_pct: offerCountChangePct,
    },
    sources,
    registrars_detail: registrarsDetail,
    coverage,
    frozen_sources: frozenSources,
    significant_changes: changes.slice(0, 200),
    degraded_sources: degraded,
    summary,
  };
}

/** Render the Markdown summary used by the workflow step and PR comments. */
export function renderMarkdown(report: PriceSyncReport): string {
  const lines: string[] = [];
  // Date-only evidence dates (upstream snapshots) stay date-only; a full
  // timestamp is trimmed to the second so the table stays readable.
  const day = (v: string | null | undefined): string => {
    if (!v) return '—';
    if (v.length === 10) return v;
    return v.slice(0, 19).replace('T', ' ') + 'Z';
  };
  const stateLabel = (s: SourceEvidenceState): string =>
    s === 'current' ? 'current' : s === 'aging' ? 'aging' : s === 'frozen' ? '**frozen**' : 'no data';

  lines.push('# Registrar price sync report');
  lines.push('');
  lines.push(`- Run: \`${report.run_at}\``);
  lines.push(`- Dataset: \`${report.dataset_generated_at}\``);
  const prev = report.totals.previous_offers;
  const change = report.totals.offer_count_change_pct;
  lines.push(
    `- Offers: **${report.totals.offers}** across **${report.totals.tlids}** TLDs, **${report.totals.registrars}** registrars` +
      (prev === null ? '' : ` (previous run: ${prev}${change === null ? '' : `, ${change > 0 ? '+' : ''}${change}%`})`),
  );
  lines.push(
    `- Verification: ${VERIFICATION_LABEL.verified} ${report.totals.by_verification.verified} · ` +
      `${VERIFICATION_LABEL.source_snapshot} ${report.totals.by_verification.source_snapshot} · ` +
      `${VERIFICATION_LABEL.model_derived} ${report.totals.by_verification.model_derived} · ` +
      `${VERIFICATION_LABEL.unverified} ${report.totals.by_verification.unverified}`,
  );
  lines.push(
    `- Freshness: ${Object.entries(report.totals.by_freshness)
      .map(([k, v]) => `${FRESHNESS_LABEL[k as PriceFreshness]} ${v}`)
      .join(' · ')}`,
  );
  lines.push(`- Oldest evidence date: \`${report.totals.oldest_observed_at ?? 'unknown'}\``);
  lines.push(`- Coverage: **${report.coverage.complete ? 'complete' : 'incomplete'}** — ${report.coverage.note}`);
  lines.push('');

  // The per-source table is the answer to "did this run actually fetch
  // anything new?", which a green workflow does not answer on its own.
  lines.push('## Sources');
  lines.push('');
  lines.push(
    '| Source | Tier | Fetch | Attempted | Parsed | Rejected | Published | Retained | Last attempt (UTC) | Last successful fetch (UTC) | Newest evidence | Previous | New evidence? | Evidence state |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of report.sources) {
    lines.push(
      `| ${s.source_id} | ${VERIFICATION_LABEL[s.verification_status]} | ${s.status} | ${s.attempted} | ` +
        `${s.rows} | ${s.rejected} | ${s.published_rows} | ${s.retained_from_previous} | ` +
        `${day(s.last_attempt_at)} | ${day(s.last_successful_fetch_at)} | ${day(s.price_evidence_at)} | ` +
        `${day(s.previous_price_evidence_at)} | ${s.evidence_advanced ? 'yes' : 'no'} | ${stateLabel(s.evidence_state)} |`,
    );
  }
  lines.push('');

  lines.push('## Registrars');
  lines.push('');
  lines.push('| Registrar | Offers | Current | Stale | Undated | Newest evidence | Oldest evidence | Evidence state | Sources |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of report.registrars_detail) {
    lines.push(
      `| ${r.registrar_name} (\`${r.registrar_id}\`) | ${r.offers} | ${r.current} | ${r.stale} | ${r.unknown} | ` +
        `${day(r.newest_evidence_at)} | ${day(r.oldest_evidence_at)} | ${stateLabel(r.evidence_state)} | ${r.sources.join(', ')} |`,
    );
  }
  lines.push('');

  if (report.frozen_sources.length > 0) {
    lines.push('## Sources that downloaded but delivered no new evidence');
    lines.push('');
    lines.push(
      'These sources were read successfully and their payload was accepted, but nothing inside it is newer ' +
        `than ${STALE_AFTER_DAYS} days. The workflow being green does not mean these prices are current.`,
    );
    lines.push('');
    for (const id of report.frozen_sources) {
      const s = report.sources.find(x => x.source_id === id);
      lines.push(
        `- **${id}** — newest evidence ${day(s?.price_evidence_at ?? null)}, ` +
          `previous ${day(s?.previous_price_evidence_at ?? null)}, ${s?.published_rows ?? 0} published rows.`,
      );
    }
    lines.push('');
  }

  if (report.coverage.registrars_without_current_evidence.length > 0) {
    lines.push('## Registrars with no current quote');
    lines.push('');
    lines.push(
      'Every published figure for these registrars is older than the stale threshold or undated, so the site ' +
        'shows their prices as historical snapshots and never as the current best price.',
    );
    lines.push('');
    for (const id of report.coverage.registrars_without_current_evidence) {
      const r = report.registrars_detail.find(x => x.registrar_id === id);
      lines.push(
        `- **${r?.registrar_name ?? id}** — ${r?.offers ?? 0} offers, newest evidence ` +
          `${day(r?.newest_evidence_at ?? null)}, sources: ${(r?.sources ?? []).join(', ') || 'none'}.`,
      );
    }
    lines.push('');
  }

  if (report.degraded_sources.length > 0) {
    lines.push('## Sources needing attention');
    lines.push('');
    for (const s of report.degraded_sources) lines.push(`- ${s}`);
    lines.push('');
  }

  if (report.significant_changes.length > 0) {
    lines.push(`## Significant price changes (>${CHANGE_THRESHOLD_PCT}%)`);
    lines.push('');
    lines.push('| Registrar | TLD | Field | Previous | Current | Change |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of report.significant_changes.slice(0, 40)) {
      lines.push(
        `| ${c.registrar_id} | .${c.tld} | ${c.field.replace('_usd', '')} | ` +
          `${c.previous_usd ?? '—'} | ${c.current_usd ?? '—'} | ` +
          `${c.change_pct === null ? 'new/removed' : `${c.change_pct > 0 ? '+' : ''}${c.change_pct}%`} |`,
      );
    }
    if (report.significant_changes.length > 40) {
      lines.push('');
      lines.push(`_…and ${report.significant_changes.length - 40} more._`);
    }
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  return lines.join('\n');
}