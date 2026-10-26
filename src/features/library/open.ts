import { router } from 'expo-router';

import type { BookType, Db } from '@/db/types';
import { loadBook, play } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';
import { findConflict } from '@/features/sync/conflict';
import { syncBeforeOpen } from '@/features/sync/service';

type Openable = { id: string; type: BookType; on_device: number };

/**
 * Opens a book from anywhere in the app. A book that's only on another device opens its
 * details (which explain how to import it here). Otherwise a quick sync runs first, so a newer
 * position from another device can be offered (the conflict sheet) before the book opens.
 */
export async function openBook(db: Db, book: Openable, opts: { autoplay?: boolean } = {}): Promise<void> {
  if (!book.on_device) {
    router.push({ pathname: '/book/[id]', params: { id: book.id } });
    return;
  }
  // Taps during the short wait below would otherwise open the book twice.
  if (opening) return;
  opening = true;
  try {
    if (await newerElsewhere(db, book.id)) {
      router.push({ pathname: '/conflict', params: { id: book.id, autoplay: opts.autoplay ? '1' : '0' } });
      return;
    }
    goToBook(db, book, opts);
  } finally {
    opening = false;
  }
}

let opening = false;

/** Whether to offer another device's newer position. A failed check never stops the book opening. */
async function newerElsewhere(db: Db, bookId: string): Promise<boolean> {
  try {
    await syncBeforeOpen();
    return Boolean(await findConflict(db, bookId));
  } catch (error) {
    console.warn('Checking for a newer position failed', error);
    return false;
  }
}

/**
 * Play on a loaded, paused book (the mini-player): like opening it, a newer position from
 * another device is offered first, so resuming here can't overwrite it unasked.
 */
export async function resumeBook(db: Db, bookId: string): Promise<void> {
  if (opening) return;
  opening = true;
  try {
    if (await newerElsewhere(db, bookId)) {
      router.push({ pathname: '/conflict', params: { id: bookId, autoplay: '1' } });
      return;
    }
    play();
  } finally {
    opening = false;
  }
}

/** Shows the reader or the player for a book, without any checks. */
export function goToBook(db: Db, book: Openable, opts: { autoplay?: boolean; replace?: boolean } = {}): void {
  const navigate = opts.replace ? router.replace : router.push;
  if (book.type === 'ebook') {
    navigate({ pathname: '/reader/[id]', params: { id: book.id } });
    return;
  }
  navigate('/player');
  loadBook(db, book.id, { autoplay: opts.autoplay }).catch((error: unknown) => {
    console.warn('Loading the book failed', error);
    usePlayerStore.setState({ error: 'unplayable' });
  });
}
