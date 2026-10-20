import { getBook } from '@/db/repositories/books';
import {
  applyRemoteProgress,
  dropRemoteProgress,
  getProgress,
  getRemoteProgress,
  keepLocalProgress,
} from '@/db/repositories/progress';
import { listTracks } from '@/db/repositories/tracks';
import type { BookRow, Db, ProgressRow, RemoteProgressRow } from '@/db/types';
import { unload } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';

import { differsMeaningfully } from './merge';
import { requestSync } from './service';

/** A newer position from another device that's far enough from this one to ask about. */
export type Conflict = { book: BookRow; local: ProgressRow; remote: RemoteProgressRow };

/**
 * Checks a book about to be opened for a held-back position from another device. One that no
 * longer needs a question (older than this device's position by now, or close to it) is
 * settled here without asking.
 */
export async function findConflict(db: Db, bookId: string): Promise<Conflict | null> {
  const remote = await getRemoteProgress(db, bookId);
  if (!remote) return null;
  const [book, local, tracks] = await Promise.all([getBook(db, bookId), getProgress(db, bookId), listTracks(db, bookId)]);
  if (!book) return null;
  if (!local) {
    await applyRemoteProgress(db, remote);
    return null;
  }
  if (remote.updated_at <= local.updated_at) {
    // This device moved on since; its position is the newer one and gets pushed.
    await dropRemoteProgress(db, bookId);
    return null;
  }
  const spans = tracks.map((t) => ({ durationMs: t.duration_ms }));
  if (!differsMeaningfully(book.type, spans, local, remote)) {
    await applyRemoteProgress(db, remote);
    return null;
  }
  return { book, local, remote };
}

/** "Continue from <device>": the other device's position becomes this book's position. */
export async function acceptRemote(db: Db, bookId: string): Promise<void> {
  const remote = await getRemoteProgress(db, bookId);
  if (!remote) return;
  // The player keeps its own position, so a loaded book is unloaded before it changes.
  if (usePlayerStore.getState().bookId === bookId) await unload();
  await applyRemoteProgress(db, remote);
}

/** "Keep this phone's position": it becomes the newest everywhere. */
export async function keepLocal(db: Db, bookId: string): Promise<void> {
  await keepLocalProgress(db, bookId, Date.now());
  requestSync(0);
}
