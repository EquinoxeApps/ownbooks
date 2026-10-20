import { inTransaction } from '../transaction';
import type { Db, ProgressRow, RemoteProgressRow } from '../types';

export async function getProgress(db: Db, bookId: string): Promise<ProgressRow | null> {
  return db.getFirstAsync<ProgressRow>('SELECT * FROM progress WHERE book_id = ?', [bookId]);
}

export type AudioPosition = {
  bookId: string;
  trackIdx: number;
  positionMs: number;
  fraction: number;
  speed: number;
  at: number;
};

/**
 * Saves an audio position and marks it for sync. Called often; keep it a single upsert.
 * A position written here is this device's own, so any device it was pulled from is cleared.
 */
export async function saveAudioPosition(db: Db, p: AudioPosition): Promise<void> {
  await db.runAsync(
    `INSERT INTO progress (book_id, track_idx, position_ms, fraction, speed, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(book_id) DO UPDATE SET
       track_idx = excluded.track_idx,
       position_ms = excluded.position_ms,
       fraction = excluded.fraction,
       speed = excluded.speed,
       updated_at = excluded.updated_at,
       dirty = 1, device_id = NULL, device_name = NULL`,
    [p.bookId, p.trackIdx, Math.round(p.positionMs), p.fraction, p.speed, p.at],
  );
}

export type EbookPosition = { bookId: string; cfi: string; fraction: number; at: number };

/** Saves an ebook position (an EPUB CFI, never a page number) and marks it for sync. */
export async function saveEbookPosition(db: Db, p: EbookPosition): Promise<void> {
  await db.runAsync(
    `INSERT INTO progress (book_id, cfi, fraction, updated_at, dirty)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(book_id) DO UPDATE SET
       cfi = excluded.cfi,
       fraction = excluded.fraction,
       updated_at = excluded.updated_at,
       dirty = 1, device_id = NULL, device_name = NULL`,
    [p.bookId, p.cfi, p.fraction, p.at],
  );
}

/** A newer position from another device that the user hasn't accepted or dismissed yet. */
export async function getRemoteProgress(db: Db, bookId: string): Promise<RemoteProgressRow | null> {
  return db.getFirstAsync<RemoteProgressRow>('SELECT * FROM remote_progress WHERE book_id = ?', [bookId]);
}

/** Holds back a newer position from another device until the user picks one (replaces an older one). */
export async function holdRemoteProgress(db: Db, p: RemoteProgressRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO remote_progress (book_id, track_idx, position_ms, cfi, fraction, speed, finished_at,
                                  device_id, device_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET
       track_idx = excluded.track_idx, position_ms = excluded.position_ms, cfi = excluded.cfi,
       fraction = excluded.fraction, speed = excluded.speed, finished_at = excluded.finished_at,
       device_id = excluded.device_id, device_name = excluded.device_name, updated_at = excluded.updated_at
     WHERE excluded.updated_at > remote_progress.updated_at`,
    [
      p.book_id,
      p.track_idx,
      p.position_ms,
      p.cfi,
      p.fraction,
      p.speed,
      p.finished_at,
      p.device_id,
      p.device_name,
      p.updated_at,
    ],
  );
}

/**
 * Makes a position from another device the book's position, as already synced (not dirty).
 * The book's finished state follows it, and any held-back position is dropped.
 */
export async function applyRemoteProgress(db: Db, p: RemoteProgressRow): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO progress (book_id, track_idx, position_ms, cfi, fraction, speed, finished_at,
                             updated_at, dirty, device_id, device_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         track_idx = excluded.track_idx, position_ms = excluded.position_ms, cfi = excluded.cfi,
         fraction = excluded.fraction, speed = COALESCE(excluded.speed, progress.speed),
         finished_at = excluded.finished_at, updated_at = excluded.updated_at, dirty = 0,
         device_id = excluded.device_id, device_name = excluded.device_name`,
      [
        p.book_id,
        p.track_idx,
        p.position_ms,
        p.cfi,
        p.fraction,
        p.speed,
        p.finished_at,
        p.updated_at,
        p.device_id,
        p.device_name,
      ],
    );
    await txn.runAsync('UPDATE books SET finished_at = ? WHERE id = ?', [p.finished_at, p.book_id]);
    await txn.runAsync('DELETE FROM remote_progress WHERE book_id = ?', [p.book_id]);
  });
}

/**
 * The user kept this device's position over another device's newer one. The local position is
 * re-stamped so it wins on the server, and the other device's position is dropped.
 */
export async function keepLocalProgress(db: Db, bookId: string, at: number): Promise<void> {
  await inTransaction(db, async (txn) => {
    await txn.runAsync(
      'UPDATE progress SET updated_at = ?, dirty = 1, device_id = NULL, device_name = NULL WHERE book_id = ?',
      [at, bookId],
    );
    await txn.runAsync('DELETE FROM remote_progress WHERE book_id = ?', [bookId]);
  });
}

/** Drops a held-back position that this device's own position has since overtaken. */
export async function dropRemoteProgress(db: Db, bookId: string): Promise<void> {
  await db.runAsync('DELETE FROM remote_progress WHERE book_id = ?', [bookId]);
}
