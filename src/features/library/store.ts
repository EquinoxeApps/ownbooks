import { create } from 'zustand';

import * as kv from '@/db/repositories/kv';
import type { LibrarySort } from '@/db/repositories/books';
import type { Db } from '@/db/types';

export const SORTS: LibrarySort[] = ['recent', 'title', 'author', 'added'];

const isSort = (v: string | null): v is LibrarySort => SORTS.includes(v as LibrarySort);

type LibraryPrefs = {
  sort: LibrarySort;
  /** Reads the remembered sort order for this account. */
  load(db: Db, userId: string): Promise<void>;
  setSort(db: Db, userId: string, sort: LibrarySort): Promise<void>;
};

export const useLibraryPrefs = create<LibraryPrefs>((set) => ({
  sort: 'recent',
  async load(db, userId) {
    const saved = await kv.getString(db, kv.userKey(userId, 'library.sort'));
    set({ sort: isSort(saved) ? saved : 'recent' });
  },
  async setSort(db, userId, sort) {
    set({ sort });
    await kv.setString(db, kv.userKey(userId, 'library.sort'), sort);
  },
}));
