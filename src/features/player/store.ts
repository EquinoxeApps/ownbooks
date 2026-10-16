import { create } from 'zustand';

import type { Chapter } from './chapters';
import type { SleepTimer } from './sleep';

export type PlayerTrack = { title: string | null; durationMs: number; uri: string };

export type PlayerState = {
  bookId: string | null;
  title: string;
  author: string | null;
  /** Absolute file:// URI of the cover image, if the book has one. */
  coverUri: string | null;
  tracks: PlayerTrack[];
  trackIdx: number;
  chapters: Chapter[];
  chapterIdx: number;
  /** Position within the current track. */
  positionMs: number;
  playing: boolean;
  buffering: boolean;
  loaded: boolean;
  speed: number;
  sleep: SleepTimer | null;
  error: 'missingFile' | 'unplayable' | null;
};

export const emptyPlayerState: PlayerState = {
  bookId: null,
  title: '',
  author: null,
  coverUri: null,
  tracks: [],
  trackIdx: 0,
  chapters: [],
  chapterIdx: 0,
  positionMs: 0,
  playing: false,
  buffering: false,
  loaded: false,
  speed: 1,
  sleep: null,
  error: null,
};

/** UI mirror of the player. Written only by src/features/player/controller.ts. */
export const usePlayerStore = create<PlayerState>(() => emptyPlayerState);
