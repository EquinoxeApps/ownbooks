import { chapterAt, type Chapter } from './chapters';

/**
 * Sleep timer state. A duration counts down only while audio plays, so pausing
 * doesn't eat into it. "End of chapter" stops when playback runs past the
 * chapter it was set on (or the chapter a later seek landed in).
 */
export type SleepTimer =
  | { kind: 'duration'; remainingMs: number }
  | { kind: 'chapterEnd'; chapterIdx: number };

export const SLEEP_MINUTES = [5, 15, 30, 45, 60] as const;

/** The volume fades over this last stretch of a duration timer. */
export const FADE_MS = 10_000;

export type SleepTick =
  | { action: 'continue'; sleep: SleepTimer; volume: number }
  | { action: 'stop'; resumeAtGlobalMs: number | null };

/**
 * Advances the timer after `elapsedMs` of playback that reached `globalMs`.
 * On "stop", `resumeAtGlobalMs` is where the book should rest (the start of the
 * next chapter for an end-of-chapter timer), or null to stay where it is.
 */
export function tickSleep(
  sleep: SleepTimer,
  elapsedMs: number,
  globalMs: number,
  chapters: readonly Chapter[],
): SleepTick {
  if (sleep.kind === 'duration') {
    const remainingMs = sleep.remainingMs - Math.max(0, elapsedMs);
    if (remainingMs <= 0) return { action: 'stop', resumeAtGlobalMs: null };
    return { action: 'continue', sleep: { kind: 'duration', remainingMs }, volume: fadeVolume(remainingMs) };
  }
  if (chapterAt(chapters, globalMs) > sleep.chapterIdx) {
    return { action: 'stop', resumeAtGlobalMs: chapters[sleep.chapterIdx + 1]?.globalStartMs ?? null };
  }
  return { action: 'continue', sleep, volume: 1 };
}

export function fadeVolume(remainingMs: number): number {
  return Math.min(1, Math.max(0, remainingMs / FADE_MS));
}

/** A seek moves an end-of-chapter timer to the chapter it landed in. */
export function retargetSleep(sleep: SleepTimer | null, chapters: readonly Chapter[], globalMs: number) {
  if (sleep?.kind !== 'chapterEnd') return sleep;
  return { kind: 'chapterEnd', chapterIdx: chapterAt(chapters, globalMs) } satisfies SleepTimer;
}

/** True when a track ending also ends the chapter an end-of-chapter timer waits for. */
export function trackEndStops(
  sleep: SleepTimer | null,
  chapters: readonly Chapter[],
  trackEndGlobalMs: number,
): boolean {
  return sleep?.kind === 'chapterEnd' && chapterAt(chapters, trackEndGlobalMs - 1) >= sleep.chapterIdx;
}
