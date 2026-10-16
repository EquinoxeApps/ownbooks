import { inTransaction } from '../transaction';
import type { BookRow, BookType, Db } from '../types';
import { insertChapters } from './chapters';

export type LibraryFilter = 'all' | 'audio' | 'ebook';
export type LibrarySort = 'recent' | 'title' | 'author' | 'added';

export type LibraryItem = BookRow & { fraction: number | null };

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
    `SELECT b.*, p.fraction AS fraction
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
    `SELECT b.*, p.fraction AS fraction
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

/** Inserts an audiobook with its tracks, chapters and an empty progress row, atomically. */
export async function insertAudioBook(db: Db, book: NewAudioBook): Promise<void> {
  const durationMs = book.tracks.reduce((sum, t) => sum + t.durationMs, 0);
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO books (id, user_id, fingerprint, type, title, author, cover_path, duration_ms, size_bytes,
                          on_device, added_at, updated_at, dirty, tags_read)
       VALUES (?, ?, ?, 'audio', ?, ?, ?, ?, ?, 1, ?, ?, 1, 1)`,
      [
        book.id,
        book.userId,
        book.fingerprint,
        book.title,
        book.author,
        book.coverPath,
        durationMs,
        book.sizeBytes,
        book.addedAt,
        book.addedAt,
      ],
    );
    for (const [idx, t] of book.tracks.entries()) {
      await txn.runAsync(
        'INSERT INTO tracks (id, book_id, idx, file_path, title, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, book.id, idx, t.filePath, t.title, t.durationMs],
      );
    }
    await insertChapters(txn, book.id, book.chapters);
    await txn.runAsync(
      `INSERT INTO progress (book_id, track_idx, position_ms, fraction, updated_at, dirty)
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
           finished_at = excluded.finished_at, updated_at = excluded.updated_at, dirty = 1`,
        [bookId, last?.idx ?? null, last?.duration_ms ?? null, at, at],
      );
    } else {
      await txn.runAsync(
        `INSERT INTO progress (book_id, track_idx, position_ms, cfi, fraction, finished_at, updated_at, dirty)
         VALUES (?, 0, 0, NULL, 0, NULL, ?, 1)
         ON CONFLICT(book_id) DO UPDATE SET
           track_idx = 0, position_ms = 0, cfi = NULL, fraction = 0, finished_at = NULL,
           updated_at = excluded.updated_at, dirty = 1`,
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

/** Inserts an ebook with its file and an empty progress row, atomically. */
export async function insertEbook(db: Db, book: NewEbook): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO books (id, user_id, fingerprint, type, title, author, cover_path, size_bytes,
                          on_device, added_at, updated_at, dirty, tags_read)
       VALUES (?, ?, ?, 'ebook', ?, ?, ?, ?, 1, ?, ?, 1, 1)`,
      [book.id, book.userId, book.fingerprint, book.title, book.author, book.coverPath, book.sizeBytes, book.addedAt, book.addedAt],
    );
    await txn.runAsync('INSERT INTO ebook_files (book_id, file_path) VALUES (?, ?)', [book.id, book.filePath]);
    await txn.runAsync(
      'INSERT INTO progress (book_id, fraction, updated_at, dirty) VALUES (?, 0, ?, 0)',
      [book.id, book.addedAt],
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
