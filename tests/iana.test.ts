/**
 * Unit tests for IANA parsing + normalisation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDelegatedList,
  parseRootZoneDb,
  parseDetailPage,
  normalizeType,
  normalizeSuffixInput,
  isPunycodeLabel,
  toUnicodeLabel,
  categoryForType,
  categoryUrlForType,
  letterFor,
} from '../src/lib/iana.js';
import {
  DELEGATED_LIST_SAMPLE,
  DELEGATED_LIST_MINIMAL,
  ROOT_ZONE_DB_SAMPLE,
  ROOT_ZONE_DB_CURRENT,
  DETAIL_PAGE_COM,
  DETAIL_PAGE_AI,
  DETAIL_PAGE_NO_MANAGER,
  DETAIL_PAGE_CURRENT_COM,
} from './fixtures.js';

describe('parseDelegatedList', () => {
  it('parses a normal list and extracts version/date', () => {
    const res = parseDelegatedList(DELEGATED_LIST_SAMPLE);
    expect(res.labels).toEqual([
      'aaa', 'aarp', 'abb', 'abbott', 'com', 'net', 'org', 'ai', 'io', 'dev', 'uk', 'xn--55qx5d',
    ]);
    expect(res.version).toBe('2026101200');
    expect(res.lastUpdated).toBe('Mon Oct 12 07:07:01 2026 UTC');
  });

  it('rejects empty input', () => {
    expect(() => parseDelegatedList('')).toThrow('empty');
  });

  it('rejects duplicate labels', () => {
    const bad = `# Version 1\nCOM\nCOM\n`;
    expect(() => parseDelegatedList(bad)).toThrow('duplicate');
  });

  it('rejects invalid label characters', () => {
    const bad = `# Version 1\nCOM\nINVALID_LABEL\n`;
    expect(() => parseDelegatedList(bad)).toThrow('invalid label');
  });
});

describe('parseRootZoneDb', () => {
  it('parses rows with all three columns', () => {
    const rows = parseRootZoneDb(ROOT_ZONE_DB_SAMPLE);
    expect(rows.length).toBe(7);
    const com = rows.find(r => r.ascii === 'com')!;
    expect(com.type).toBe('generic');
    expect(com.manager).toBe('VeriSign Global Registry Services');
    expect(com.unicode).toBeNull();

    const idn = rows.find(r => r.ascii === 'xn--55qx5d')!;
    expect(idn.unicode).toBe('公司');
  });

  it('treats "Not assigned" as null manager', () => {
    const rows = parseRootZoneDb(ROOT_ZONE_DB_SAMPLE);
    const abarth = rows.find(r => r.ascii === 'abarth')!;
    expect(abarth.manager).toBeNull();
  });

  it('rejects empty/malformed HTML', () => {
    expect(() => parseRootZoneDb('')).toThrow('empty');
    expect(() => parseRootZoneDb('<html></html>')).toThrow('expected table');
  });

  // IANA redesigned the index page in 2026: no ".html" suffix, new status
  // column, and types spelled with spaces ("Country Code", "Special Use").
  describe('current IANA index-page layout', () => {
    const rows = parseRootZoneDb(ROOT_ZONE_DB_CURRENT);

    it('parses rows and captures the verbatim status', () => {
      expect(rows.length).toBeGreaterThanOrEqual(10);
      const aaa = rows.find(r => r.ascii === 'aaa')!;
      expect(aaa.type).toBe('generic');
      expect(aaa.manager).toBe('American Automobile Association, Inc.');
      expect(aaa.status).toBe('Active');
      expect(aaa.script).toBe('Latn');
    });

    it('reads the current type labels', () => {
      expect(rows.find(r => r.ascii === 'ac')!.type).toBe('country-code');
      expect(rows.find(r => r.ascii === 'gov')!.type).toBe('generic');
      expect(rows.find(r => r.ascii === 'arpa')!.type).toBe('special-use');
      expect(rows.find(r => r.ascii === 'test')!.type).toBe('special-use');
    });

    it('records retired and reserved rows separately from active ones', () => {
      const abarth = rows.find(r => r.ascii === 'abarth')!;
      expect(abarth.status).toBe('Retired');
      expect(abarth.manager).toBeNull();

      const testTld = rows.find(r => r.ascii === 'test')!;
      expect(testTld.status).toBe('Reserved');
      // For reserved names IANA puts usage prose in the organisation column.
      expect(testTld.manager).toBeNull();
      expect(testTld.status_note).toBe('For testing purposes');
    });

    it('captures "eligible" status for not-yet-delegated ccTLDs', () => {
      const bl = rows.find(r => r.ascii === 'bl')!;
      expect(bl.status).toBe('Eligible');
      expect(bl.type).toBe('country-code');
    });

    it('keeps the Unicode display label for IDN rows', () => {
      const zh = rows.find(r => r.ascii === 'xn--fiqz9s') ?? rows.find(r => r.ascii.startsWith('xn--fiqz'));
      if (zh) expect(zh.unicode).toBeTruthy();

      const hanTest = rows.find(r => r.ascii === 'xn--0zwm56d')!;
      expect(hanTest.unicode).toBe('测试');
      expect(hanTest.type).toBe('test');
      expect(hanTest.status).toBe('Retired');
    });

    it('rejects a duplicate row', () => {
      // Rewrite one row's href to another row's label so the same domain
      // appears twice; duplicates must be surfaced, not de-duplicated.
      const dup = ROOT_ZONE_DB_CURRENT.replace(
        '/domains/root/db/aaa"',
        '/domains/root/db/gov"',
      );
      expect(dup).not.toBe(ROOT_ZONE_DB_CURRENT);
      expect(() => parseRootZoneDb(dup)).toThrow(/duplicate/i);
    });
  });
});

describe('parseDetailPage', () => {
  it('extracts type, sponsor, URLs, dates, and references for .com', () => {
    const d = parseDetailPage(DETAIL_PAGE_COM);
    expect(d.typeText).toBe('Generic top-level domain');
    expect(d.sponsoringOrganisation).toBe('VeriSign Global Registry Services');
    expect(d.registrationServicesUrl).toBe('http://www.verisigninc.com');
    expect(d.whoisServer).toBe('whois.verisign-grs.com');
    expect(d.rdapServer).toBe('https://rdap.verisign.com/com/v1/');
    expect(d.recordLastUpdated).toBe('2026-03-10');
    expect(d.registrationDate).toBe('1985-01-01');
    expect(d.references.length).toBeGreaterThanOrEqual(1);
    expect(d.references[0].url).toContain('iana.org');
  });

  it('extracts .ai (country-code) correctly', () => {
    const d = parseDetailPage(DETAIL_PAGE_AI);
    expect(d.typeText).toBe('Country-code top-level domain');
    expect(d.sponsoringOrganisation).toBe('Government of Anguilla');
  });

  it('handles "Not assigned" sponsoring org', () => {
    const d = parseDetailPage(DETAIL_PAGE_NO_MANAGER);
    expect(d.sponsoringOrganisation).toBeNull();
  });

  // IANA redesigned the delegation page in 2026 (no "Delegation Record for"
  // heading, labelled-row grid instead of inline <b> labels). Both layouts
  // must parse to the same facts.
  describe('current IANA page layout', () => {
    it('accepts the page without a "Delegation Record for" heading', () => {
      expect(() => parseDetailPage(DETAIL_PAGE_CURRENT_COM)).not.toThrow();
    });

    it('extracts manager, WHOIS, RDAP, website and last-updated', () => {
      const d = parseDetailPage(DETAIL_PAGE_CURRENT_COM);
      expect(d.layout).toBe('current');
      expect(d.sponsoringOrganisation).toBe('VeriSign Global Registry Services');
      expect(d.registrationServicesUrl).toBe('http://www.verisigninc.com');
      expect(d.whoisServer).toBe('whois.verisign-grs.com');
      expect(d.rdapServer).toBe('https://rdap.verisign.com/com/v1/');
      expect(d.recordLastUpdated).toBe('2026-03-10');
    });

    it('does not mistake footer navigation links for reference documents', () => {
      const d = parseDetailPage(DETAIL_PAGE_CURRENT_COM);
      const urls = d.references.map(r => r.url);
      expect(urls).not.toContain('https://www.icann.org/privacy/policy');
      expect(urls).not.toContain('https://www.icann.org/privacy/tos');
    });

    it('does not leak the sidenav into the parsed region', () => {
      // The sidebar contains "Root Zone" labels — if it leaked in we would see
      // bogus managers. A clean parse proves the slice stops at the sidenav.
      const d = parseDetailPage(DETAIL_PAGE_CURRENT_COM);
      expect(d.sponsoringOrganisation).not.toMatch(/Root Zone|Top-Level Domains/);
    });
  });
});

describe('normalizeType', () => {
  it('maps canonical IANA types', () => {
    expect(normalizeType('generic')).toBe('generic');
    expect(normalizeType('country-code')).toBe('country-code');
    expect(normalizeType('sponsored')).toBe('sponsored');
    expect(normalizeType('generic-restricted')).toBe('generic-restricted');
    expect(normalizeType('infrastructure')).toBe('infrastructure');
    expect(normalizeType('test')).toBe('test');
  });

  it('maps the current IANA layout labels', () => {
    // IANA's 2026 index page spells types with spaces.
    expect(normalizeType('Country Code')).toBe('country-code');
    expect(normalizeType('Special Use')).toBe('special-use');
    expect(normalizeType('Generic')).toBe('generic');
  });

  it('normalises case and whitespace variants', () => {
    expect(normalizeType('  GENERIC  ')).toBe('generic');
    expect(normalizeType('Country-Code')).toBe('country-code');
  });

  it('returns null for unknown types', () => {
    expect(normalizeType('foo')).toBeNull();
    expect(normalizeType(null)).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
  });
});

describe('categoryUrlForType', () => {
  it('maps to a category page that exists on the site', () => {
    expect(categoryUrlForType('generic')).toBe('/category/generic/');
    expect(categoryUrlForType('country-code')).toBe('/category/country-code/');
    expect(categoryUrlForType('special-use')).toBe('/category/special-use/');
  });

  it('folds the labels IANA no longer publishes into existing pages', () => {
    // IANA's 2026 redesign removed "sponsored", "generic-restricted",
    // "infrastructure" and "test" from the index page. Links must not point
    // at pages that no longer exist.
    expect(categoryUrlForType('sponsored')).toBe('/category/generic/');
    expect(categoryUrlForType('generic-restricted')).toBe('/category/generic/');
    expect(categoryUrlForType('infrastructure')).toBe('/category/special-use/');
    expect(categoryUrlForType('test')).toBe('/category/special-use/');
  });

  it('falls back to generic for null or unknown types', () => {
    expect(categoryUrlForType(null)).toBe('/category/generic/');
    expect(categoryUrlForType('nonsense')).toBe('/category/generic/');
  });
});

describe('normalizeSuffixInput', () => {
  it('handles bare suffix', () => {
    expect(normalizeSuffixInput('com')).toBe('com');
    expect(normalizeSuffixInput('.COM')).toBe('com');
  });

  it('extracts suffix from domain', () => {
    expect(normalizeSuffixInput('example.com')).toBe('com');
    expect(normalizeSuffixInput('sub.example.co.uk')).toBe('uk');
  });

  it('strips scheme, path, query, fragment', () => {
    expect(normalizeSuffixInput('https://example.com/path?x=1#frag')).toBe('com');
    expect(normalizeSuffixInput('http://user:pass@example.org:8080')).toBe('org');
  });

  it('returns null for empty/invalid', () => {
    expect(normalizeSuffixInput('')).toBeNull();
    expect(normalizeSuffixInput('not-a-tld')).toBe('not-a-tld');
    expect(normalizeSuffixInput('_.com')).toBe('com');
  });
});

describe('IDN helpers', () => {
  it('detects punycode labels', () => {
    expect(isPunycodeLabel('xn--55qx5d')).toBe(true);
    expect(isPunycodeLabel('com')).toBe(false);
    expect(isPunycodeLabel('XN--55QX5D')).toBe(false); // case-sensitive
  });

  it('decodes punycode to unicode', () => {
    expect(toUnicodeLabel('xn--55qx5d')).toBe('公司');
    expect(toUnicodeLabel('xn--0zwm56d')).toBe('测试');
    expect(toUnicodeLabel('com')).toBeNull();
    expect(toUnicodeLabel('not-punycode')).toBeNull();
  });
});

describe('categoryForType', () => {
  it('returns slug for each normalised type', () => {
    expect(categoryForType('generic')).toBe('generic');
    expect(categoryForType('country-code')).toBe('country-code');
    expect(categoryForType('special-use')).toBe('special-use');
    // IANA's 2026 redesign folds these labels away.
    expect(categoryForType('sponsored')).toBe('generic');
    expect(categoryForType('generic-restricted')).toBe('generic');
    expect(categoryForType('infrastructure')).toBe('special-use');
    expect(categoryForType('test')).toBe('special-use');
    expect(categoryForType(null)).toBeNull();
  });
});

describe('letterFor', () => {
  it('returns first letter for a-z', () => {
    expect(letterFor('com')).toBe('c');
    expect(letterFor('xn--55qx5d')).toBe('x');
  });
  it('returns 0-9 for digits and others', () => {
    expect(letterFor('123')).toBe('0-9');
    expect(letterFor('-abc')).toBe('0-9');
  });
});