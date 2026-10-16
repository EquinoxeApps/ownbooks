import { create } from 'zustand';

import type { ReaderCommand, TocItem } from './bridge';

export type ReaderLocation = { cfi: string; fraction: number; chapter: string | null; href: string | null };

type ReaderState = {
  bookId: string | null;
  toc: TocItem[];
  location: ReaderLocation | null;
  /** Sends a command to the open book's WebView; set by the reader screen while it's mounted. */
  send: ((command: ReaderCommand) => void) | null;
};

export const emptyReaderState: ReaderState = { bookId: null, toc: [], location: null, send: null };

/** UI mirror of the open book, shared with the contents and settings sheets. */
export const useReaderStore = create<ReaderState>(() => emptyReaderState);
