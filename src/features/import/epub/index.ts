import type { ByteSource } from '../tags/source';
import { decodeUtf8 } from '../tags/text';
import { attr, find, findAll, parseXml, textOf, type XmlElement } from './xml';
import { readZipEntries, readZipEntry, type ZipEntry } from './zip';

export type EpubCover = { bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' };

export type EpubInfo = {
  title: string | null;
  author: string | null;
  cover: EpubCover | null;
  /** DRM-protected (Adobe ADEPT, Apple FairPlay, or encrypted content). */
  drm: boolean;
};

/** Font obfuscation also lives in encryption.xml, but it isn't DRM: those books import fine. */
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
const MAX_XML = 4 * 1024 * 1024;
const MAX_COVER = 10 * 1024 * 1024;
const COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class NotAnEpubError extends Error {}

/** Reads what import needs from an EPUB: details, cover and whether it has DRM. */
export function readEpubInfo(source: ByteSource): EpubInfo {
  let entries: Map<string, ZipEntry>;
  try {
    entries = readZipEntries(source);
  } catch (error) {
    throw new NotAnEpubError('not a zip file', { cause: error });
  }
  const xml = (name: string) => {
    const entry = entries.get(name);
    return entry ? parseXml(decodeUtf8(readZipEntry(source, entry, MAX_XML))) : null;
  };

  if (isDrmProtected(entries, xml)) return { title: null, author: null, cover: null, drm: true };

  const container = xml('META-INF/container.xml');
  const rootfiles = container ? findAll(container, 'rootfile') : [];
  const opfPath =
    (rootfiles.find((r) => attr(r, 'media-type') === 'application/oebps-package+xml') ?? rootfiles[0])?.attrs[
      'full-path'
    ];
  const opf = opfPath ? xml(opfPath) : null;
  if (!opfPath || !opf) throw new NotAnEpubError('no package document');

  const metadata = find(opf, 'metadata');
  const title = metadata ? findAll(metadata, 'title').map(textOf).find(Boolean) ?? null : null;
  return {
    title,
    author: metadata ? authorOf(metadata) : null,
    cover: readCover(source, entries, opf, opfPath),
    drm: false,
  };
}

function isDrmProtected(entries: Map<string, ZipEntry>, xml: (name: string) => XmlElement | null): boolean {
  if (entries.has('META-INF/rights.xml') || entries.has('META-INF/sinf.xml')) return true;
  const encryption = entries.has('META-INF/encryption.xml') ? xml('META-INF/encryption.xml') : null;
  if (!encryption) return false;
  return findAll(encryption, 'encryptionmethod').some((m) => !FONT_OBFUSCATION.has(attr(m, 'algorithm') ?? ''));
}

/** Creators marked as authors (EPUB 2 opf:role or EPUB 3 refines), else every creator. */
function authorOf(metadata: XmlElement): string | null {
  const creators = findAll(metadata, 'creator');
  const roleOf = (c: XmlElement) => {
    const role = attr(c, 'role');
    if (role) return role;
    const id = c.attrs.id;
    const refine = id
      ? findAll(metadata, 'meta').find((m) => m.attrs.refines === `#${id}` && m.attrs.property === 'role')
      : undefined;
    return refine ? textOf(refine) : null;
  };
  const authors = creators.filter((c) => roleOf(c) === 'aut');
  const names = (authors.length > 0 ? authors : creators).map(textOf).filter(Boolean);
  return names.length > 0 ? names.slice(0, 3).join(', ') : null;
}

function readCover(
  source: ByteSource,
  entries: Map<string, ZipEntry>,
  opf: XmlElement,
  opfPath: string,
): EpubCover | null {
  const items = findAll(opf, 'item');
  const coverId = findAll(opf, 'meta').find((m) => m.attrs.name === 'cover')?.attrs.content;
  const item =
    items.find((i) => (i.attrs.properties ?? '').split(/\s+/).includes('cover-image')) ??
    (coverId ? items.find((i) => i.attrs.id === coverId) : undefined) ??
    items.find((i) => /cover/i.test(i.attrs.id ?? '') && (i.attrs['media-type'] ?? '').startsWith('image/'));
  const mime = item?.attrs['media-type'];
  if (!item?.attrs.href || !mime || !COVER_TYPES.has(mime)) return null;

  const entry = entries.get(resolvePath(opfPath, item.attrs.href));
  if (!entry) return null;
  try {
    return { bytes: readZipEntry(source, entry, MAX_COVER), mime: mime as EpubCover['mime'] };
  } catch {
    // A broken cover never fails an import; the generated cover is used instead.
    return null;
  }
}

/** Resolves an href relative to the OPF's folder, as a zip entry name. */
export function resolvePath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1);
  let decoded = href.split('#')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the raw href if it isn't valid percent-encoding.
  }
  for (const part of decoded.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}
