/**
 * Cross-source merge: one offer per (registrar, TLD).
 *
 * When several sources carry the same registrar+TLD pair (they do — Porkbun
 * appears in its own API, in Pikkly and in Open Domain Data), we must pick the
 * copy a reader should trust. Ranking, in order:
 *
 *   1. `verification_status` — a figure read from the registrar's own site
 *      outranks a third-party snapshot, which outranks a derived model. This
 *      is checked BEFORE age on purpose: a snapshot read an hour ago is still
 *      a snapshot, and must not displace a first-party read.
 *   2. Evidence age — within the same tier, the fresher observation wins.
 *   3. Source priority — a stable tie-break so output is deterministic.
 *
 * Distinct registrars are never collapsed: a comparison needs all of them.
 */

import type { RawOffer, SourceBatch, VerificationStatus } from '../../src/lib/pricingTypes.js';
import { effectiveEvidenceDate, VERIFICATION_RANK } from '../../src/lib/pricingCalc.js';

export interface MergeResult {
  merged: RawOffer[];
  /** Key -> winning source id (for reporting/summary). */
  winners: Record<string, string>;
  /** Number of offers dropped because another source had a better copy. */
  superseded: number;
  /** Key -> winning source id, for offers replaced by a better-verified copy. */
  upgradedByVerification: number;
}

interface Ranked {
  offer: RawOffer;
  priority: number;
  verification: VerificationStatus;
  evidence: number;
}

function rankOf(offer: RawOffer): Ranked {
  const verification = offer.verification_status ?? 'source_snapshot';
  const date = effectiveEvidenceDate(offer);
  return {
    offer,
    verification,
    evidence: date ? Date.parse(date) : Number.NEGATIVE_INFINITY,
    priority: Number.POSITIVE_INFINITY,
  };
}

/** True when `a` should replace `b` for the same registrar+TLD. */
export function beats(a: Ranked, b: Ranked): boolean {
  const rankA = VERIFICATION_RANK[a.verification];
  const rankB = VERIFICATION_RANK[b.verification];
  if (rankA !== rankB) return rankA < rankB;
  if (a.evidence !== b.evidence) return a.evidence > b.evidence;
  return a.priority < b.priority;
}

export function mergeBatches(batches: SourceBatch[]): MergeResult {
  const byKey = new Map<string, Ranked>();
  let superseded = 0;
  let upgradedByVerification = 0;

  for (const batch of batches) {
    for (const offer of batch.offers) {
      const key = `${offer.registrar_id}|${offer.tld}`;
      const candidate: Ranked = { ...rankOf(offer), priority: batch.priority };
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, candidate);
        continue;
      }
      if (beats(candidate, existing)) {
        // Track when a better-verified copy displaced a fresher-looking one:
        // that is the case where age alone would have given the wrong answer.
        if (VERIFICATION_RANK[candidate.verification] < VERIFICATION_RANK[existing.verification]) {
          upgradedByVerification++;
        }
        byKey.set(key, candidate);
      }
      superseded++;
    }
  }

  const merged = [...byKey.values()].map(v => v.offer);
  const winners: Record<string, string> = {};
  for (const [key, v] of byKey) winners[key] = v.offer.source_id;
  merged.sort(
    (a, b) => a.tld.localeCompare(b.tld, 'en') || a.registrar_id.localeCompare(b.registrar_id, 'en'),
  );
  return { merged, winners, superseded, upgradedByVerification };
}