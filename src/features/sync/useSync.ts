import { addNetworkStateListener } from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { Db } from '@/db/types';
import { usePlayerStore } from '@/features/player/store';

import { requestSync, startSync, stopSync } from './service';

/** About once a minute while audio plays (spec §4.7). */
const WHILE_PLAYING_MS = 60_000;

/**
 * Sync triggers for the signed-in account (spec §4.7, plan: "Sync engine"): start and
 * foreground, going to the background, reconnecting, a book loaded or closed, pause, and
 * every minute during playback. Opening a book also syncs (see library/open.ts).
 */
export function useSync(db: Db, userId: string): void {
  useEffect(() => {
    if (!userId) return;
    void startSync(db, userId);

    const appState = AppState.addEventListener('change', () => requestSync(0));

    let connected: boolean | undefined;
    const network = addNetworkStateListener(({ isConnected }) => {
      if (isConnected && connected === false) requestSync(0);
      connected = isConnected;
    });

    // Driven by the player's status updates rather than an interval: those keep arriving with the
    // screen locked, while Android pauses JS timers in the background.
    let lastWhilePlaying = 0;
    const player = usePlayerStore.subscribe((state, prev) => {
      if (state.bookId !== prev.bookId || (prev.playing && !state.playing)) {
        // After the controller's own save on pause / unload.
        requestSync(500);
        return;
      }
      if (!state.playing) return;
      const now = Date.now();
      if (!prev.playing) lastWhilePlaying = now;
      else if (now - lastWhilePlaying >= WHILE_PLAYING_MS) {
        lastWhilePlaying = now;
        requestSync(0);
      }
    });

    return () => {
      appState.remove();
      network.remove();
      player();
      stopSync();
    };
  }, [db, userId]);
}
