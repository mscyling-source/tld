/**
 * Schema v1 → v2 migration for `data/prices.json`.
 *
 * The v1 dataset collapsed three different timestamps into one `last_checked`
 * and had no notion of how a figure was obtained. Migration must therefore be
 * deliberately conservative:
 *
 *   - `last_checked` becomes `price_observed_at` (it was, in v1, defined as
 *     "the most conservative timestamp the source exposes").
 *   - `price_verified_at` is set ONLY for rows whose source is a first-party
 *     read we performed (the Porkbun official API). Everything else keeps a
 *     null verification date.
 *   - `verification_status` is `verified` only for those first-party rows;
 *     every other row becomes `source_snapshot`. Nothing is promoted to
 *     `verified` on the strength of a download happening today.
 *   - `source_fetched_at` is filled from the dataset's own `generated_at`,
 *     because that is when the previous sync ran — not from now.
 *
 * Migration is idempotent: running it on a v2 file is a no-op.
 */

import type {
  PriceDataset,
  PriceOffer,
  PriceSourceInfo,
  VerificationStatus,
} from '../../src/lib/pricingTypes.js';
import { isFirstPartySource } from '../../src/config/sources.js';

type UnknownRecord = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isoOrNull(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

function migrateOffer(raw: UnknownRecord, datasetGeneratedAt: string): UnknownRecord {
  const sourceId = str(raw.source_id) ?? 'unknown';
  const isFirstParty = isFirstPartySource(sourceId);

  const observedAt = isoOrNull(raw.price_observed_at) ?? isoOrNull(raw.last_checked);
  const verifiedAt = isFirstParty ? (isoOrNull(raw.price_verified_at) ?? observedAt) : null;

  const declared = str(raw.verification_status);
  const verification: VerificationStatus =
    declared === 'verified' || declared === 'model_derived' || declared === 'unverified'
      ? declared
      : isFirstParty
        // A first-party read is only "verified" if it has a date to back it.
        ? observedAt
          ? 'verified'
          : 'unverified'
        : 'source_snapshot';

  return {
    ...raw,
    // Fill gaps required by v2 without discarding anything v1 already had.
    promotion_expires_at: isoOrNull(raw.promotion_expires_at),
    source_name: str(raw.source_name) ?? str(raw.source_id) ?? sourceId,
    source_fetched_at: isoOrNull(raw.source_fetched_at) ?? datasetGeneratedAt,
    price_observed_at: observedAt,
    price_verified_at: verifiedAt,
    verification_status: verification,
    // The compatibility alias keeps its v1 meaning (conservative evidence date).
    last_checked: verifiedAt ?? observedAt ?? '',
    // Recomputed at build time; this value is only a safe placeholder.
    freshness: 'unknown',
    quality: 'stale',
  };
}

function migrateSource(raw: UnknownRecord, offers: UnknownRecord[]): UnknownRecord {
  const sourceId = str(raw.source_id) ?? str(raw.id) ?? 'unknown';
  const isFirstParty = isFirstPartySource(sourceId);
  const dates = offers
    .map(o => str(o.price_observed_at) ?? str(o.price_verified_at))
    .filter((d): d is string => typeof d === 'string');
  return {
    ...raw,
    id: sourceId,
    verification_status:
      str(raw.verification_status) ?? (isFirstParty ? 'verified' : 'source_snapshot'),
    rows: typeof raw.rows === 'number' ? raw.rows : offers.length,
    fetched_at: isoOrNull(raw.fetched_at) ?? isoOrNull(raw.source_fetched_at),
    oldest_observed_at:
      isoOrNull(raw.oldest_observed_at) ?? (dates.length ? dates.sort()[0] : null),
  };
}

/**
 * Upgrade any parsed dataset object to schema v2 in place-safe fashion.
 * Returns `{ dataset, changed }`; `changed` is false for an already-v2 input.
 */
export function migrateDataset(input: unknown): {
  dataset: PriceDataset;
  changed: boolean;
} {
  if (!input || typeof input !== 'object') {
    throw new Error('price dataset is not an object');
  }
  const raw = input as UnknownRecord;
  if (raw.schema_version === 2 && Array.isArray(raw.offers)) {
    return { dataset: raw as unknown as PriceDataset, changed: false };
  }

  const generatedAt = isoOrNull(raw.generated_at) ?? new Date(0).toISOString();
  const rawOffers = Array.isArray(raw.offers) ? raw.offers : [];
  const offers = rawOffers.map(o => migrateOffer((o ?? {}) as UnknownRecord, generatedAt));

  const bySource = new Map<string, UnknownRecord[]>();
  for (const offer of offers) {
    const key = str(offer.source_id) ?? 'unknown';
    const list = bySource.get(key) ?? [];
    list.push(offer);
    bySource.set(key, list);
  }

  const rawSources = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: UnknownRecord[] = rawSources.map(s => {
    const record = (s ?? {}) as UnknownRecord;
    const key = str(record.id) ?? str(record.source_id) ?? 'unknown';
    return migrateSource(record, bySource.get(key) ?? []);
  });

  const dataset = {
    ...raw,
    schema_version: 2,
    generated_at: generatedAt,
    currency: str(raw.currency) ?? 'USD',
    sources,
    offers,
  } as unknown as PriceDataset;

  return { dataset, changed: true };
}

/** Narrowing helper for callers that need typed offers after migration. */
export function isV2(dataset: PriceDataset): dataset is PriceDataset {
  return dataset.schema_version === 2;
}

export type { PriceOffer, PriceSourceInfo };