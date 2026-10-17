/**
 * Pure parsing + normalisation helpers for the two authoritative IANA data
 * sources. No network access, no filesystem access — everything here is unit
 * tested with fixtures in `tests/`.
 *
 * Sources:
 *  1. https://data.iana.org/TLD/tlds-alpha-by-domain.txt
 *     IANA's authoritative list of delegated top-level domains.
 *  2. https://www.iana.org/domains/root/db
 *     IANA Root Zone Database table: domain, type, sponsoring organisation.
 *  3. https://www.iana.org/domains/root/db/<tld>.html
 *     Per-TLD delegation record: registry information (WHOIS/RDAP/URL),
 *     record dates and reference documents.
 */

import { toUnicode } from 'punycode';
import type { NormalizedType, TldReference } from './types.js';

export const DELEGATED_LIST_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
export const ROOT_ZONE_DB_URL = 'https://www.iana.org/domains/root/db';

/** Minimum plausible size of the delegated list — used as a safety guard. */
export const MIN_EXPECTED_TLDS = 1000;

export interface DelegatedListResult {
  /** Lowercase ASCII labels, e.g. ["com", "xn--55qx5d"]. */
  labels: string[];
  /** e.g. "2026101200" (empty string when the header is missing). */
  version: string;
  /** e.g. "Mon Oct 12 07:07:01 2026 UTC" (empty string when missing). */
  lastUpdated: string;
}

/**
 * Parse IANA's `tlds-alpha-by-domain.txt`.
 * Throws on empty/malformed content so callers can fail loudly instead of
 * overwriting good data with an empty dataset.
 */
export function parseDelegatedList(text: string): DelegatedListResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Delegated list is empty');
  }

  const lines = text.split(/\r?\n/);
  let version = '';
  let lastUpdated = '';
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      const v = line.match(/#\s*Version\s+([^\s,]+)/);
      if (v) version = v[1];
      const u = line.match(/Last Updated\s+(.+?)\s*$/);
      if (u) lastUpdated = u[1].trim();
      continue;
    }
    if (!/^[A-Za-z0-9-]+$/.test(line)) {
      throw new Error(`Delegated list contains an invalid label: "${line}"`);
    }
    const label = line.toLowerCase();
    if (seen.has(label)) {
      // Duplicates would create duplicate pages — surface them as an error.
      throw new Error(`Delegated list contains a duplicate label: "${label}"`);
    }
    seen.add(label);
    labels.push(label);
  }

  if (labels.length === 0) {
    throw new Error('Delegated list parsed to zero labels');
  }

  return { labels, version, lastUpdated };
}

export interface RootZoneRow {
  /** ASCII label without the dot, lowercase. */
  ascii: string;
  /** Unicode display label without the dot (IDN TLDs only). */
  unicode: string | null;
  /** Verbatim IANA type string (normalised to lowercase, no spaces). */
  type: string;
  /** Sponsoring organisation, or null when IANA shows "Not assigned". */
  manager: string | null;
  /** Delegation status shown by IANA (e.g. "Active"); null when not published. */
  status: string | null;
  /** BCP 47 script code shown by IANA (e.g. "Latn"); null when not published. */
  script: string | null;
}

/**
 * Parse the IANA Root Zone Database HTML table.
 *
 * Row shape (whitespace tolerant):
 *   <tr>
 *     <td><span class="domain tld"><a href="/domains/root/db/x.html">.x</a></span></td>
 *     <td>generic</td>
 *     <td>Manager Ltd</td>
 *   </tr>
 */
export interface RootZoneRow {
  /** ASCII label without the dot, lowercase. */
  ascii: string;
  /** Unicode display label without the dot (IDN TLDs only). */
  unicode: string | null;
  /** Verbatim IANA type string (normalised to lowercase, hyphens for spaces). */
  type: string;
  /** Sponsoring organisation, or null when IANA shows "Not assigned". */
  manager: string | null;
  /** Delegation status shown by IANA (e.g. "Active", "Retired", "Reserved"). */
  status: string | null;
  /** BCP 47 script code shown by IANA (e.g. "Latn"); null when not published. */
  script: string | null;
  /**
   * For reserved names (`.test`, `.example`, …) IANA puts usage text in the
   * organisation column instead of an organisation. That text is surfaced
   * here so callers can label it accurately and leave `manager` null.
   */
  status_note: string | null;
}

/**
 * Type labels IANA may publish, in either the old or new wording.
 *
 * IANA's index page was redesigned in 2026 and now publishes only three
 * values — "Generic", "Country Code" and "Special Use". The older labels
 * ("Sponsored", "Generic Restricted", "Infrastructure", "Test") are still
 * accepted so a dataset captured from the legacy layout keeps working.
 */
const ROOT_ZONE_TYPE_LABELS = [
  'generic-restricted',
  'generic',
  'country-code',
  'sponsored',
  'infrastructure',
  'test',
  'special-use',
] as const;

/** Statuses IANA publishes in the delegation-status column. */
const ROOT_ZONE_STATUSES = [
  'active',
  'retired',
  'reserved',
  'pending',
  'delegated',
  'eligible',
] as const;

/**
 * Parse the IANA Root Zone Database index page.
 *
 * Two layouts are supported:
 *
 *  legacy (pre-2026)
 *    <tr>
 *      <td><span class="domain tld"><a href="/domains/root/db/aaa.html">.aaa</a></span></td>
 *      <td>generic</td>
 *      <td>American Automobile Association, Inc.</td>
 *    </tr>
 *
 *  current (2026)
 *    <tr>
 *      <td><a href="/domains/root/db/aaa"> .aaa …icons… </a></td>
 *      <td>… Active</td>
 *      <td>… Generic</td>
 *      <td class="col-manager"> American Automobile Association, Inc.</td>
 *      <td>Latn</td><td>Latin</td><td>en||aaa</td>
 *    </tr>
 */
export function parseRootZoneDb(html: string): RootZoneRow[] {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('Root zone database page is empty');
  }
  // Both layouts link to the per-TLD record; that is the one invariant we rely on.
  const linkProbe = /\/domains\/root\/db\/[a-z0-9-]+(\.html)?["\s>]/i.test(html);
  const legacyProbe = html.includes('domain tld');
  if (!legacyProbe && !linkProbe) {
    throw new Error('Root zone database page does not contain the expected table');
  }

  // Restrict to the <tbody> so header/footer links are never parsed.
  const tbodyStart = html.indexOf('<tbody');
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  const body = tbodyStart >= 0 && tbodyEnd > tbodyStart
    ? html.slice(tbodyStart, tbodyEnd)
    : html;

  const rows: RootZoneRow[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(body)) !== null) {
    const rowHtml = rowMatch[1];

    // 1. The domain link — the row's identity.
    const linkMatch = rowHtml.match(
      /<a\s+href="\/domains\/root\/db\/([^"#]+?)(?:\.html)?(?:"|#|\s)>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const hrefAscii = decodeURIComponent(linkMatch[1]).toLowerCase();
    const displayHtml = linkMatch[2];
    // The anchor may contain icon markup; the visible label is the text node.
    const displayText = decodeHtmlEntities(displayHtml.replace(/<[^>]*>/g, ' ')).trim().split(/\s+/)[0] ?? '';
    const display = displayText.replace(/^\./, '');

    if (!/^[a-z0-9-]+$/.test(hrefAscii)) {
      throw new Error(`Root zone database contains an invalid domain: "${linkMatch[1]}"`);
    }
    if (seen.has(hrefAscii)) {
      throw new Error(`Root zone database contains a duplicate row: "${hrefAscii}"`);
    }
    seen.add(hrefAscii);

    // 2. Cell text values, plus a manager cell that carries a class.
    const cells: string[] = [];
    let managerCell: string | null = null;
    const tdRe = /<td([^>]*)>([\s\S]*?)<\/td>/g;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const attrs = tdMatch[1] ?? '';
      const text = decodeHtmlEntities(tdMatch[2].replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
      if (/class="[^"]*col-manager/i.test(attrs)) managerCell = text;
    }

    // 3. Type: match any cell against the known labels.
    //    The current layout spells them with spaces ("Country Code"), the
    //    legacy layout with hyphens, so normalise before comparing.
    let type = '';
    for (const label of ROOT_ZONE_TYPE_LABELS) {
      const found = cells.find(c => c.toLowerCase().replace(/\s+/g, '-') === label);
      if (found) { type = found.toLowerCase().replace(/\s+/g, '-'); break; }
    }

    // 4. Status: a cell matching one of IANA's published status words.
    const status = cells.find(c =>
      ROOT_ZONE_STATUSES.includes(c.toLowerCase() as (typeof ROOT_ZONE_STATUSES)[number]),
    ) ?? null;

    // 5. Script (BCP 47) in the current layout, e.g. "Latn".
    const script = cells.find(c => /^[A-Z][a-z]{3}$/.test(c) && c !== 'Latin' && !ROOT_ZONE_TYPE_LABELS.includes(c.toLowerCase() as any)) ?? null;

    // 6. Manager: prefer the labelled cell, then fall back to legacy position.
    let manager: string | null = null;
    let statusNote: string | null = null;

    if (managerCell) {
      // Reserved names carry usage prose in this column, not an organisation.
      if (status?.toLowerCase() === 'reserved') {
        statusNote = managerCell.trim() || null;
      } else {
        manager = /^not assigned$/i.test(managerCell) ? null : (managerCell.trim() || null);
      }
    } else {
      const typeIndex = cells.findIndex(c => c.toLowerCase().replace(/\s+/g, '-') === type);
      const candidate = typeIndex >= 0 ? cells[typeIndex + 1] : undefined;
      if (candidate && !/^not assigned$/i.test(candidate)) manager = candidate.trim() || null;
    }

    const isIdn = hrefAscii.startsWith('xn--');
    rows.push({
      ascii: hrefAscii,
      // Only trust a non-ASCII display label as the Unicode name.
      unicode: isIdn && display && !/^[\x20-\x7e]+$/.test(display) ? display : null,
      type,
      manager,
      status,
      script,
      status_note: statusNote,
    });
  }

  if (rows.length === 0) {
    throw new Error('Root zone database parsed to zero rows');
  }
  return rows;
}

export interface DetailPageResult {
  /** e.g. "Generic top-level domain" — the parenthesised type text. */
  typeText: string | null;
  sponsoringOrganisation: string | null;
  registrationServicesUrl: string | null;
  whoisServer: string | null;
  rdapServer: string | null;
  /** "Record last updated 2026-03-10." */
  recordLastUpdated: string | null;
  /** "Registration date 1985-01-01." */
  registrationDate: string | null;
  references: TldReference[];
  /** Which IANA page layout this parse used ("legacy" | "current"). */
  layout: 'legacy' | 'current';
}

/**
 * Parse a single IANA delegation record page (`/domains/root/db/<tld>.html`).
 *
 * IANA redesigned this page in 2026. The old layout used inline
 * `<b>WHOIS Server:</b> value <br>`; the current layout uses a labelled
 * row grid (`<div class="row"><div class="col-2 muted">WHOIS Server</div>
 * <div class="col-4">whois.example</div></div>`). Both formats are parsed so
 * a re-sync stays stable regardless of which layout is served.
 */
export function parseDetailPage(html: string): DetailPageResult {
  if (typeof html !== 'string' || !isDelegationPage(html)) {
    throw new Error('Detail page does not look like an IANA delegation record');
  }

  const main = sliceMain(html);

  const typeText =
    matchText(main, /<p>\s*\(([^)]+)\)\s*<\/p>/) ?? matchText(main, /<h2>Domain Information<\/h2>/);

  let sponsoringOrganisation: string | null = null;
  const orgMatch = main.match(/<h2>Sponsoring Organisation<\/h2>\s*<b>([\s\S]*?)<\/b>/i);
  if (orgMatch) {
    const raw = decodeHtmlEntities(stripTags(orgMatch[1])).trim();
    sponsoringOrganisation = /^not assigned$/i.test(raw) ? null : (raw || null);
  } else {
    // Current layout: Manager card header h2.
    const mgrMatch = main.match(
      /<div class="col-3 tld-label muted">Manager<\/div>\s*<div class="col[^"]*">[\s\S]*?<h2>([\s\S]*?)<\/h2>/i,
    );
    if (mgrMatch) {
      const raw = decodeHtmlEntities(stripTags(mgrMatch[1])).trim();
      sponsoringOrganisation = /^not assigned$/i.test(raw) ? null : (raw || null);
    }
  }

  const registrationServicesUrl =
    extractHref(main, /<b>URL for registration services:<\/b>\s*<a[^>]+href="([^"]+)"/i) ??
    extractHref(main, />Website<\/div>\s*<div class="col[^"]*">\s*<a[^>]+href="([^"]+)"/i);

  const whoisServer =
    matchText(main, /<b>WHOIS Server:<\/b>\s*([^\s<]+)/i) ??
    matchText(main, />WHOIS Server<\/div>\s*<div class="col[^"]*">\s*([a-z0-9.-]+)/i);

  const rdapServer =
    extractHref(main, /<b>RDAP Server:\s*<\/b>\s*<a[^>]+href="([^"]+)"/i) ??
    matchText(main, /<b>RDAP Server:<\/b>\s*([^\s<]+)/i) ??
    matchText(main, />RDAP Base URLs<\/div>\s*<div class="col[^"]*">[\s\S]{0,200}?(https?:\/\/[^\s<"']+)/i) ??
    matchText(main, />RDAP Base URLs<\/div>\s*<div class="col[^"]*">\s*([^\s<"']+)/i);

  const recordLastUpdated =
    matchText(main, /Record last updated\s+(\d{4}-\d{2}-\d{2})/i) ??
    matchText(main, />Last Updated<\/div>\s*<div class="col[^"]*">\s*(\d{4}-\d{2}-\d{2})/i);

  const registrationDate = matchText(main, /Registration date\s+(\d{4}-\d{2}-\d{2})/i);

  const references: TldReference[] = [];
  const refRe = /<li>\s*<a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*(?:\(([^)]*)\))?\s*<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(main)) !== null) {
    const url = m[1];
    const title = decodeHtmlEntities(stripTags(m[2])).trim();
    // Only keep substantive references. Exclude site chrome that also lives in
    // an <li><a> (privacy policy, terms, footer navigation).
    if (!title) continue;
    if (/privacy|terms of service|tos\/|contact|about\/|homepage|do not sell/i.test(title + ' ' + url)) continue;
    if (!/rfc\d|rfc |delegation |assignment |root-db|icann\.org\/(en|resources)|iana\.org\/(domains|reports|assignments|protocols)/i.test(title + ' ' + url)) continue;
    if (references.some((r) => r.url === url)) continue;
    references.push({ title, url });
    if (references.length >= 6) break;
  }

  const legacyPatterns = /Sponsoring Organisation|URL for registration services|RDAP Server/.test(main);
  const currentPatterns = /col-3 tld-label muted/.test(main);

  return {
    typeText,
    sponsoringOrganisation,
    registrationServicesUrl: registrationServicesUrl ? safeUrl(registrationServicesUrl) : null,
    whoisServer: whoisServer ? whoisServer.replace(/[.,;]$/, '') : null,
    rdapServer: rdapServer ? safeUrl(rdapServer) : null,
    recordLastUpdated,
    registrationDate,
    references,
    // Prefer "current" when the labelled-row grid is present, since the newer
    // pages can also contain legacy-style wording in fallback markup.
    layout: currentPatterns && !legacyPatterns ? 'current' : legacyPatterns ? 'legacy' : 'current',
  };
}

/**
 * Extract the main content region from a delegation page, dropping the
 * sidebar/footer nav so labels from navigation are never mistaken for data.
 */
function sliceMain(html: string): string {
  const end = html.indexOf('<nav id="sidenav"');
  const start = html.indexOf('Delegation Record for');
  if (start >= 0 && end > start) return html.slice(start, end);
  if (start >= 0) return html.slice(start);
  // Current layout has no sentinel string — take from <main> (or <h1>)
  // up to the sidenav, bounded to the <body>.
  const h1 = html.search(/<h1[^>]*>/);
  const bodyStart = h1 >= 0 ? h1 : (html.indexOf('<body') >= 0 ? html.indexOf('<body') : 0);
  if (end > bodyStart) return html.slice(bodyStart, end);
  return html.slice(bodyStart);
}

/**
 * True when the page looks like an IANA root-zone delegation record.
 *
 * IANA changed the page title/h1 over time:
 *   legacy : "<h1>Delegation Record for .COM</h1>"
 *   current: "<h1 class="tld-name">.com</h1>" + <title>.com Top-Level Domain</title>
 */
function isDelegationPage(html: string): boolean {
  if (html.includes('Delegation Record for')) return true;
  // Current layout: title is ".<tld> Top-Level Domain" and a tld-name h1 exists.
  const titleMatch = html.match(/<title>\s*\.?([a-z0-9-]+)\s+Top-Level Domain\s*<\/title>/i);
  if (titleMatch && html.includes('class="tld-name"')) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Normalisation rules                                                 */
/* ------------------------------------------------------------------ */

/**
 * Map IANA's published type to a normalised value.
 *
 * The rule is intentionally a *lookup*, not a heuristic: we never infer the
 * type from the label length or the label itself, because 2-letter TLDs are
 * not automatically country-code TLDs (e.g. IANA labels `.io` as
 * country-code but `.ai` also as country-code while `.museum` is generic —
 * and some historical 2-letter strings are not ccTLDs at all).
 */
export function normalizeType(sourceType: string | null | undefined): NormalizedType | null {
  if (!sourceType) return null;
  // "Country Code" / "Special Use" (current layout) → "country-code" / "special-use".
  const t = sourceType.trim().toLowerCase().replace(/\s+/g, '-');
  switch (t) {
    case 'generic':
    case 'generic-restricted':
    case 'country-code':
    case 'sponsored':
    case 'infrastructure':
    case 'test':
    case 'special-use':
      return t as NormalizedType;
    // Tolerate minor wording variants from the source page.
    case 'country-code-td':
    case 'country-code-tld':
    case 'cc':
    case 'cctld':
      return 'country-code';
    case 'generic-tld':
    case 'gtld':
      return 'generic';
    case 'sponsored-tld':
    case 'stld':
      return 'sponsored';
    // IANA's 2026 redesign relabelled the former "Test" and
    // "Infrastructure" values as "Special Use"; map them so an older
    // dataset and a newer one normalise to the same category.
    case 'infrastructure-tld':
    case 'test-tld':
      return 'special-use';
    default:
      return null;
  }
}

/**
 * Normalise user input to a bare ASCII label.
 *  ".COM"      → "com"
 *  "example.com" → "com"
 *  "https://example.co.uk/path" → "uk"
 *  ""          → null
 */
export function normalizeSuffixInput(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (s.length === 0) return null;
  // Strip scheme, path, query and fragment.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  // Strip credentials and port.
  s = s.replace(/^[^@/]*@/, '').split(':')[0];
  // Strip a single leading dot used for suffix-only input.
  if (s.startsWith('.')) s = s.slice(1);
  // Drop trailing dot (FQDN form).
  s = s.replace(/\.$/, '');
  if (s.length === 0) return null;
  const lastLabel = s.split('.').pop() ?? '';
  if (lastLabel.length === 0) return null;
  if (!/^[a-z0-9-]+$/.test(lastLabel)) return null;
  if (lastLabel.startsWith('-') || lastLabel.endsWith('-')) return null;
  return lastLabel;
}

/** True when the label uses the punycode (xn--) form. */
export function isPunycodeLabel(label: string): boolean {
  return /^xn--/.test(label);
}

/**
 * Decode a punycode label to its Unicode form.
 * Returns null when the label is not punycode or cannot be decoded.
 */
export function toUnicodeLabel(label: string): string | null {
  if (!isPunycodeLabel(label)) return null;
  try {
    const decoded = toUnicode(label);
    if (!decoded || decoded === label) return null;
    if (/^[a-z0-9-]+$/i.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Human-facing category slug for a normalised type. */
export function categoryForType(type: NormalizedType | null): string | null {
  switch (type) {
    case 'generic':
    case 'generic-restricted':
    case 'sponsored':
      // IANA's 2026 redesign folds these into "Generic".
      return 'generic';
    case 'country-code':
      return 'country-code';
    case 'infrastructure':
    case 'test':
    case 'special-use':
      return 'special-use';
    default:
      return null;
  }
}

/**
 * Map a normalised type to a category URL that actually exists on the site.
 * Returns `/category/generic/` as the safe default for unknown/legacy values.
 */
export function categoryUrlForType(type: string | null): string {
  return `/category/${categoryForType(type as NormalizedType | null) ?? 'generic'}/`;
}

/** First letter of the A–Z index for a label (digits/other → "0-9"). */
export function letterFor(label: string): string {
  const first = label.charAt(0);
  return /^[a-z]$/.test(first) ? first : '0-9';
}

/* ------------------------------------------------------------------ */
/* Small HTML helpers                                                  */
/* ------------------------------------------------------------------ */

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function matchText(haystack: string, re: RegExp): string | null {
  const m = haystack.match(re);
  if (!m) return null;
  const value = decodeHtmlEntities((m[1] ?? '').trim());
  return value.length > 0 ? value : null;
}

function extractHref(haystack: string, re: RegExp): string | null {
  const m = haystack.match(re);
  return m && m[1] ? m[1] : null;
}

/** Only allow http(s) URLs from external data — never javascript: or data:. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (/[\s<>"']/.test(trimmed)) return null;
  return trimmed;
}
