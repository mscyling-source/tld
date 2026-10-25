/**
 * Minimal XML reader for machine-generated API responses.
 *
 * Only one source needs it (Namecheap's `xml.response`), but the rules it
 * enforces are the ones that matter for that source: strict well-formedness
 * (a truncated or mangled payload throws instead of yielding half a price
 * list) and hard size/depth caps (an upstream that suddenly returns a
 * 200 MB document, or 40 levels of nesting, is a fault, not a catalogue).
 *
 * Built on `sax` — a mature, dependency-free streaming parser — rather than a
 * hand-rolled regex scanner, because a regex scanner silently mis-parses
 * exactly the cases that matter (self-closing tags, attributes containing
 * `>`, entity-encoded values).
 */

import sax from 'sax';

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (entity-decoded). */
  text: string;
}

export interface XmlLimits {
  maxNodes?: number;
  maxDepth?: number;
  maxBytes?: number;
}

const DEFAULT_LIMITS: Required<XmlLimits> = {
  maxNodes: 200_000,
  maxDepth: 32,
  maxBytes: 8_000_000,
};

/**
 * Parse a document into a tree. Throws on malformed input or when a limit is
 * exceeded — callers treat that as "this response is unusable", never as
 * "publish whatever we managed to read".
 */
export function parseXml(xml: string, limits: XmlLimits = {}): XmlNode {
  const maxNodes = limits.maxNodes ?? DEFAULT_LIMITS.maxNodes;
  const maxDepth = limits.maxDepth ?? DEFAULT_LIMITS.maxDepth;
  const maxBytes = limits.maxBytes ?? DEFAULT_LIMITS.maxBytes;

  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('XML payload is empty');
  }
  if (xml.length > maxBytes) {
    throw new Error(`XML payload too large: ${xml.length} bytes (limit ${maxBytes})`);
  }

  const parser = sax.parser(true, {
    lowercase: false,
    trim: false,
    normalize: false,
    xmlns: false,
  });

  const document: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [document];
  let nodeCount = 0;
  let limitError: Error | null = null;

  const readAttributes = (tag: { attributes: Record<string, unknown> }): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(tag.attributes ?? {})) {
      if (typeof value === 'string') out[key] = value;
      else if (value && typeof value === 'object' && 'value' in value) {
        out[key] = String((value as { value: unknown }).value);
      }
    }
    return out;
  };

  parser.onopentag = tag => {
    if (limitError) return;
    if (stack.length > maxDepth) {
      limitError = new Error(`XML nesting deeper than ${maxDepth} levels`);
      return;
    }
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      limitError = new Error(`XML document has more than ${maxNodes} elements`);
      return;
    }
    const node: XmlNode = {
      name: tag.name,
      attrs: readAttributes(tag),
      children: [],
      text: '',
    };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  };

  parser.onclosetag = () => {
    if (limitError) return;
    if (stack.length > 1) stack.pop();
  };

  parser.ontext = chunk => {
    if (limitError) return;
    stack[stack.length - 1].text += chunk;
  };

  parser.oncdata = chunk => {
    if (limitError) return;
    stack[stack.length - 1].text += chunk;
  };

  try {
    parser.write(xml).close();
  } catch (e) {
    throw new Error(`malformed XML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (limitError) throw limitError;
  // sax does not treat an unclosed element as an error at end of input, so a
  // truncated response would otherwise yield a plausible-looking partial tree.
  // A balanced stack is the only proof the document ended where it should.
  if (stack.length !== 1) {
    throw new Error(
      `malformed XML: document ended with ${stack.length - 1} unclosed element(s) ` +
        `(<${stack[stack.length - 1]?.name ?? 'unknown'}> still open)`,
    );
  }
  if (document.children.length === 0) throw new Error('XML payload has no root element');

  return document;
}

/** Direct element children, optionally filtered by tag name. */
export function elementChildren(node: XmlNode, name?: string): XmlNode[] {
  if (!name) return node.children;
  return node.children.filter(child => child.name === name);
}

/** First direct element child with this tag name. */
export function firstChild(node: XmlNode, name: string): XmlNode | null {
  return node.children.find(child => child.name === name) ?? null;
}

/** Depth-first search for the first element with this tag name. */
export function findFirst(node: XmlNode, name: string): XmlNode | null {
  for (const child of node.children) {
    if (child.name === name) return child;
    const found = findFirst(child, name);
    if (found) return found;
  }
  return null;
}

/** The single root element of a parsed document. */
export function rootElement(document: XmlNode): XmlNode {
  const [root] = document.children;
  if (!root) throw new Error('XML payload has no root element');
  return root;
}
