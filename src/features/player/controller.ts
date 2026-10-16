import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { AppState } from 'react-native';

import { getBook, markOpened, setFinished } from '@/db/repositories/books';
import { listChapters } from '@/db/repositories/chapters';
import { getProgress, saveAudioPosition } from '@/db/repositories/progress';
import { listTracks } from '@/db/repositories/tracks';
import type { Db } from '@/db/types';
import { fileUri } from '@/lib/files';

import { buildChapters, chapterAt, nextChapterStart, previousChapterStart } from './chapters';
import { fractionOf, fromGlobal, toGlobal } from './position';
import { retargetSleep, tickSleep, trackEndStops } from './sleep';
import { clampSpeed } from './speed';
import { emptyPlayerState, usePlayerStore, type PlayerTrack } from './store';

/**
 * The single audio player for the app. One AudioPlayer is reused for every
 * track of a book (expo-audio's playlist API has no lock-screen controls, and
 * Android stops background audio after ~3 minutes without them).
 *
 * Position persistence (spec §4.6): written every 5 s while playing, and
 * immediately on pause (including OS pauses such as calls or unplugged
 * headphones), seek, track change, app backgrounding and unload.
 */

const SAVE_EVERY_MS = 5_000;
const UPDATE_INTERVAL_MS = 500;
const LOAD_TIMEOUT_MS = 15_000;

let player: AudioPlayer | null = null;
let statusSub: { remove(): void } | null = null;
let db: Db | null = null;
let lastSavedAt = 0;
let wasPlaying = false;
let switchingTrack = false;
/** When the sleep timer last counted playback time; 0 while paused. */
let lastTickAt = 0;
/** False until the saved position is restored, so early status updates can't overwrite it. */
let restored = false;
let audioModeReady: Promise<void> | null = null;

const get = usePlayerStore.getState;
const set = usePlayerStore.setState;

function ensureAudioMode(): Promise<void> {
  audioModeReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // Required for lock-screen controls; also pauses other apps' audio.
    interruptionMode: 'doNotMix',
  });
  return audioModeReady;
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') void savePosition();
});

/** Loads a book (no-op if it's already loaded) and optionally starts playing. */
export async function loadBook(database: Db, bookId: string, opts: { autoplay?: boolean } = {}) {
  db = database;
  if (get().bookId === bookId && player) {
    if (opts.autoplay) play();
    return;
  }
  await unload();

  const [book, trackRows, chapterRows, progress] = await Promise.all([
    getBook(database, bookId),
    listTracks(database, bookId),
    listChapters(database, bookId),
    getProgress(database, bookId),
  ]);
  if (!book || trackRows.length === 0) return;

  // Stored paths are relative: the documents dir moves between iOS installs.
  const tracks: PlayerTrack[] = trackRows.map((t) => ({
    title: t.title,
    durationMs: t.duration_ms,
    uri: fileUri(t.file_path) ?? '',
  }));
  const chapters = buildChapters(tracks, chapterRows);
  const speed = clampSpeed(progress?.speed ?? 1);
  let trackIdx = Math.min(progress?.track_idx ?? 0, tracks.length - 1);
  let positionMs = progress?.position_ms ?? 0;
  // A finished book reopens at the start rather than at the very end.
  if (fractionOf(tracks, trackIdx, positionMs) >= 0.999) {
    trackIdx = 0;
    positionMs = 0;
  }

  set({
    ...emptyPlayerState,
    bookId,
    title: book.title,
    author: book.author,
    coverUri: fileUri(book.cover_path),
    tracks,
    trackIdx,
    chapters,
    chapterIdx: chapterAt(chapters, toGlobal(tracks, trackIdx, positionMs)),
    positionMs,
    speed,
  });

  if (tracks.some((t) => !t.uri)) {
    set({ error: 'missingFile' });
    return;
  }

  await ensureAudioMode();
  player = createAudioPlayer({ uri: tracks[trackIdx].uri }, { updateInterval: UPDATE_INTERVAL_MS });
  statusSub = player.addListener('playbackStatusUpdate', onStatus);
  player.setPlaybackRate(speed);
  player.setActiveForLockScreen(true, lockScreenMetadata(), { showSeekForward: true, showSeekBackward: true });
  await markOpened(database, bookId, Date.now());

  if (!(await waitUntilLoaded(player))) {
    set({ error: 'unplayable' });
    return;
  }
  if (positionMs > 0) await player.seekTo(positionMs / 1000);
  restored = true;
  set({ loaded: true });
  if (opts.autoplay) play();
}

function waitUntilLoaded(p: AudioPlayer): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (p !== player) return resolve(false);
      if (p.isLoaded) return resolve(true);
      if (Date.now() - started > LOAD_TIMEOUT_MS) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Lock screen / notification. Android shows only title and artist, so those
 * carry the book and the chapter (the author when there are no chapters).
 */
function lockScreenMetadata(): AudioMetadata {
  const { title, author, coverUri, chapters, chapterIdx } = get();
  // A lone chapter is just the file, usually titled like the book itself.
  const chapter = chapters.length > 1 ? chapters[chapterIdx]?.title : null;
  return {
    title,
    artist: chapter ?? author ?? undefined,
    albumTitle: title,
    artworkUrl: coverUri ?? undefined,
  };
}

/** Keeps chapterIdx in step with the position; refreshes the lock screen when it changes. */
function updateChapter(force = false) {
  const { chapters, chapterIdx } = get();
  const idx = chapterAt(chapters, globalPosition());
  if (idx === chapterIdx && !force) return;
  set({ chapterIdx: idx });
  player?.updateLockScreenMetadata(lockScreenMetadata());
}

function onStatus(status: AudioStatus) {
  if (switchingTrack || !restored) return;
  const positionMs = Math.round(status.currentTime * 1000);
  set({ positionMs, playing: status.playing, buffering: status.isBuffering, loaded: status.isLoaded });
  updateChapter();

  if (status.didJustFinish) {
    void advanceTrack();
    return;
  }

  const now = Date.now();
  tickSleepTimer(status.playing, now);
  const paused = wasPlaying && !status.playing;
  wasPlaying = status.playing;
  if (paused || (status.playing && now - lastSavedAt >= SAVE_EVERY_MS)) void savePosition();
}

/** Counts playback time for the sleep timer and stops playback when it runs out. */
function tickSleepTimer(playing: boolean, now: number) {
  const elapsedMs = playing && lastTickAt ? now - lastTickAt : 0;
  lastTickAt = playing ? now : 0;
  const { sleep, chapters } = get();
  if (!sleep || !playing) return;
  const tick = tickSleep(sleep, elapsedMs, globalPosition(), chapters);
  if (tick.action === 'continue') {
    set({ sleep: tick.sleep });
    if (player && player.volume !== tick.volume) player.volume = tick.volume;
    return;
  }
  void stopForSleep(tick.resumeAtGlobalMs);
}

async function stopForSleep(resumeAtGlobalMs: number | null) {
  clearSleep();
  pause();
  // Rest at the next chapter's start, so resuming doesn't replay the overshoot.
  if (resumeAtGlobalMs !== null) await seekToGlobal(resumeAtGlobalMs);
}

function clearSleep() {
  set({ sleep: null });
  lastTickAt = 0;
  if (player) player.volume = 1;
}

/** Sets the sleep timer: a number of minutes, the end of the current chapter, or off. */
export function setSleepTimer(choice: { minutes: number } | 'chapterEnd' | null) {
  clearSleep();
  if (choice === 'chapterEnd') {
    set({ sleep: { kind: 'chapterEnd', chapterIdx: chapterAt(get().chapters, globalPosition()) } });
  } else if (choice) {
    set({ sleep: { kind: 'duration', remainingMs: choice.minutes * 60_000 } });
  }
}

/** Moves to the next file of a multi-file book; at the end of the book, stops there. */
async function advanceTrack() {
  const { tracks, trackIdx, chapters, sleep } = get();
  if (trackIdx + 1 >= tracks.length) {
    const last = tracks[tracks.length - 1];
    clearSleep();
    set({ playing: false, positionMs: last?.durationMs ?? 0 });
    wasPlaying = false;
    await savePosition();
    // Playing to the end counts as finishing the book.
    const { bookId } = get();
    if (db && bookId) await setFinished(db, bookId, true, Date.now());
    return;
  }
  // An end-of-chapter timer whose chapter ends with this file stops at the next file's start.
  const stop = trackEndStops(sleep, chapters, toGlobal(tracks, trackIdx + 1, 0));
  if (stop) {
    clearSleep();
    set({ playing: false });
    wasPlaying = false;
  }
  await switchTrack(trackIdx + 1, 0, !stop);
}

async function switchTrack(index: number, positionMs: number, autoplay: boolean) {
  const p = player;
  const track = get().tracks[index];
  if (!p || !track) return;
  switchingTrack = true;
  try {
    // A file that just ended still has ExoPlayer's playWhenReady set, so the next one would
    // start by itself after replace() unless we pause first (e.g. an end-of-chapter timer).
    if (!autoplay) p.pause();
    p.replace({ uri: track.uri });
    set({ trackIdx: index, positionMs });
    updateChapter(true);
    if (autoplay) p.play();
    if (positionMs > 0) {
      await waitUntilLoaded(p);
      await p.seekTo(positionMs / 1000);
    }
  } finally {
    switchingTrack = false;
  }
  await savePosition();
}

export function play() {
  if (!player) return;
  player.play();
  set({ playing: true });
}

export function pause() {
  if (!player) return;
  player.pause();
  set({ playing: false });
  wasPlaying = false;
  void savePosition();
}

export function togglePlay() {
  if (get().playing) pause();
  else play();
}

/** Seeks to a position across the whole book, switching files if needed. */
export async function seekToGlobal(globalMs: number) {
  const { tracks, trackIdx, playing, sleep, chapters } = get();
  if (!player || tracks.length === 0) return;
  if (sleep?.kind === 'chapterEnd') set({ sleep: retargetSleep(sleep, chapters, globalMs) });
  const target = fromGlobal(tracks, globalMs);
  if (target.trackIdx !== trackIdx) {
    await switchTrack(target.trackIdx, target.positionMs, playing);
    return;
  }
  set({ positionMs: target.positionMs });
  updateChapter();
  await player.seekTo(target.positionMs / 1000);
  await savePosition();
}

export async function skipBy(deltaMs: number) {
  const { tracks, trackIdx, positionMs } = get();
  await seekToGlobal(toGlobal(tracks, trackIdx, positionMs) + deltaMs);
}

/** Like most players: restarts the chapter unless it only just started. */
export async function previousChapter() {
  await seekToGlobal(previousChapterStart(get().chapters, globalPosition()));
}

export async function nextChapter() {
  const start = nextChapterStart(get().chapters, globalPosition());
  if (start !== null) await seekToGlobal(start);
}

/** Jumps to a chapter from the chapter list, keeping play/pause as it was. */
export async function jumpToChapter(index: number) {
  const chapter = get().chapters[index];
  if (chapter) await seekToGlobal(chapter.globalStartMs);
}

/** Shows a renamed book's new details in the player and on the lock screen, if it's loaded. */
export function refreshDetails(bookId: string, title: string, author: string | null) {
  if (get().bookId !== bookId) return;
  set({ title, author });
  player?.updateLockScreenMetadata(lockScreenMetadata());
}

export function setSpeed(rate: number) {
  const speed = clampSpeed(rate);
  player?.setPlaybackRate(speed);
  set({ speed });
  void savePosition();
}

export function globalPosition(): number {
  const { tracks, trackIdx, positionMs } = get();
  return toGlobal(tracks, trackIdx, positionMs);
}

export async function savePosition(): Promise<void> {
  const { bookId, tracks, trackIdx, positionMs, speed, loaded } = get();
  if (!db || !bookId || !loaded) return;
  lastSavedAt = Date.now();
  try {
    await saveAudioPosition(db, {
      bookId,
      trackIdx,
      positionMs,
      fraction: fractionOf(tracks, trackIdx, positionMs),
      speed,
      at: lastSavedAt,
    });
  } catch (error) {
    console.warn('Saving position failed', error);
  }
}

/** Saves the position and releases the player (e.g. on sign-out or switching books). */
export async function unload(): Promise<void> {
  await savePosition();
  statusSub?.remove();
  statusSub = null;
  if (player) {
    // remove() only drops expo-audio's registry entry; release() is what stops and frees the
    // native player. Without it, audio played on until garbage collection (e.g. after delete).
    player.pause();
    player.clearLockScreenControls();
    player.remove();
    player.release();
  }
  player = null;
  wasPlaying = false;
  restored = false;
  lastTickAt = 0;
  set(emptyPlayerState);
}
