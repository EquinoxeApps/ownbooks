import { strToU8, zipSync, type Zippable } from 'fflate';

import { bytesSource } from '../../tags/source';
import { NotAnEpubError, readEpubInfo, resolvePath } from '..';
import { parseXml, textOf, find } from '../xml';
import { readZipEntries, readZipEntry } from '../zip';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function epub(files: Record<string, string | Uint8Array>): Uint8Array {
  const zippable: Zippable = {
    // The mimetype entry is stored uncompressed, as the spec requires.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER),
  };
  for (const [name, data] of Object.entries(files)) zippable[name] = typeof data === 'string' ? strToU8(data) : data;
  return zipSync(zippable);
}

const epub3 = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t">Pride &amp; Prejudice</dc:title>
    <dc:creator id="c1">Hugh Thomson</dc:creator>
    <dc:creator id="c2">Jane Austen</dc:creator>
    <meta refines="#c1" property="role" scheme="marc:relators">ill</meta>
    <meta refines="#c2" property="role" scheme="marc:relators">aut</meta>
  </metadata>
  <manifest>
    <item id="img" href="images/cover%20art.png" media-type="image/png" properties="cover-image"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>`;

const epub2 = `<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Walden</dc:title>
    <dc:creator opf:role="aut" opf:file-as="Thoreau, Henry David">Henry David Thoreau</dc:creator>
    <meta name="cover" content="cover-jpg"/>
  </metadata>
  <manifest><item id="cover-jpg" href="../cover.jpg" media-type="image/jpeg"/></manifest>
</package>`;

describe('readEpubInfo', () => {
  it('reads an EPUB 3: title, the creator with the author role, and the cover-image item', () => {
    const info = readEpubInfo(
      bytesSource(epub({ 'OEBPS/content.opf': epub3, 'OEBPS/images/cover art.png': PNG })),
    );
    expect(info).toEqual({
      title: 'Pride & Prejudice',
      author: 'Jane Austen',
      cover: { bytes: PNG, mime: 'image/png' },
      drm: false,
    });
  });

  it('reads an EPUB 2: opf:role and the cover meta, with a relative href', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 9]);
    const info = readEpubInfo(bytesSource(epub({ 'OEBPS/content.opf': epub2, 'cover.jpg': jpg })));
    expect(info).toMatchObject({ title: 'Walden', author: 'Henry David Thoreau', drm: false });
    expect(info.cover?.mime).toBe('image/jpeg');
  });

  it('detects Adobe DRM and encrypted content, but not font obfuscation', () => {
    const encryption = (algorithm: string) => `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
      <enc:EncryptionMethod Algorithm="${algorithm}"/></enc:EncryptedData></encryption>`;
    const base = { 'OEBPS/content.opf': epub2 };
    expect(readEpubInfo(bytesSource(epub({ ...base, 'META-INF/rights.xml': '<rights/>' }))).drm).toBe(true);
    expect(
      readEpubInfo(
        bytesSource(epub({ ...base, 'META-INF/encryption.xml': encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc') })),
      ).drm,
    ).toBe(true);
    expect(
      readEpubInfo(bytesSource(epub({ ...base, 'META-INF/encryption.xml': encryption('http://www.idpf.org/2008/embedding') })))
        .drm,
    ).toBe(false);
  });

  it('rejects files that are not EPUBs', () => {
    expect(() => readEpubInfo(bytesSource(new Uint8Array(100)))).toThrow(NotAnEpubError);
    const noOpf = zipSync({ mimetype: strToU8('application/epub+zip') });
    expect(() => readEpubInfo(bytesSource(noOpf))).toThrow(NotAnEpubError);
  });
});

describe('zip', () => {
  it('lists entries and reads stored and deflated ones', () => {
    const text = 'x'.repeat(5000);
    const source = bytesSource(zipSync({ 'a.txt': strToU8(text), 'b.bin': [PNG, { level: 0 }] }));
    const entries = readZipEntries(source);
    expect([...entries.keys()]).toEqual(['a.txt', 'b.bin']);
    expect(entries.get('a.txt')?.method).toBe(8);
    expect(new TextDecoder().decode(readZipEntry(source, entries.get('a.txt')!, 10_000))).toBe(text);
    expect(readZipEntry(source, entries.get('b.bin')!, 10_000)).toEqual(PNG);
    expect(() => readZipEntry(source, entries.get('a.txt')!, 100)).toThrow('entry too large');
  });
});

describe('xml', () => {
  it('handles prefixes, entities, CDATA and comments', () => {
    const doc = parseXml('<?xml?><!-- c --><a><dc:b x="1 &lt; 2">One &amp;<![CDATA[ <two> ]]></dc:b></a>');
    const b = find(doc, 'b');
    expect(b.attrs.x).toBe('1 < 2');
    expect(textOf(b)).toBe('One & <two>');
  });

  it('resolves hrefs against the OPF folder', () => {
    expect(resolvePath('OEBPS/content.opf', 'images/a%20b.png#x')).toBe('OEBPS/images/a b.png');
    expect(resolvePath('OEBPS/content.opf', '../cover.jpg')).toBe('cover.jpg');
    expect(resolvePath('content.opf', './c.png')).toBe('c.png');
  });
});
