import { inTransaction } from '../transaction';
import type { BookRow, BookType, Db } from '../types';
import { insertChapters } from './chapters';

export type LibraryFilter = 'all' | 'audio' | 'ebook';
export type LibrarySort = 'recent' | 'title' | 'author' | 'added';

export type LibraryItem = BookRow & {
  fraction: number | null;
  /** The other device the position was last synced from, if it came from one. */
  last_device: string | null;
};

const ORDER_BY: Record<LibrarySort, string> = {
  // Never-opened books fall back to when they were added.
  recent: 'COALESCE(b.last_opened_at, b.added_at) DESC',
  title: 'b.title COLLATE NOCASE ASC',
  author: "COALESCE(b.author, '') COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC",
  added: 'b.added_at DESC',
};

export async function listLibrary(
  db: Db,
  userId: string,
  filter: LibraryFilter = 'all',
  sort: LibrarySort = 'recent',
): Promise<LibraryItem[]> {
  const where = ['b.user_id = ?'];
  const params: (string | number)[] = [userId];
  if (filter !== 'all') {
    where.push('b.type = ?');
    params.push(filter satisfies BookType);
  }
  return db.getAllAsync<LibraryItem>(
    `SELECT b.*, p.fraction AS fraction, p.device_name AS last_device
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
      WHERE ${where.join(' AND ')}
      ORDER BY ${ORDER_BY[sort]}`,
    params,
  );
}

/** One book as the library shows it (with its progress fraction). */
export async function getLibraryItem(db: Db, bookId: string): Promise<LibraryItem | null> {
  return db.getFirstAsync<LibraryItem>(
    `SELECT b.*, p.fraction AS fraction, p.device_name AS last_device
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
      WHERE b.id = ?`,
    [bookId],
  );
}

export async function countBooks(db: Db, userId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM books WHERE user_id = ?',
    [userId],
  );
  return row?.n ?? 0;
}

/** Books whose files are on this phone, largest first (Storage screen). */
export async function listStorage(db: Db, userId: string): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>(
    `SELECT * FROM books
      WHERE user_id = ? AND on_device = 1
      ORDER BY COALESCE(size_bytes, 0) DESC, title COLLATE NOCASE ASC`,
    [userId],
  );
}

export async function getBook(db: Db, id: string): Promise<BookRow | null> {
  return db.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
}

export async function findByFingerprint(
  db: Db,
  userId: string,
  fingerprint: string,
): Promise<BookRow | null> {
  return db.getFirstAsync<BookRow>('SELECT * FROM books WHERE user_id = ? AND fingerprint = ?', [
    userId,
    fingerprint,
  ]);
}

export async function markOpened(db: Db, bookId: string, at: number): Promise<void> {
  await db.runAsync('UPDATE books SET last_opened_at = ? WHERE id = ?', [at, bookId]);
}

export type NewTrack = { id: string; filePath: string; title: string | null; durationMs: number };

/** A chapter inside a track; start is relative to the track. */
export type NewChapter = { trackIdx: number; title: string | null; startMs: number };

export type NewAudioBook = {
  id: string;
  userId: string;
  fingerprint: string;
  title: string;
  author: string | null;
  sizeBytes: number;
  tracks: NewTrack[];
  /** Relative path (books/<id>/cover.jpg) or null. */
  coverPath: string | null;
  chapters: NewChapter[];
  addedAt: number;
};

type BookRowFields = {
  id: string;
  userId: string;
  fingerprint: string;
  type: BookType;
  title: string;
  author: string | null;
  coverPath: string | null;
  durationMs: number | null;
  sizeBytes: number;
  addedAt: number;
};

/**
 * Inserts a new book row, or turns a placeholder from another device (same id) into this
 * device's copy. A placeholder keeps its synced progress; it's only marked for sync again if
 * the user changed its title or author while importing.
 */
async function saveBookRow(txn: Db, b: BookRowFields): Promise<void> {
  const placeholder = await txn.getFirstAsync<{ title: string; author: string | null }>(
    'SELECT title, author FROM books WHERE id = ? AND on_device = 0',
    [b.id],
  );
  if (placeholder) {
    const renamed = placeholder.title !== b.title || placeholder.author !== b.author;
    await txn.runAsync(
      `UPDATE books SET title = ?, author = ?, cover_path = ?, duration_ms = COALESCE(?, duration_ms),
                        size_bytes = ?, on_device = 1, added_at = ?, tags_read = 1,
                        updated_at = CASE WHEN ? THEN ? ELSE updated_at END,
                        dirty = CASE WHEN ? THEN 1 ELSE dirty END
        WHERE id = ?`,
      [b.title, b.author, b.coverPath, b.durationMs, b.sizeBytes, b.addedAt, renamed, b.addedAt, renamed, b.id],
    );
    return;
  }
  await txn.runAsync(
    `INSERT INTO books (id, user_id, fingerprint, type, title, author, cover_path, duration_ms, size_bytes,
                        on_device, added_at, updated_at, dirty, tags_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 1)`,
    [
      b.id,
      b.userId,
      b.fingerprint,
      b.type,
      b.title,
      b.author,
      b.coverPath,
      b.durationMs,
      b.sizeBytes,
      b.addedAt,
      b.addedAt,
    ],
  );
}

/**
 * Inserts an audiobook with its tracks, chapters and an empty progress row, atomically. With
 * the id of a placeholder from another device, the placeholder adopts the files and keeps its place.
 */
export async function insertAudioBook(db: Db, book: NewAudioBook): Promise<void> {
  const durationMs = book.tracks.reduce((sum, t) => sum + t.durationMs, 0);
  await inTransaction(db, async (txn) => {
    await saveBookRow(txn, { ...book, type: 'audio', durationMs });
    for (const [idx, t] of book.tracks.entries()) {
      await txn.runAsync(
        'INSERT INTO tracks (id, book_id, idx, file_path, title, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, book.id, idx, t.filePath, t.title, t.durationMs],
      );
    }
    await insertChapters(txn, book.id, book.chapters);
    await txn.runAsync(
      `INSERT OR IGNORE INTO progress (book_id, track_idx, position_ms, fraction, updated_at, dirty)
       VALUES (?, 0, 0, 0, ?, 0)`,
      [book.id, book.addedAt],
    );
  });
}

/** Audiobooks on this device whose tags haven't been read yet (imported before tag support). */
export async function listBooksWithoutTags(db: Db, userId: string): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>(
    "SELECT * FROM books WHERE user_id = ? AND type = 'audio' AND on_device = 1 AND tags_read = 0",
    [userId],
  );
}

export type TagUpdate = {
  bookId: string;
  /** New title/author, or undefined to keep the current ones. */
  details?: { title: string; author: string | null };
  coverPath: string | null;
  trackTitles: { id: string; title: string }[];
  chapters: NewChapter[];
  at: number;
};

/** Stores what was read from an existing book's tags and marks it as read, atomically. */
export async function applyTags(db: Db, u: TagUpdate): Promise<void> {
  await inTransaction(db, async (txn) => {
    if (u.details) {
      await txn.runAsync('UPDATE books SET title = ?, author = ?, updated_at = ?, dirty = 1 WHERE id = ?', [
        u.details.title,
        u.details.author,
        u.at,
        u.bookId,
      ]);
    }
    await txn.runAsync('UPDATE books SET cover_path = COALESCE(?, cover_path), tags_read = 1 WHERE id = ?', [
      u.coverPath,
      u.bookId,
    ]);
    for (const t of u.trackTitles) {
      await txn.runAsync('UPDATE tracks SET title = ? WHERE id = ? AND book_id = ?', [t.title, t.id, u.bookId]);
    }
    await txn.runAsync('DELETE FROM chapters WHERE book_id = ?', [u.bookId]);
    await insertChapters(txn, u.bookId, u.chapters);
  });
}

/** Marks a book's tags as read without changing anything (e.g. its files had none). */
export async function markTagsRead(db: Db, bookId: string): Promise<void> {
  await db.runAsync('UPDATE books SET tags_read = 1 WHERE id = ?', [bookId]);
}

/** Renames a book (title and author) and marks it for sync. */
export async function updateBookDetails(
  db: Db,
  bookId: string,
  details: { title: string; author: string | null },
  at: number,
): Promise<void> {
  await db.runAsync('UPDATE books SET title = ?, author = ?, updated_at = ?, dirty = 1 WHERE id = ?', [
    details.title,
    details.author,
    at,
    bookId,
  ]);
}

/**
 * Marks a book finished (position at the very end, so reopening starts it
 * again) or not started (position back at the beginning).
 */
export async function setFinished(db: Db, bookId: string, finished: boolean, at: number): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync('UPDATE books SET finished_at = ?, updated_at = ?, dirty = 1 WHERE id = ?', [
      finished ? at : null,
      at,
      bookId,
    ]);
    if (finished) {
      // Audiobooks rest at the end of their last track; ebooks keep their CFI.
      const last = await txn.getFirstAsync<{ idx: number; duration_ms: number }>(
        'SELECT idx, duration_ms FROM tracks WHERE book_id = ? ORDER BY idx DESC LIMIT 1',
        [bookId],
      );
      await txn.runAsync(
        `INSERT INTO progress (book_id, track_idx, position_ms, fraction, finished_at, updated_at, dirty)
         VALUES (?, ?, ?, 1, ?, ?, 1)
         ON CONFLICT(book_id) DO UPDATE SET
           track_idx = excluded.track_idx, position_ms = excluded.position_ms, fraction = 1,
           finished_at = excluded.finished_at, updated_at = excluded.updated_at, dirty = 1,
           device_id = NULL, device_name = NULL`,
        [bookId, last?.idx ?? null, last?.duration_ms ?? null, at, at],
      );
    } else {
      await txn.runAsync(
        `INSERT INTO progress (book_id, track_idx, position_ms, cfi, fraction, finished_at, updated_at, dirty)
         VALUES (?, 0, 0, NULL, 0, NULL, ?, 1)
         ON CONFLICT(book_id) DO UPDATE SET
           track_idx = 0, position_ms = 0, cfi = NULL, fraction = 0, finished_at = NULL,
           updated_at = excluded.updated_at, dirty = 1, device_id = NULL, device_name = NULL`,
        [bookId, at],
      );
    }
  });
}

/** Deletes a book's rows; tracks, chapters and progress cascade. Delete its files first. */
export async function deleteBookRows(db: Db, bookId: string): Promise<void> {
  await db.runAsync('DELETE FROM books WHERE id = ?', [bookId]);
}

export type NewEbook = {
  id: string;
  userId: string;
  fingerprint: string;
  title: string;
  author: string | null;
  sizeBytes: number;
  /** Relative path (books/<id>/book.epub). */
  filePath: string;
  coverPath: string | null;
  addedAt: number;
};

/** Inserts an ebook with its file and an empty progress row, atomically (or adopts a placeholder). */
export async function insertEbook(db: Db, book: NewEbook): Promise<void> {
  await inTransaction(db, async (txn) => {
    await saveBookRow(txn, { ...book, type: 'ebook', durationMs: null });
    await txn.runAsync('INSERT INTO ebook_files (book_id, file_path) VALUES (?, ?)', [book.id, book.filePath]);
    await txn.runAsync(
      'INSERT OR IGNORE INTO progress (book_id, fraction, updated_at, dirty) VALUES (?, 0, ?, 0)',
      [book.id, book.addedAt],
    );
  });
}

/**
 * Turns a book into a placeholder ("Not on this device"): its files are gone from this phone but
 * it stays in the synced library with its place. Delete its files first.
 */
export async function makePlaceholder(db: Db, bookId: string): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM tracks WHERE book_id = ?', [bookId]);
    await txn.runAsync('DELETE FROM chapters WHERE book_id = ?', [bookId]);
    await txn.runAsync('DELETE FROM ebook_files WHERE book_id = ?', [bookId]);
    await txn.runAsync(
      'UPDATE books SET on_device = 0, cover_path = NULL, size_bytes = NULL, last_opened_at = NULL WHERE id = ?',
      [bookId],
    );
  });
}

/** Relative path of an ebook's EPUB file. */
export async function getEbookFilePath(db: Db, bookId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ file_path: string }>('SELECT file_path FROM ebook_files WHERE book_id = ?', [
    bookId,
  ]);
  return row?.file_path ?? null;
}
