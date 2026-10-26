import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { Db } from '@/db/types';
import { useAuthStore } from '@/features/auth/store';
import { usePlayerStore } from '@/features/player/store';

import { setUserProperty, startAnalytics, stopAnalytics, track } from './analytics';
import { durationBucket } from './events';

/** A pause shorter than this (e.g. the gap between two files of a book) doesn't end a session. */
const SESSION_GAP_MS = 5_000;

/**
 * Analytics for the signed-in account: loads its consent choice, sets the onboarding property,
 * and turns the player's play / pause changes into listening sessions.
 */
export function useAnalytics(db: Db, userId: string): void {
  const choice = useAuthStore((s) => s.onboardingChoice);

  useEffect(() => {
    if (!userId) return;
    void startAnalytics(db, userId);
    return () => void stopAnalytics();
  }, [db, userId]);

  useEffect(() => {
    if (choice) setUserProperty('bring_first', choice);
  }, [choice]);

  useEffect(() => {
    if (!userId) return;
    const sessions = listeningSessions();
    const player = usePlayerStore.subscribe((state, prev) => {
      if (state.bookId !== prev.bookId) sessions.end();
      if (state.playing && !prev.playing && state.bookId) sessions.play(state.bookId);
      else if (!state.playing && prev.playing) sessions.pause();
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next !== 'active') sessions.flush();
    });
    return () => {
      player();
      appState.remove();
      sessions.end();
    };
  }, [userId]);
}

/**
 * One session runs from play to pause. A pause is only final once it has lasted SESSION_GAP_MS,
 * the book changes or the app leaves the foreground; resuming sooner continues the session.
 */
export function listeningSessions(now: () => number = Date.now) {
  let bookId: string | null = null;
  let playedMs = 0;
  let playingSince: number | null = null;
  let pausedAt: number | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;

  const clearGap = () => {
    if (gapTimer) clearTimeout(gapTimer);
    gapTimer = null;
  };

  const end = () => {
    clearGap();
    if (playingSince !== null) playedMs += now() - playingSince;
    if (bookId && playedMs > 0) track('playback_session', { duration: durationBucket(playedMs) });
    bookId = null;
    playedMs = 0;
    playingSince = null;
    pausedAt = null;
  };

  return {
    play(id: string) {
      clearGap();
      const resumed = bookId === id && pausedAt !== null && now() - pausedAt < SESSION_GAP_MS;
      if (!resumed) {
        end();
        bookId = id;
        track('playback_started');
      }
      pausedAt = null;
      playingSince = now();
    },
    pause() {
      if (playingSince === null) return;
      playedMs += now() - playingSince;
      playingSince = null;
      pausedAt = now();
      clearGap();
      gapTimer = setTimeout(end, SESSION_GAP_MS);
    },
    /** Ends a paused session now (Android pauses JS timers in the background). */
    flush() {
      if (playingSince === null) end();
    },
    end,
  };
}
