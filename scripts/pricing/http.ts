/**
 * Small dependency-free parsers shared by the source adapters.
 *
 * Kept separate from the adapters so each parser stays pure and unit-testable:
 * adapters do I/O, these do string → data.
 */

/**
 * Parse RFC 4180 CSV text.
 *
 * Handles quoted fields, embedded commas/newlines and doubled quotes. Header
 * row is returned as keys; rows with a differing column count are padded or
 * truncated so a malformed tail row can never throw.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter(r => r.length > 1 || (r[0] ?? '').trim() !== '');
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(r => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}

/** Collapse runs of whitespace and strip tags from an HTML fragment. */
export function htmlToText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode the HTML entities that appear inside single-quoted JSON attributes. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Fetch text with a browser-like UA, timeout and redirect following. */
export async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // A descriptive UA with a contact URL is what polite automated access
      // looks like; we do not attempt to disguise the request.
      'user-agent':
        'TLD-Directory-PriceSync/2.0 (https://tld-directory.pages.dev/; automated registrar price sync)',
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Fetch and parse JSON with the same politeness headers. */
export async function fetchJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'TLD-Directory-PriceSync/2.0 (https://tld-directory.pages.dev/; automated registrar price sync)',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Polite delay between requests to the same host (no hammering). */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalise a date string to an ISO date (YYYY-MM-DD) when it parses.
 * Returns null for anything unusable so callers never store a junk timestamp.
 */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}