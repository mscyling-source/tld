/**
 * Unit tests for search/filter/sort/pagination helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  matchesQuery,
  filterTlds,
  sortTlds,
  paginate,
  totalPages,
  emptyStateMessage,
} from '../src/lib/search.js';

const records = [
  { suffix: '.com', ascii_name: 'com', unicode_name: null, manager_name: 'VeriSign', normalized_type: 'generic', is_idn: false },
  { suffix: '.org', ascii_name: 'org', unicode_name: null, manager_name: 'Public Interest Registry', normalized_type: 'generic', is_idn: false },
  { suffix: '.ai', ascii_name: 'ai', unicode_name: null, manager_name: 'Gov. of Anguilla', normalized_type: 'country-code', is_idn: false },
  { suffix: '.io', ascii_name: 'io', unicode_name: null, manager_name: 'Identity Digital', normalized_type: 'country-code', is_idn: false },
  { suffix: '.公司', ascii_name: 'xn--55qx5d', unicode_name: '公司', manager_name: 'VeriSign Sarl', normalized_type: 'generic', is_idn: true },
] as const;

describe('normalizeQuery', () => {
  it('lowercases and trims', () => {
    expect(normalizeQuery('  COM  ')).toBe('com');
  });
  it('extracts suffix from domain', () => {
    expect(normalizeQuery('example.com')).toBe('com');
    expect(normalizeQuery('blog.example.co.uk')).toBe('uk');
  });
  it('preserves manager-like text', () => {
    expect(normalizeQuery('VeriSign')).toBe('verisign');
  });
  it('returns empty for empty', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('matchesQuery', () => {
  it('matches suffix', () => {
    expect(matchesQuery(records[0], 'com')).toBe(true);
    expect(matchesQuery(records[0], 'om')).toBe(true);
    expect(matchesQuery(records[0], 'net')).toBe(false);
  });
  it('matches manager name', () => {
    expect(matchesQuery(records[0], 'verisign')).toBe(true);
    expect(matchesQuery(records[1], 'public')).toBe(true);
  });
  it('matches unicode name', () => {
    expect(matchesQuery(records[4], '公司')).toBe(true);
    expect(matchesQuery(records[4], '司')).toBe(true);
  });
  it('matches type', () => {
    expect(matchesQuery(records[0], 'generic')).toBe(true);
    expect(matchesQuery(records[2], 'country-code')).toBe(true);
  });
  it('returns true for empty query', () => {
    expect(matchesQuery(records[0], '')).toBe(true);
  });
});

describe('filterTlds', () => {
  it('filters by query', () => {
    const res = filterTlds(records, { q: 'com' });
    expect(res.length).toBe(1);
    expect(res[0].ascii_name).toBe('com');
  });
  it('filters by type', () => {
    const res = filterTlds(records, { types: ['country-code'] });
    expect(res.length).toBe(2);
    expect(res.every(r => r.normalized_type === 'country-code')).toBe(true);
  });
  it('filters by letter', () => {
    const res = filterTlds(records, { letter: 'c' });
    expect(res.length).toBe(1);
    expect(res[0].ascii_name).toBe('com');
  });
  it('filters IDN only', () => {
    const res = filterTlds(records, { idnOnly: true });
    expect(res.length).toBe(1);
    expect(res[0].is_idn).toBe(true);
  });
  it('combines filters', () => {
    const res = filterTlds(records, { q: 'ai', types: ['country-code'] });
    expect(res.length).toBe(1);
    expect(res[0].ascii_name).toBe('ai');
  });
});

describe('sortTlds', () => {
  it('sorts by suffix asc (default)', () => {
    const res = sortTlds(records, 'suffix-asc');
    expect(res.map(r => r.ascii_name)).toEqual(['ai', 'com', 'io', 'org', 'xn--55qx5d']);
  });
  it('sorts by suffix desc', () => {
    const res = sortTlds(records, 'suffix-desc');
    expect(res.map(r => r.ascii_name)).toEqual(['xn--55qx5d', 'org', 'io', 'com', 'ai']);
  });
  it('sorts by manager asc', () => {
    const res = sortTlds(records, 'manager-asc');
    expect(res[0].manager_name).toBe('Gov. of Anguilla');
  });
});

describe('paginate', () => {
  it('returns correct page slice', () => {
    const p1 = paginate(records, 1, 2);
    expect(p1.length).toBe(2);
    const p2 = paginate(records, 2, 2);
    expect(p2.length).toBe(2);
    const p3 = paginate(records, 3, 2);
    expect(p3.length).toBe(1);
  });
  it('clamps page to 1', () => {
    expect(paginate(records, 0, 10).length).toBe(5);
    expect(paginate(records, -5, 10).length).toBe(5);
  });
});

describe('totalPages', () => {
  it('calculates correctly', () => {
    expect(totalPages(0, 10)).toBe(1);
    expect(totalPages(1, 10)).toBe(1);
    expect(totalPages(10, 10)).toBe(1);
    expect(totalPages(11, 10)).toBe(2);
  });
});

describe('emptyStateMessage', () => {
  it('returns generic message for no filters', () => {
    expect(emptyStateMessage({})).toBe('No TLDs match the current filters.');
  });
  it('includes query', () => {
    expect(emptyStateMessage({ q: 'xyz' })).toContain('“xyz”');
  });
  it('includes type', () => {
    expect(emptyStateMessage({ types: ['sponsored'] })).toContain('sponsored');
  });
  it('includes letter', () => {
    expect(emptyStateMessage({ letter: 'q' })).toContain('Q');
  });
  it('includes idnOnly', () => {
    expect(emptyStateMessage({ idnOnly: true })).toContain('internationalized');
  });
});