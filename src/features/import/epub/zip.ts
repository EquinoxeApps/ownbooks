import { inflateSync } from 'fflate';

import { decodeLatin1, decodeUtf8 } from '../tags/text';
import { readExactly, type ByteSource } from '../tags/source';

/**
 * Minimal ZIP reader over random-access reads: the central directory at the end
 * of the file, then single entries on demand. EPUB import only needs a few small
 * entries (container.xml, the OPF, the cover), so the book is never read whole.
 */

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  encrypted: boolean;
};

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** EOCD record (22 bytes) plus the longest possible archive comment. */
const EOCD_SEARCH = 22 + 0xffff;

const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export class ZipError extends Error {}

export function readZipEntries(source: ByteSource): Map<string, ZipEntry> {
  const searchLength = Math.min(source.size, EOCD_SEARCH);
  const tail = readExactly(source, source.size - searchLength, searchLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32le(tail, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not a zip file');

  const count = u16le(tail, eocd + 10);
  const cdSize = u32le(tail, eocd + 12);
  const cdOffset = u32le(tail, eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new ZipError('zip64 is not supported');

  const cd = readExactly(source, cdOffset, cdSize);
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || u32le(cd, p) !== CENTRAL_SIG) throw new ZipError('bad central directory');
    const flags = u16le(cd, p + 8);
    const nameLength = u16le(cd, p + 28);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLength);
    // Bit 11: the name is UTF-8; otherwise CP437, which matches Latin-1 for ASCII names.
    const name = flags & 0x800 ? decodeUtf8(nameBytes) : decodeLatin1(nameBytes);
    entries.set(name, {
      name,
      method: u16le(cd, p + 10),
      compressedSize: u32le(cd, p + 20),
      size: u32le(cd, p + 24),
      localHeaderOffset: u32le(cd, p + 42),
      encrypted: (flags & 1) === 1,
    });
    p += 46 + nameLength + u16le(cd, p + 30) + u16le(cd, p + 32);
  }
  return entries;
}

/** Reads and decompresses one entry. `maxSize` guards against huge or bogus entries. */
export function readZipEntry(source: ByteSource, entry: ZipEntry, maxSize: number): Uint8Array {
  if (entry.encrypted) throw new ZipError('encrypted entry');
  if (entry.size > maxSize || entry.compressedSize > maxSize) throw new ZipError('entry too large');
  const header = readExactly(source, entry.localHeaderOffset, 30);
  if (u32le(header, 0) !== LOCAL_SIG) throw new ZipError('bad local header');
  const dataOffset = entry.localHeaderOffset + 30 + u16le(header, 26) + u16le(header, 28);
  const data = readExactly(source, dataOffset, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data, { out: new Uint8Array(entry.size) });
  throw new ZipError(`compression method ${entry.method} is not supported`);
}
