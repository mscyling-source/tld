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
  PriceDataset,
  PriceFreshness,
  PriceMeta,
  PriceOffer,
  VerificationStatus,
} from '../../src/lib/pricingTypes.js';
import { effectiveEvidenceDate } from '../../src/lib/pricingCalc.js';
import {
  FRESHNESS_LABEL,
  STALE_AFTER_DAYS,
  VERIFICATION_LABEL,
} from '../../src/config/freshness.js';

export interface SourceReport {
  source_id: string;
  source_name: string;
  status: string;
  verification_status: VerificationStatus;
  rows: number;
  rejected: number;
  rejections: Record<string, number>;
  fetched_at: string | null;
  oldest_observed_at: string | null;
  error: string | null;
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
  };
  sources: SourceReport[];
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

/** Build the machine-readable report. Pure. */
export function buildReport(input: {
  runAt: string;
  dataset: PriceDataset;
  sources: SourceReport[];
  changes: PriceChange[];
  now: Date;
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
    `${STALE_AFTER_DAYS} days and are shown as stale. Oldest evidence: ${oldest ?? 'unknown'}.` +
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
    },
    sources,
    significant_changes: changes.slice(0, 200),
    degraded_sources: degraded,
    summary,
  };
}

/** Render the Markdown summary used by the workflow step and PR comments. */
export function renderMarkdown(report: PriceSyncReport): string {
  const lines: string[] = [];
  lines.push('# Registrar price sync report');
  lines.push('');
  lines.push(`- Run: \`${report.run_at}\``);
  lines.push(`- Dataset: \`${report.dataset_generated_at}\``);
  lines.push(`- Offers: **${report.totals.offers}** across **${report.totals.tlids}** TLDs, **${report.totals.registrars}** registrars`);
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
  lines.push('');

  lines.push('| Source | Tier | Status | Rows | Rejected | Oldest observation | Error |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of report.sources) {
    lines.push(
      `| ${s.source_id} | ${VERIFICATION_LABEL[s.verification_status]} | ${s.status} | ${s.rows} | ` +
        `${s.rejected} | ${s.oldest_observed_at ?? '—'} | ${s.error ?? '—'} |`,
    );
  }
  lines.push('');

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