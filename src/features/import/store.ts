import { create } from 'zustand';

import type { ImportGroup, Rejected } from './grouping';

export type ImportErrorKey =
  | 'drm'
  | 'unsupported'
  | 'duplicate'
  | 'unplayable'
  | 'noSpace'
  | 'unreadable'
  | 'generic';

export type ImportStatus =
  | 'idle'
  /** Copying files into the app and reading them. */
  | 'preparing'
  /** Copied and analysed; waiting for the user to confirm details. */
  | 'ready'
  | 'saving'
  /** Every group in the queue is saved. */
  | 'done'
  | 'failed';

export type CurrentImport = {
  group: ImportGroup;
  title: string;
  author: string | null;
  /** True once the user has edited title/author, so tags don't overwrite them. */
  edited: boolean;
  /** Cover found in the files' tags (file:// in the temporary import folder). */
  coverUri: string | null;
  bytesTotal: number;
  bytesCopied: number;
  filesCopied: number;
  durationMs: number | null;
};

type ImportState = {
  status: ImportStatus;
  queue: ImportGroup[];
  index: number;
  current: CurrentImport | null;
  rejected: Rejected[];
  error: ImportErrorKey | null;
  /** Technical detail for unexpected failures (step + native error), shown small for bug reports. */
  errorDetail: string | null;
  savedBookIds: string[];
  /** Number of files that went into the most recently saved book. */
  lastSavedFileCount: number;
};

export const initialImportState: ImportState = {
  status: 'idle',
  queue: [],
  index: 0,
  current: null,
  rejected: [],
  error: null,
  errorDetail: null,
  savedBookIds: [],
  lastSavedFileCount: 0,
};

/** UI-facing import state. Mutated only by src/features/import/importer.ts. */
export const useImportStore = create<ImportState>(() => initialImportState);
