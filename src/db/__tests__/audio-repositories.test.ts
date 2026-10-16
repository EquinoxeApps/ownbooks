import { createTestDb } from '../../../test/nodeDb';
import { migrate } from '../migrations';
import {
  applyTags,
  deleteBookRows,
  findByFingerprint,
  getBook,
  insertAudioBook,
  listBooksWithoutTags,
  listLibrary,
  markOpened,
  markTagsRead,
  setFinished,
  updateBookDetails,
} from '../repositories/books';
import { listChapters } from '../repositories/chapters';
import { getProgress, saveAudioPosition } from '../repositories/progress';
import { listTracks } from '../repositories/tracks';
import type { Db } from '../types';

let db: Db & { close(): void };

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
});
afterEach(() => db.close());

const book = {
  id: 'b1',
  userId: 'u1',
  fingerprint: 'f'.repeat(64),
  title: 'Frankenstein',
  author: 'Mary Shelley',
  sizeBytes: 300,
  addedAt: 1000,
  coverPath: 'books/b1/cover.jpg',
  chapters: [
    { trackIdx: 1, title: 'Later', startMs: 500 },
    { trackIdx: 0, title: 'First', startMs: 0 },
  ],
  tracks: [
    { id: 't2', filePath: 'books/b1/02.mp3', title: 'Two', durationMs: 2000 },
    { id: 't1', filePath: 'books/b1/01.mp3', title: 'One', durationMs: 1000 },
  ],
};

describe('insertAudioBook', () => {
  it('stores the book, tracks in order, and an empty progress row', async () => {
    await insertAudioBook(db, book);
    const row = await getBook(db, 'b1');
    expect(row).toMatchObject({
      type: 'audio',
      title: 'Frankenstein',
      cover_path: 'books/b1/cover.jpg',
      duration_ms: 3000,
      on_device: 1,
      dirty: 1,
      tags_read: 1,
    });
    expect((await listChapters(db, 'b1')).map((c) => [c.track_idx, c.title, c.start_ms])).toEqual([
      [0, 'First', 0],
      [1, 'Later', 500],
    ]);
    expect((await listTracks(db, 'b1')).map((t) => [t.idx, t.id])).toEqual([
      [0, 't2'],
      [1, 't1'],
    ]);
    expect(await getProgress(db, 'b1')).toMatchObject({ track_idx: 0, position_ms: 0, fraction: 0, dirty: 0 });
    expect(await findByFingerprint(db, 'u1', 'f'.repeat(64))).not.toBeNull();
  });

  it('rolls back everything when a track insert fails', async () => {
    const broken = { ...book, tracks: [book.tracks[0], { ...book.tracks[1], id: 't2' }] };
    await expect(insertAudioBook(db, broken)).rejects.toThrow();
    expect(await getBook(db, 'b1')).toBeNull();
    expect(await listTracks(db, 'b1')).toEqual([]);
  });
});

describe('progress', () => {
  it('upserts the audio position and marks it dirty', async () => {
    await insertAudioBook(db, book);
    await saveAudioPosition(db, { bookId: 'b1', trackIdx: 1, positionMs: 500.6, fraction: 0.5, speed: 1.25, at: 2000 });
    expect(await getProgress(db, 'b1')).toMatchObject({
      track_idx: 1,
      position_ms: 501,
      fraction: 0.5,
      speed: 1.25,
      updated_at: 2000,
      dirty: 1,
    });
    expect((await listLibrary(db, 'u1'))[0].fraction).toBe(0.5);
  });

  it('records when a book was opened', async () => {
    await insertAudioBook(db, book);
    await markOpened(db, 'b1', 5000);
    expect((await getBook(db, 'b1'))?.last_opened_at).toBe(5000);
  });
});

describe('reading tags of existing books', () => {
  it('lists only untagged audiobooks on this device for the user', async () => {
    await insertAudioBook(db, book);
    await insertAudioBook(db, { ...book, id: 'b2', fingerprint: 'g'.repeat(64), tracks: [], chapters: [] });
    await db.runAsync('UPDATE books SET tags_read = 0 WHERE id = ?', ['b2']);
    expect((await listBooksWithoutTags(db, 'u1')).map((b) => b.id)).toEqual(['b2']);
    expect(await listBooksWithoutTags(db, 'u2')).toEqual([]);
    await markTagsRead(db, 'b2');
    expect(await listBooksWithoutTags(db, 'u1')).toEqual([]);
  });

  it('applies details, cover, track titles and replaces chapters', async () => {
    await insertAudioBook(db, { ...book, coverPath: null });
    await db.runAsync('UPDATE books SET tags_read = 0, dirty = 0 WHERE id = ?', ['b1']);
    await applyTags(db, {
      bookId: 'b1',
      details: { title: 'Real Title', author: 'Real Author' },
      coverPath: 'books/b1/cover.png',
      trackTitles: [{ id: 't1', title: 'Renamed' }],
      chapters: [{ trackIdx: 0, title: 'Only', startMs: 0 }],
      at: 9000,
    });
    expect(await getBook(db, 'b1')).toMatchObject({
      title: 'Real Title',
      author: 'Real Author',
      cover_path: 'books/b1/cover.png',
      tags_read: 1,
      dirty: 1,
      updated_at: 9000,
    });
    expect((await listTracks(db, 'b1')).map((t) => t.title)).toEqual(['Two', 'Renamed']);
    expect((await listChapters(db, 'b1')).map((c) => c.title)).toEqual(['Only']);
  });

  it('keeps the title and sync state when no details are given', async () => {
    await insertAudioBook(db, { ...book, coverPath: null });
    await db.runAsync('UPDATE books SET dirty = 0 WHERE id = ?', ['b1']);
    await applyTags(db, { bookId: 'b1', coverPath: null, trackTitles: [], chapters: [], at: 9000 });
    expect(await getBook(db, 'b1')).toMatchObject({ title: 'Frankenstein', cover_path: null, dirty: 0, updated_at: 1000 });
  });
});

describe('book detail actions', () => {
  it('renames a book and marks it for sync', async () => {
    await insertAudioBook(db, book);
    await db.runAsync('UPDATE books SET dirty = 0', []);
    await updateBookDetails(db, 'b1', { title: 'The Modern Prometheus', author: null }, 5000);
    expect(await getBook(db, 'b1')).toMatchObject({
      title: 'The Modern Prometheus',
      author: null,
      updated_at: 5000,
      dirty: 1,
    });
  });

  it('marks a book finished at the end of its last track, then starts it again', async () => {
    await insertAudioBook(db, book);
    await setFinished(db, 'b1', true, 6000);
    expect(await getBook(db, 'b1')).toMatchObject({ finished_at: 6000, dirty: 1 });
    // Tracks are stored in the given order: t2 (idx 0, 2000 ms), t1 (idx 1, 1000 ms).
    expect(await getProgress(db, 'b1')).toMatchObject({
      track_idx: 1,
      position_ms: 1000,
      fraction: 1,
      finished_at: 6000,
      dirty: 1,
    });

    await setFinished(db, 'b1', false, 7000);
    expect((await getBook(db, 'b1'))?.finished_at).toBeNull();
    expect(await getProgress(db, 'b1')).toMatchObject({
      track_idx: 0,
      position_ms: 0,
      fraction: 0,
      finished_at: null,
      updated_at: 7000,
    });
  });

  it('deletes a book with its tracks, chapters and progress', async () => {
    await insertAudioBook(db, book);
    await deleteBookRows(db, 'b1');
    expect(await getBook(db, 'b1')).toBeNull();
    expect(await listTracks(db, 'b1')).toEqual([]);
    expect(await listChapters(db, 'b1')).toEqual([]);
    expect(await getProgress(db, 'b1')).toBeNull();
  });
});
