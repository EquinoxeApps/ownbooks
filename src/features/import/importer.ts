import { createAudioPlayer, type AudioStatus } from 'expo-audio';
import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { findByFingerprint, insertAudioBook, insertEbook, type NewChapter } from '@/db/repositories/books';
import type { Db } from '@/db/types';
import { BOOKS_DIR } from '@/lib/files';

import { NotAnEpubError, readEpubInfo } from './epub';
import { bookFingerprint, fileFingerprint, fingerprintRanges } from './fingerprint';
import { AUDIO_PICKER_TYPES, EBOOK_PICKER_TYPES, extensionOf } from './formats';
import { groupPickedFiles, type ImportGroup, type PickedFile } from './grouping';
import { bookDetails } from './metadata';
import { initialImportState, useImportStore, type ImportErrorKey } from './store';
import { readTags, type AudioTags, type CoverImage } from './tags';
import { withFileSource } from './tags/fileSource';

/**
 * Import pipeline (spec §6): pick → group → copy → analyse → confirm → save.
 * Files are copied into a temporary `books/.import-<id>/` folder and only
 * renamed to `books/<bookId>/` together with the database insert, so a failure
 * or cancel at any step leaves no orphan files or rows.
 */

const TMP_PREFIX = '.import-';
/** Keep this much free space after an import. */
const SPACE_MARGIN = 50 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 20_000;

/** Thrown when the user cancels; the partial import is cleaned up silently. */
class CopyCancelled extends Error {}

class ImportFailure extends Error {
  constructor(public readonly key: ImportErrorKey, cause?: unknown) {
    super(key, { cause });
  }
}

type Prepared = {
  kind: 'audio' | 'ebook';
  tmpDir: Directory;
  /** In playback order. */
  tracks: { fileName: string; title: string; durationMs: number }[];
  chapters: NewChapter[];
  /** The EPUB's file name inside tmpDir (ebooks only). */
  ebookFile: string | null;
  /** Cover file name inside tmpDir, if the tags had one. */
  coverFile: string | null;
  title: string;
  author: string | null;
  fingerprint: string;
  sizeBytes: number;
};

let session: {
  db: Db;
  userId: string;
  cancelled: boolean;
  prepared: Prepared | null;
} | null = null;

const set = useImportStore.setState;

/** Which step of the pipeline is running, reported with unexpected errors. */
let step = 'start';

function describe(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const code = (e as { code?: unknown }).code;
  return `${step}: ${e.name}${code ? ` [${String(code)}]` : ''}: ${e.message}`.slice(0, 500);
}

/** Opens the system picker. Returns false if the user backed out. */
export async function pickAndImport(db: Db, userId: string): Promise<boolean> {
  const result = await getDocumentAsync({
    type: [...AUDIO_PICKER_TYPES, ...EBOOK_PICKER_TYPES],
    multiple: true,
    copyToCacheDirectory: false,
  });
  if (result.canceled || result.assets.length === 0) return false;

  const files: PickedFile[] = result.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? 0 }));
  const { groups, rejected } = groupPickedFiles(files);

  set({ ...initialImportState, queue: groups, rejected });
  if (groups.length === 0) {
    set({ status: 'failed', error: rejected[0]?.reason ?? 'unsupported' });
    return true;
  }
  session = { db, userId, cancelled: false, prepared: null };
  void prepareCurrent();
  return true;
}

async function prepareCurrent(): Promise<void> {
  const s = session;
  const { queue, index } = useImportStore.getState();
  const group = queue[index];
  if (!s || !group) return;

  const bytesTotal = group.files.reduce((sum, f) => sum + f.size, 0);
  set({
    status: 'preparing',
    error: null,
    errorDetail: null,
    current: {
      group,
      title: group.suggestedTitle,
      author: null,
      edited: false,
      coverUri: null,
      bytesTotal,
      bytesCopied: 0,
      filesCopied: 0,
      durationMs: null,
    },
  });

  let tmpDir: Directory | null = null;
  step = 'checks';
  try {
    if (bytesTotal > 0 && Paths.availableDiskSpace < bytesTotal + SPACE_MARGIN) {
      throw new ImportFailure('noSpace');
    }

    step = 'temp folder';
    tmpDir = new Directory(Paths.document, BOOKS_DIR, `${TMP_PREFIX}${randomUUID()}`);
    tmpDir.create({ intermediates: true });

    const copied = await copyGroup(group, tmpDir, s);
    const prepared = group.kind === 'ebook' ? await analyseEbook(tmpDir, copied[0].fileName) : await analyse(group, tmpDir, copied);

    step = 'duplicate check';
    const existing = await findByFingerprint(s.db, s.userId, prepared.fingerprint);
    if (existing?.on_device) throw new ImportFailure('duplicate');

    if (s !== session || s.cancelled) throw new CopyCancelled();
    s.prepared = prepared;
    const durationMs = prepared.kind === 'audio' ? prepared.tracks.reduce((sum, t) => sum + t.durationMs, 0) : null;
    const coverUri = prepared.coverFile ? new File(tmpDir, prepared.coverFile).uri : null;
    set((st) => ({
      status: 'ready',
      current: st.current && {
        ...st.current,
        durationMs,
        coverUri,
        // Details from the tags, unless the user already typed their own.
        ...(st.current.edited ? null : { title: prepared.title || st.current.title, author: prepared.author }),
      },
    }));
  } catch (error) {
    if (tmpDir?.exists) tmpDir.delete();
    if (error instanceof CopyCancelled || s !== session) return;
    const expected = error instanceof ImportFailure;
    set({
      status: 'failed',
      error: expected ? error.key : 'generic',
      errorDetail: expected ? null : describe(error),
    });
    if (!expected) console.warn('Import failed', error);
  }
}

async function copyGroup(
  group: ImportGroup,
  tmpDir: Directory,
  s: NonNullable<typeof session>,
): Promise<{ fileName: string; picked: PickedFile }[]> {
  const out: { fileName: string; picked: PickedFile }[] = [];
  let before = 0;
  for (const [i, picked] of group.files.entries()) {
    // Stored under a neutral numbered name: unique, and no user text in paths.
    const fileName = `${String(i + 1).padStart(3, '0')}.${extensionOf(picked.name)}`;
    const source = new File(picked.uri);
    const dest = new File(tmpDir, fileName);
    const expected = picked.size || source.size;
    step = `copy file ${i + 1}`;
    const copied = await copyWithProgress(source, dest, (n) =>
      set((st) => ({ current: st.current && { ...st.current, bytesCopied: before + n } })),
    );
    // The native copy can't be interrupted; honour a cancel as soon as it returns.
    if (s.cancelled || s !== session) throw new CopyCancelled();
    if (expected > 0 && copied !== expected) {
      throw new Error(`copied ${copied} of ${expected} bytes`);
    }
    before += copied;
    out.push({ fileName, picked });
    set((st) => ({ current: st.current && { ...st.current, filesCopied: i + 1 } }));
  }
  return out;
}

/**
 * Copies a picked file with expo-file-system's native copy (off the JS thread)
 * and reports progress by polling the destination size.
 *
 * Reading picked `content://` files through FileHandle fails on Android with
 * "Bad file descriptor" (expo-file-system 57 lets the ParcelFileDescriptor be
 * garbage-collected), so chunked JS copying isn't usable for picked files.
 */
async function copyWithProgress(source: File, dest: File, onProgress: (bytes: number) => void): Promise<number> {
  const poll = setInterval(() => {
    try {
      if (dest.exists) onProgress(dest.size);
    } catch {
      // Size can be briefly unreadable while the file is being created.
    }
  }, 250);
  try {
    await source.copy(dest, { overwrite: true });
  } finally {
    clearInterval(poll);
  }
  const size = dest.size;
  onProgress(size);
  return size;
}

async function analyse(
  group: ImportGroup,
  tmpDir: Directory,
  copied: { fileName: string; picked: PickedFile }[],
): Promise<Prepared> {
  const files: { fileName: string; picked: PickedFile; fingerprint: string; tags: AudioTags; durationMs: number }[] =
    [];
  let cover: CoverImage | undefined;
  let sizeBytes = 0;

  for (const { fileName, picked } of copied) {
    const file = new File(tmpDir, fileName);
    step = `fingerprint ${fileName}`;
    const size = file.size;
    sizeBytes += size;

    const fingerprint = await fingerprintFile(file);

    step = `tags ${fileName}`;
    // Only the first cover found is kept, so later files skip reading theirs.
    const tags = withFileSource(file, (src) => readTags(src, extensionOf(picked.name), { cover: !cover }));
    cover ??= tags.cover;
    delete tags.cover;

    step = `probe ${fileName}`;
    const durationMs = await probeDuration(file.uri);
    files.push({ fileName, picked, fingerprint, tags, durationMs });
  }

  const details = bookDetails(files.map((f) => ({ name: f.picked.name, tags: f.tags })));
  const ordered = details.order.map((i) => files[i]);

  let coverFile: string | null = null;
  if (cover) {
    step = 'cover';
    coverFile = cover.mime === 'image/png' ? 'cover.png' : 'cover.jpg';
    new File(tmpDir, coverFile).write(cover.bytes);
  }

  step = 'book fingerprint';
  return {
    kind: 'audio',
    ebookFile: null,
    tmpDir,
    tracks: ordered.map((f, i) => ({ fileName: f.fileName, title: details.trackTitles[i], durationMs: f.durationMs })),
    chapters: ordered.flatMap((f, trackIdx) =>
      (f.tags.chapters ?? []).map((c) => ({ trackIdx, title: c.title, startMs: c.startMs })),
    ),
    coverFile,
    title: details.title,
    author: details.author,
    // Fingerprinted in playback order, the order the book is stored in.
    fingerprint: await bookFingerprint(
      ordered.map((f) => f.fingerprint),
      sha256,
    ),
    sizeBytes,
  };
}

const sha256 = (data: Uint8Array<ArrayBuffer>) => digest(CryptoDigestAlgorithm.SHA256, data);

/** SHA-256 over the size, first and last 1 MiB (spec §4.7); never the whole file. */
async function fingerprintFile(file: File): Promise<string> {
  const size = file.size;
  const { head, tail } = fingerprintRanges(size);
  const handle = file.open(FileMode.ReadOnly);
  let headBytes: Uint8Array;
  let tailBytes: Uint8Array;
  try {
    handle.offset = head[0];
    headBytes = handle.readBytes(head[1]);
    handle.offset = tail[0];
    tailBytes = handle.readBytes(tail[1]);
  } finally {
    handle.close();
  }
  return fileFingerprint(size, headBytes, tailBytes, sha256);
}

/** Reads an EPUB's details and cover, and refuses DRM-protected or unreadable ones. */
async function analyseEbook(tmpDir: Directory, fileName: string): Promise<Prepared> {
  const file = new File(tmpDir, fileName);
  step = 'epub details';
  let info;
  try {
    info = withFileSource(file, readEpubInfo);
  } catch (error) {
    if (error instanceof NotAnEpubError) throw new ImportFailure('unreadable', error);
    throw error;
  }
  if (info.drm) throw new ImportFailure('drm');

  let coverFile: string | null = null;
  if (info.cover) {
    step = 'cover';
    coverFile = { 'image/png': 'cover.png', 'image/webp': 'cover.webp', 'image/jpeg': 'cover.jpg' }[info.cover.mime];
    new File(tmpDir, coverFile).write(info.cover.bytes);
  }

  step = 'fingerprint';
  return {
    kind: 'ebook',
    tmpDir,
    tracks: [],
    chapters: [],
    ebookFile: fileName,
    coverFile,
    title: info.title ?? '',
    author: info.author,
    fingerprint: await fingerprintFile(file),
    sizeBytes: file.size,
  };
}

/** Loads the file in a silent player to read its duration (also proves it's playable). */
async function probeDuration(uri: string): Promise<number> {
  const player = createAudioPlayer({ uri }, { updateInterval: 100 });
  try {
    return await new Promise<number>((resolve, reject) => {
      let poll: ReturnType<typeof setInterval> | undefined;
      const timer = setTimeout(() => {
        cleanup();
        reject(new ImportFailure('unplayable'));
      }, PROBE_TIMEOUT_MS);
      const check = (status: Pick<AudioStatus, 'isLoaded' | 'duration'>) => {
        if (status.isLoaded && status.duration > 0) {
          cleanup();
          resolve(Math.round(status.duration * 1000));
        }
      };
      const sub = player.addListener('playbackStatusUpdate', check);
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        sub.remove();
      };
      // Status events aren't guaranteed while paused, so also poll.
      poll = setInterval(() => check({ isLoaded: player.isLoaded, duration: player.duration }), 100);
    });
  } finally {
    player.remove();
  }
}

export function updateDetails(title: string, author: string | null): void {
  set((st) => ({ current: st.current && { ...st.current, title, author, edited: true } }));
}

/** Saves the prepared book, then moves on to the next group in the queue. */
export async function saveCurrent(): Promise<string | null> {
  const s = session;
  const current = useImportStore.getState().current;
  if (!s?.prepared || !current) return null;
  const { prepared } = s;
  const title = current.title.trim() || current.group.suggestedTitle;

  set({ status: 'saving' });
  const bookId = randomUUID();
  const finalDir = new Directory(Paths.document, BOOKS_DIR, bookId);
  try {
    step = 'move into library';
    prepared.tmpDir.rename(bookId);
    s.prepared = null;
    step = 'save to database';
    const coverPath = prepared.coverFile ? `${BOOKS_DIR}/${bookId}/${prepared.coverFile}` : null;
    if (prepared.kind === 'ebook' && prepared.ebookFile) {
      await insertEbook(s.db, {
        id: bookId,
        userId: s.userId,
        fingerprint: prepared.fingerprint,
        title,
        author: current.author?.trim() || null,
        sizeBytes: prepared.sizeBytes,
        filePath: `${BOOKS_DIR}/${bookId}/${prepared.ebookFile}`,
        coverPath,
        addedAt: Date.now(),
      });
    } else await insertAudioBook(s.db, {
      id: bookId,
      userId: s.userId,
      fingerprint: prepared.fingerprint,
      title,
      author: current.author?.trim() || null,
      sizeBytes: prepared.sizeBytes,
      coverPath,
      chapters: prepared.chapters,
      addedAt: Date.now(),
      tracks: prepared.tracks.map((t) => ({
        id: randomUUID(),
        filePath: `${BOOKS_DIR}/${bookId}/${t.fileName}`,
        title: t.title,
        durationMs: t.durationMs,
      })),
    });
  } catch (error) {
    if (finalDir.exists) finalDir.delete();
    if (prepared.tmpDir.exists) prepared.tmpDir.delete();
    console.warn('Saving import failed', error);
    set({ status: 'failed', error: 'generic', errorDetail: describe(error) });
    return null;
  }

  const state = useImportStore.getState();
  set({
    savedBookIds: [...state.savedBookIds, bookId],
    lastSavedFileCount: current.group.files.length,
  });
  if (state.index + 1 < state.queue.length) {
    set({ index: state.index + 1 });
    void prepareCurrent();
  } else {
    set({ status: 'done' });
  }
  return bookId;
}

/** Skips a failed group and continues with the rest of the queue. */
export function skipCurrent(): void {
  const state = useImportStore.getState();
  if (state.index + 1 < state.queue.length) {
    set({ index: state.index + 1 });
    void prepareCurrent();
  } else {
    finish();
  }
}

/** Stops any running copy and removes everything not yet saved. */
export function cancelImport(): void {
  if (session) {
    session.cancelled = true;
    if (session.prepared?.tmpDir.exists) session.prepared.tmpDir.delete();
  }
  finish();
}

function finish(): void {
  session = null;
  set(initialImportState);
}

/** Removes temporary folders left behind if the app was killed mid-import. */
export function cleanupStaleImports(): void {
  try {
    const root = new Directory(Paths.document, BOOKS_DIR);
    if (!root.exists) return;
    for (const entry of root.list()) {
      if (entry instanceof Directory && entry.name.startsWith(TMP_PREFIX)) entry.delete();
    }
  } catch (error) {
    console.warn('Could not clean up stale imports', error);
  }
}
