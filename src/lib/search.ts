/**
 * Search / filter / sort / pagination helpers.
 *
 * Pure functions with no framework or DOM dependency so they can be used
 * during static rendering *and* in the browser for instant client-side
 * filtering of the pre-rendered list.
 */

import { normalizeSuffixInput } from './iana.js';

export interface SearchableTld {
  suffix: string;
  ascii_name: string;
  unicode_name: string | null;
  manager_name: string | null;
  normalized_type: string | null;
  is_idn: boolean;
}

export type SortKey = 'suffix-asc' | 'suffix-desc' | 'manager-asc' | 'manager-desc';

export interface FilterState {
  /** Free-text query (suffix or manager). */
  q: string;
  /** Normalised type slugs, empty = all. */
  types: string[];
  /** Single letter or '0-9', '' = all. */
  letter: string;
  /** Only internationalized (xn--) TLDs. */
  idnOnly: boolean;
}

export const DEFAULT_FILTER: FilterState = {
  q: '',
  types: [],
  letter: '',
  idnOnly: false,
};

/**
 * Normalise a free-text query for matching.
 * Keeps the last label so "example.com" searches for "com", while manager
 * names are preserved verbatim (lowercased).
 */
export function normalizeQuery(q: string): string {
  if (typeof q !== 'string') return '';
  const trimmed = q.trim().toLowerCase();
  if (trimmed.length === 0) return '';
  // If it looks like a suffix or domain, reduce it to the suffix label.
  if (/^[a-z0-9.-]+$/.test(trimmed) && trimmed.includes('.')) {
    const label = normalizeSuffixInput(trimmed);
    if (label) return label;
  }
  return trimmed.replace(/^\.+/, '');
}

/** Does the record match the (already normalised) query? */
export function matchesQuery(rec: SearchableTld, nq: string): boolean {
  if (!nq) return true;
  if (rec.ascii_name.includes(nq)) return true;
  if (rec.suffix.includes(nq)) return true;
  if (rec.unicode_name && rec.unicode_name.toLowerCase().includes(nq)) return true;
  if (rec.manager_name && rec.manager_name.toLowerCase().includes(nq)) return true;
  if (rec.normalized_type && rec.normalized_type.includes(nq)) return true;
  return false;
}

export function filterTlds<T extends SearchableTld>(
  records: readonly T[],
  filter: Partial<FilterState>,
): T[] {
  const state: FilterState = { ...DEFAULT_FILTER, ...filter };
  const nq = normalizeQuery(state.q);
  const types = state.types.filter(Boolean);
  const letter = state.letter;

  return records.filter((rec) => {
    if (!matchesQuery(rec, nq)) return false;
    if (types.length > 0) {
      const t = rec.normalized_type ?? '';
      if (!types.includes(t)) return false;
    }
    if (letter) {
      const l = letterOf(rec.ascii_name);
      if (l !== letter) return false;
    }
    if (state.idnOnly && !rec.is_idn) return false;
    return true;
  });
}

export function letterOf(label: string): string {
  const first = label.charAt(0);
  return /^[a-z]$/.test(first) ? first : '0-9';
}

export function sortTlds<T extends SearchableTld>(
  records: readonly T[],
  sort: SortKey = 'suffix-asc',
): T[] {
  const copy = [...records];
  const bySuffix = (a: T, b: T) => a.ascii_name.localeCompare(b.ascii_name, 'en');
  const byManager = (a: T, b: T) => {
    const am = a.manager_name ?? '￿';
    const bm = b.manager_name ?? '￿';
    const cmp = am.localeCompare(bm, 'en');
    return cmp !== 0 ? cmp : bySuffix(a, b);
  };
  switch (sort) {
    case 'suffix-desc':
      return copy.sort((a, b) => bySuffix(b, a));
    case 'manager-asc':
      return copy.sort(byManager);
    case 'manager-desc':
      return copy.sort((a, b) => byManager(b, a));
    case 'suffix-asc':
    default:
      return copy.sort(bySuffix);
  }
}

export function paginate<T>(records: readonly T[], page: number, perPage: number): T[] {
  const p = Math.max(1, Math.floor(page));
  const start = (p - 1) * perPage;
  return records.slice(start, start + perPage);
}

export function totalPages(count: number, perPage: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, perPage)));
}

/** Highlight-free snippet describing an empty result set. */
export function emptyStateMessage(filter: Partial<FilterState>): string {
  const parts: string[] = [];
  const state: FilterState = { ...DEFAULT_FILTER, ...filter };
  if (state.q.trim()) parts.push(`“${state.q.trim()}”`);
  if (state.types.length) parts.push(state.types.join(', '));
  if (state.letter) parts.push(`letter ${state.letter.toUpperCase()}`);
  if (state.idnOnly) parts.push('internationalized only');
  if (parts.length === 0) return 'No TLDs match the current filters.';
  return `No TLDs match ${parts.join(' + ')}. Try a different search term or clear the filters.`;
}