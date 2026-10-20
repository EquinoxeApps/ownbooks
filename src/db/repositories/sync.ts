import type { BookRow, BookType, Db, ProgressRow } from '../types';

/**
 * Local side of sync: what's waiting to be pushed, and how pulled rows land. Rows are
 * marked clean only if they haven't changed since they were read, so a position saved
 * while a push is in flight is pushed again next time.
 */

export async function listDirtyBooks(db: Db, userId: string): Promise<BookRow[]> {
  return db.getAllAsync<BookRow>('SELECT * FROM books WHERE user_id = ? AND dirty = 1', [userId]);
}

export async function markBooksClean(db: Db, rows: readonly { id: string; updated_at: number }[]): Promise<void> {
  for (const r of rows) {
    await db.runAsync('UPDATE books SET dirty = 0 WHERE id = ? AND updated_at = ?', [r.id, r.updated_at]);
  }
}

export type DirtyProgress = ProgressRow & { fingerprint: string };

export async function listDirtyProgress(db: Db, userId: string): Promise<DirtyProgress[]> {
  return db.getAllAsync<DirtyProgress>(
    `SELECT p.*, b.fingerprint AS fingerprint
       FROM progress p JOIN books b ON b.id = p.book_id
      WHERE b.user_id = ? AND p.dirty = 1`,
    [userId],
  );
}

export async function markProgressClean(
  db: Db,
  rows: readonly { book_id: string; updated_at: number }[],
): Promise<void> {
  for (const r of rows) {
    await db.runAsync('UPDATE progress SET dirty = 0 WHERE book_id = ? AND updated_at = ?', [r.book_id, r.updated_at]);
  }
}

/** Queued actions that can't be expressed as a dirty row (the row is already gone locally). */
export type PendingOp = { kind: 'removeEverywhere'; fingerprint: string; at: number };

export async function addPendingOp(db: Db, userId: string, op: PendingOp): Promise<void> {
  await db.runAsync('INSERT INTO pending_ops (user_id, kind, payload, created_at) VALUES (?, ?, ?, ?)', [
    userId,
    op.kind,
    JSON.stringify(op),
    op.at,
  ]);
}

export async function listPendingOps(db: Db, userId: string): Promise<{ id: number; op: PendingOp }[]> {
  const rows = await db.getAllAsync<{ id: number; payload: string }>(
    'SELECT id, payload FROM pending_ops WHERE user_id = ? ORDER BY id',
    [userId],
  );
  const out: { id: number; op: PendingOp }[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, op: JSON.parse(r.payload) as PendingOp });
    } catch {
      // A payload that can't be read would block the queue forever; drop it.
      await deletePendingOp(db, r.id);
    }
  }
  return out;
}

export async function deletePendingOp(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM pending_ops WHERE id = ?', [id]);
}

/** Changes on this device not yet on the server: dirty books, dirty positions, queued removals. */
export async function countUnsynced(db: Db, userId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM books WHERE user_id = ? AND dirty = 1)
          + (SELECT COUNT(*) FROM progress p JOIN books b ON b.id = p.book_id WHERE b.user_id = ? AND p.dirty = 1)
          + (SELECT COUNT(*) FROM pending_ops WHERE user_id = ?) AS n`,
    [userId, userId, userId],
  );
  return row?.n ?? 0;
}

export type Placeholder = {
  id: string;
  userId: string;
  fingerprint: string;
  type: BookType;
  title: string;
  author: string | null;
  durationMs: number | null;
  addedAt: number;
  updatedAt: number;
};

/** A book known only from another device: listed as "Not on this device" until imported here. */
export async function insertPlaceholder(db: Db, p: Placeholder): Promise<void> {
  await db.runAsync(
    `INSERT INTO books (id, user_id, fingerprint, type, title, author, duration_ms, on_device,
                        added_at, updated_at, dirty, tags_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 1)
     ON CONFLICT(user_id, fingerprint) DO NOTHING`,
    [p.id, p.userId, p.fingerprint, p.type, p.title, p.author, p.durationMs, p.addedAt, p.updatedAt],
  );
}

/** Takes a newer title/author from another device, as already synced. */
export async function applyRemoteDetails(
  db: Db,
  bookId: string,
  d: { title: string; author: string | null; durationMs: number | null; updatedAt: number },
): Promise<void> {
  await db.runAsync(
    `UPDATE books SET title = ?, author = ?, duration_ms = COALESCE(duration_ms, ?), updated_at = ?, dirty = 0
      WHERE id = ? AND updated_at < ?`,
    [d.title, d.author, d.durationMs, d.updatedAt, bookId, d.updatedAt],
  );
}
