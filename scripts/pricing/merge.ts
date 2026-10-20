/**
 * Cross-source merge: one offer per (registrar, TLD).
 *
 * When several sources carry the same registrar+TLD pair (they do — Porkbun
 * appears in its own API, in Pikkly and in Open Domain Data), the freshest
 * `last_checked` wins; ties go to the higher-priority source. Distinct
 * registrars are never collapsed: a comparison needs all of them.
 */

import type { RawOffer, SourceBatch } from '../../src/lib/pricingTypes.js';

export interface MergeResult {
  merged: RawOffer[];
  /** Key -> winning source id (for reporting/summary). */
  winners: Record<string, string>;
  /** Number of offers dropped because another source had a fresher copy. */
  superseded: number;
}

export function mergeBatches(batches: SourceBatch[]): MergeResult {
  const byKey = new Map<string, { offer: RawOffer; priority: number }>();
  let superseded = 0;

  for (const batch of batches) {
    for (const offer of batch.offers) {
      const key = `${offer.registrar_id}|${offer.tld}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { offer, priority: batch.priority });
        continue;
      }
      const incomingDate = Date.parse(offer.last_checked);
      const existingDate = Date.parse(existing.offer.last_checked);
      const incomingNewer = !Number.isNaN(incomingDate) && incomingDate > existingDate;
      const sameDate = incomingDate === existingDate;
      const incomingWins =
        incomingNewer || (sameDate && batch.priority < existing.priority);
      if (incomingWins) {
        byKey.set(key, { offer, priority: batch.priority });
        superseded++;
      } else {
        superseded++;
      }
    }
  }

  const merged = [...byKey.values()].map(v => v.offer);
  const winners: Record<string, string> = {};
  for (const [key, v] of byKey) winners[key] = v.offer.source_id;
  merged.sort((a, b) => a.tld.localeCompare(b.tld, 'en') || a.registrar_id.localeCompare(b.registrar_id, 'en'));
  return { merged, winners, superseded };
}
