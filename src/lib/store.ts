/**
 * Server-side data access layer.
 * All functions run at build time (SSG) — no runtime I/O.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TldRecord, TldDataset, SyncMeta, TldReference } from './types.js';
import { tldNoteMap, type TldNote } from '../content/tldNotes.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RECORDS_PATH = path.join(DATA_DIR, 'tlds.json');
const META_PATH = path.join(DATA_DIR, 'meta.json');

/** Read the synced TLD dataset. Returns null if the file does not exist. */
export async function readDataset(): Promise<TldDataset | null> {
  try {
    const txt = await fs.readFile(RECORDS_PATH, 'utf-8');
    return JSON.parse(txt) as TldDataset;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Read the sync metadata (last run, counts, history). */
export async function readMeta(): Promise<SyncMeta | null> {
  try {
    const txt = await fs.readFile(META_PATH, 'utf-8');
    return JSON.parse(txt) as SyncMeta;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Load all TLD records as a flat array, ready for static page generation. */
export async function loadAllRecords(): Promise<TldRecord[]> {
  const ds = await readDataset();
  if (!ds) return [];
  return ds.records;
}

/** Load a single record by its suffix (with leading dot, e.g. ".com"). */
export async function loadRecord(suffix: string): Promise<TldRecord | null> {
  const records = await loadAllRecords();
  const normalized = suffix.startsWith('.') ? suffix : `.${suffix}`;
  return records.find(r => r.suffix === normalized) ?? null;
}

/** Get records filtered by normalised type slug (for category pages). */
export async function loadRecordsByType(typeSlug: string): Promise<TldRecord[]> {
  const records = await loadAllRecords();
  return records.filter(r => r.normalized_type === typeSlug);
}

/** Get records whose ASCII label starts with the given letter (for A–Z index). */
export async function loadRecordsByLetter(letter: string): Promise<TldRecord[]> {
  const records = await loadAllRecords();
  const target = letter.toLowerCase();
  return records.filter(r => r.letter === target);
}

/** Get the canonical list of TLDs sorted by ASCII label. */
export async function loadSortedRecords(): Promise<TldRecord[]> {
  const records = await loadAllRecords();
  return [...records].sort((a, b) => a.ascii_name.localeCompare(b.ascii_name, 'en'));
}

/** Count records by normalised type. */
export async function getTypeCounts(): Promise<Record<string, number>> {
  const records = await loadAllRecords();
  const counts: Record<string, number> = {};
  for (const r of records) {
    const t = r.normalized_type ?? 'unknown';
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

/** Build a minimal searchable index for client-side filtering. */
export async function loadSearchIndex(): Promise<{ suffix: string; ascii_name: string; unicode_name: string | null; manager_name: string | null; normalized_type: string | null; is_idn: boolean }[]> {
  const records = await loadAllRecords();
  return records.map(r => ({
    suffix: r.suffix,
    ascii_name: r.ascii_name,
    unicode_name: r.unicode_name,
    manager_name: r.manager_name,
    normalized_type: r.normalized_type,
    is_idn: r.is_idn,
  }));
}

/** Get the site-wide generation timestamp. */
export async function getGeneratedAt(): Promise<string | null> {
  const ds = await readDataset();
  return ds?.generated_at ?? null;
}

/** Get the source version string (from the delegated list header). */
export async function getSourceVersion(): Promise<string | null> {
  const ds = await readDataset();
  return ds?.sources.delegated_list.version ?? null;
}

/** Get the source last-updated timestamp. */
export async function getSourceLastUpdated(): Promise<string | null> {
  const ds = await readDataset();
  return ds?.sources.delegated_list.last_updated ?? null;
}

/**
 * Look up an editorial note for a TLD.
 *
 * Editorial notes live in `src/content/tldNotes.ts` and are deliberately
 * separate from `data/tlds.json` — the sync script never reads or writes
 * this module, so a data refresh can never overwrite editorial content.
 *
 * Returns null when no note exists; the caller must then render the plain
 * (IANA-only) page rather than inventing content.
 */
export async function getEditorialNote(suffix: string): Promise<TldNote | null> {
  const bare = suffix.replace(/^\./, '').toLowerCase();
  return tldNoteMap.get(bare) ?? null;
}

/** All suffixes that have an editorial note (used by the sitemap/Content pages). */
export async function getEditorialSuffixes(): Promise<string[]> {
  return [...tldNoteMap.keys()].sort();
}

/** Total number of editorial notes present in the repo. */
export async function getEditorialCount(): Promise<number> {
  return tldNoteMap.size;
}