import { randomUUID } from 'expo-crypto';
import { getNetworkStateAsync } from 'expo-network';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { deleteBookRows } from '@/db/repositories/books';
import * as kv from '@/db/repositories/kv';
import type { Db } from '@/db/types';
import { useAuthStore } from '@/features/auth/store';
import { syncedPositionChanged, unload as unloadPlayer } from '@/features/player/controller';
import { usePlayerStore } from '@/features/player/store';
import { deleteBookFiles } from '@/lib/files';
import { supabase } from '@/lib/supabase';

import { thisDevice } from './device';
import { syncOnce } from './engine';
import { supabaseRemote } from './remote';

/**
 * Runs sync passes for the signed-in account: one at a time, coalescing requests, and retrying
 * failures with backoff. Failures are silent (spec §4.7): they never block playback or reading.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

type SyncState = {
  status: SyncStatus;
  /** When the last pass finished without errors, for this account. */
  lastSyncedAt: number | null;
};

export const useSyncStore = create<SyncState>(() => ({ status: 'idle', lastSyncedAt: null }));
const set = useSyncStore.setState;

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];
/** An open waits for a fresh pull unless the last one finished this recently. */
const FRESH_MS = 15_000;

let db: Db | null = null;
let running: Promise<boolean> | null = null;
let again = false;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const lastSyncedKey = (userId: string) => kv.userKey(userId, 'sync.lastSyncedAt');

/** Called once the database is open and an account is signed in (see SyncBridge). */
export async function startSync(database: Db, userId: string): Promise<void> {
  db = database;
  failures = 0;
  const saved = Number(await kv.getString(database, lastSyncedKey(userId)));
  set({ status: 'idle', lastSyncedAt: saved > 0 ? saved : null });
  requestSync(0);
}

/**
 * Asks for a sync pass soon; bursts of requests become one pass. Android pauses JS timers while
 * the app is in the background, so a request made there (e.g. a pause from the lock screen) runs
 * at once instead of waiting for the app to be reopened.
 */
export function requestSync(delayMs = 1_000): void {
  if (AppState.currentState !== 'active') {
    void runSync();
    return;
  }
  scheduleSync(delayMs);
}

/** Retries always wait on a timer, so failures in the background can't retry in a tight loop. */
function scheduleSync(delayMs: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(), delayMs);
}

/** Runs a pass now (or joins the one running). Resolves true if it succeeded. */
export function runSync(): Promise<boolean> {
  if (running) {
    again = true;
    return running;
  }
  clearTimeout(timer);
  running = attempt().finally(() => {
    running = null;
    if (again) {
      again = false;
      requestSync(0);
    }
  });
  return running;
}

/** Before opening a book: give a pull a moment to bring in another device's newer position. */
export async function syncBeforeOpen(maxWaitMs = 1_500): Promise<void> {
  const { lastSyncedAt } = useSyncStore.getState();
  if (!running && lastSyncedAt && Date.now() - lastSyncedAt < FRESH_MS) return;
  await Promise.race([runSync(), new Promise((resolve) => setTimeout(resolve, maxWaitMs))]);
}

async function attempt(): Promise<boolean> {
  const database = db;
  const account = useAuthStore.getState().account;
  if (!database || !supabase || !account) return false;

  const net = await getNetworkStateAsync().catch(() => null);
  if (net?.isConnected === false) {
    set({ status: 'offline' });
    return false;
  }

  const remote = supabaseRemote(supabase);
  set({ status: 'syncing' });
  try {
    // An expired session that can't be refreshed (e.g. no internet yet) is retried later.
    if ((await remote.sessionUserId()) !== account.id) throw new Error('no session for the signed-in account');
    await syncOnce({
      db: database,
      remote,
      userId: account.id,
      device: await thisDevice(database, account.id),
      newId: randomUUID,
      removeBook: (bookId) => removeBookHere(database, bookId),
      positionApplied: (bookId) => void syncedPositionChanged(bookId),
    });
  } catch (error) {
    if (useAuthStore.getState().account?.id !== account.id) return false;
    const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
    failures += 1;
    set({ status: 'error' });
    scheduleSync(delay);
    console.warn('Sync failed', error);
    return false;
  }
  // Signed out or switched accounts mid-pass: the next account's state isn't ours to set.
  if (useAuthStore.getState().account?.id !== account.id) return false;
  failures = 0;
  const now = Date.now();
  set({ status: 'idle', lastSyncedAt: now });
  await kv.setString(database, lastSyncedKey(account.id), String(now));
  return true;
}

/** Another device removed a book everywhere: files first, then rows (as in library/actions). */
async function removeBookHere(database: Db, bookId: string): Promise<void> {
  if (usePlayerStore.getState().bookId === bookId) await unloadPlayer();
  deleteBookFiles([bookId]);
  await deleteBookRows(database, bookId);
}

/** Stops scheduled passes (sign-out). A pass already running finishes for its own account. */
export function stopSync(): void {
  clearTimeout(timer);
  db = null;
  set({ status: 'idle', lastSyncedAt: null });
}
