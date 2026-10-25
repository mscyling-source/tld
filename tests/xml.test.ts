/**
 * XML reader tests.
 *
 * The reader exists so a mangled API response throws instead of yielding a
 * partial price list, so the failure cases matter as much as the happy path.
 */

import { describe, it, expect } from 'vitest';
import { parseXml, rootElement, firstChild, elementChildren, findFirst } from '../scripts/pricing/xml.js';

const SIMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse Status="OK">
  <Errors />
  <CommandResponse Type="x">
    <Result>
      <Product Name="com"><Price Duration="1" Price="9.58" /></Product>
    </Result>
  </CommandResponse>
</ApiResponse>`;

describe('parseXml', () => {
  it('builds a tree with attributes, self-closing tags and nesting', () => {
    const doc = parseXml(SIMPLE);
    const root = rootElement(doc);
    expect(root.name).toBe('ApiResponse');
    expect(root.attrs.Status).toBe('OK');

    const product = findFirst(doc, 'Product');
    expect(product?.attrs.Name).toBe('com');
    const price = firstChild(product!, 'Price');
    expect(price?.attrs.Duration).toBe('1');
    expect(price?.attrs.Price).toBe('9.58');
    expect(price?.children).toHaveLength(0);
  });

  it('keeps tag-name case (XML is case-sensitive)', () => {
    const doc = parseXml('<Root><ProductType Name="DOMAIN" /></Root>');
    expect(rootElement(doc).name).toBe('Root');
    expect(firstChild(rootElement(doc), 'ProductType')).not.toBeNull();
  });

  it('decodes entities in attribute values and text', () => {
    const doc = parseXml('<Root><Node Label="a &amp; b &lt;c&gt;">x &amp; y</Node></Root>');
    const node = firstChild(rootElement(doc), 'Node')!;
    expect(node.attrs.Label).toBe('a & b <c>');
    expect(node.text).toBe('x & y');
  });

  it('collects direct text content only', () => {
    const doc = parseXml('<Root><A>outer<B>inner</B></A></Root>');
    const a = firstChild(rootElement(doc), 'A')!;
    expect(a.text).toBe('outer');
    expect(firstChild(a, 'B')?.text).toBe('inner');
  });

  it('throws on an empty payload', () => {
    expect(() => parseXml('   ')).toThrow(/empty/i);
  });

  it('throws on malformed XML rather than returning a partial tree', () => {
    expect(() => parseXml('<Root><Unclosed></Root>')).toThrow(/malformed XML/i);
  });

  it('throws when the document has no root element', () => {
    expect(() => parseXml('<?xml version="1.0"?>')).toThrow(/no root element/i);
  });

  it('refuses payloads above the byte limit', () => {
    expect(() => parseXml('<a/>', { maxBytes: 2 })).toThrow(/too large/i);
  });

  it('refuses documents that nest beyond the depth limit', () => {
    const deep = '<a>'.repeat(40) + '</a>'.repeat(40);
    expect(() => parseXml(deep, { maxDepth: 10 })).toThrow(/nesting deeper/i);
  });

  it('refuses documents with more elements than the node limit', () => {
    const wide = `<r>${'<i/>'.repeat(50)}</r>`;
    expect(() => parseXml(wide, { maxNodes: 10 })).toThrow(/more than 10 elements/i);
  });

  it('elementChildren filters by tag name and returns all children without one', () => {
    const doc = parseXml('<r><a/><b/><a/></r>');
    const root = rootElement(doc);
    expect(elementChildren(root, 'a')).toHaveLength(2);
    expect(elementChildren(root)).toHaveLength(3);
    expect(elementChildren(root, 'c')).toHaveLength(0);
  });

  it('findFirst searches depth-first and returns null when absent', () => {
    const doc = parseXml('<r><x><deep/></x><y/></r>');
    expect(findFirst(doc, 'deep')?.name).toBe('deep');
    expect(findFirst(doc, 'missing')).toBeNull();
  });
});
