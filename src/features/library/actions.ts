import { deleteBookRows, getBook, makePlaceholder, setFinished, updateBookDetails } from '@/db/repositories/books';
import { applyRemoteProgress, getRemoteProgress } from '@/db/repositories/progress';
import { addPendingOp } from '@/db/repositories/sync';
import type { Db } from '@/db/types';
import { refreshDetails, unload } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';
import { requestSync } from '@/features/sync/service';
import { deleteBookFiles } from '@/lib/files';
import { isBackendConfigured } from '@/lib/env';

const isLoaded = (bookId: string) => usePlayerStore.getState().bookId === bookId;

/**
 * Removes a book's files from this phone (spec §4.7: delete is per device). With sync, the book
 * stays in the library as "Not on this device", keeping its place for the other devices and for
 * importing it here again. Files go first, then rows (as in otherAccounts.ts).
 */
export async function deleteBook(db: Db, bookId: string): Promise<void> {
  if (isLoaded(bookId)) await unload();
  deleteBookFiles([bookId]);
  if (!isBackendConfigured) {
    await deleteBookRows(db, bookId);
    return;
  }
  // Nothing here to protect any more, so a newer position from another device simply applies.
  const remote = await getRemoteProgress(db, bookId);
  if (remote) await applyRemoteProgress(db, remote);
  await makePlaceholder(db, bookId);
}

/** "Remove from all devices": gone from this phone now, and from the others when they sync. */
export async function removeEverywhere(db: Db, bookId: string): Promise<void> {
  const book = await getBook(db, bookId);
  if (!book) return;
  // Queued first: if removing it here is interrupted, the tombstone still reaches this phone too.
  await addPendingOp(db, book.user_id, { kind: 'removeEverywhere', fingerprint: book.fingerprint, at: Date.now() });
  if (isLoaded(bookId)) await unload();
  deleteBookFiles([bookId]);
  await deleteBookRows(db, bookId);
  requestSync(0);
}

export async function renameBook(db: Db, bookId: string, title: string, author: string | null): Promise<void> {
  await updateBookDetails(db, bookId, { title, author }, Date.now());
  refreshDetails(bookId, title, author);
  requestSync();
}

/** The player keeps its own position, so a loaded book is unloaded before its progress changes. */
export async function markFinished(db: Db, bookId: string, finished: boolean): Promise<void> {
  if (isLoaded(bookId)) await unload();
  await setFinished(db, bookId, finished, Date.now());
  requestSync();
}
