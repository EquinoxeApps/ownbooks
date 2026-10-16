import type { Db, ProgressRow } from '../types';

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

/** Saves an audio position and marks it for sync. Called often; keep it a single upsert. */
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
       dirty = 1`,
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
       dirty = 1`,
    [p.bookId, p.cfi, p.fraction, p.at],
  );
}
