import { deleteBookRows, setFinished, updateBookDetails } from '@/db/repositories/books';
import type { Db } from '@/db/types';
import { refreshDetails, unload } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';
import { deleteBookFiles } from '@/lib/files';

const isLoaded = (bookId: string) => usePlayerStore.getState().bookId === bookId;

/** Removes a book from this phone: its files first, then its rows (as in otherAccounts.ts). */
export async function deleteBook(db: Db, bookId: string): Promise<void> {
  if (isLoaded(bookId)) await unload();
  deleteBookFiles([bookId]);
  await deleteBookRows(db, bookId);
}

export async function renameBook(db: Db, bookId: string, title: string, author: string | null): Promise<void> {
  await updateBookDetails(db, bookId, { title, author }, Date.now());
  refreshDetails(bookId, title, author);
}

/** The player keeps its own position, so a loaded book is unloaded before its progress changes. */
export async function markFinished(db: Db, bookId: string, finished: boolean): Promise<void> {
  if (isLoaded(bookId)) await unload();
  await setFinished(db, bookId, finished, Date.now());
}
