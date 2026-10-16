/**
 * A small, forgiving XML parser for the few EPUB files read at import
 * (container.xml, the OPF, encryption.xml). Hermes has no DOMParser. Element
 * and attribute names keep their prefixes; `local()` strips them, because EPUBs
 * use namespace prefixes inconsistently (dc:title, opf:meta, or none).
 */

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const local = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase();

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(source.slice(i, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end < 0 ? source.length : end + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      top.text += source.slice(lt + 9, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end + 3;
    } else if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      const end = source.indexOf('>', lt);
      i = end < 0 ? source.length : end + 1;
    } else if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt);
      const name = source.slice(lt + 2, end < 0 ? source.length : end).trim();
      // Close up to the matching element; ignore stray closing tags.
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end < 0 ? source.length : end + 1;
    } else {
      const end = source.indexOf('>', lt);
      if (end < 0) break;
      let body = source.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const nameEnd = body.search(/[\s]/);
      const name = nameEnd < 0 ? body : body.slice(0, nameEnd);
      const attrs: Record<string, string> = {};
      for (const m of body.slice(name.length).matchAll(ATTR)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      const el: XmlElement = { name, attrs, children: [], text: '' };
      top.children.push(el);
      if (!selfClosing) stack.push(el);
      i = end + 1;
    }
  }
  return root;
}

/** All descendants with this local name, in document order. */
export function findAll(el: XmlElement, localName: string, out: XmlElement[] = []): XmlElement[] {
  for (const child of el.children) {
    if (local(child.name) === localName) out.push(child);
    findAll(child, localName, out);
  }
  return out;
}

export const find = (el: XmlElement, localName: string) => findAll(el, localName)[0];

/** Attribute by local name (`opf:role` and `role` both match "role"). */
export function attr(el: XmlElement, localName: string): string | undefined {
  for (const [key, value] of Object.entries(el.attrs)) if (local(key) === localName) return value;
  return undefined;
}

/** Text content including descendants, with whitespace collapsed. */
export function textOf(el: XmlElement): string {
  const parts: string[] = [el.text];
  for (const child of el.children) parts.push(textOf(child));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
