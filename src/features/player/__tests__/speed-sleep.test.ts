import { buildChapters } from '../chapters';
import { fadeVolume, retargetSleep, tickSleep, trackEndStops, type SleepTimer } from '../sleep';
import { clampSpeed, formatSpeed, MAX_SPEED, MIN_SPEED, stepSpeed } from '../speed';

describe('speed', () => {
  it('clamps to 0.5–3.0 and rounds to the 0.05 step', () => {
    expect(clampSpeed(0.1)).toBe(MIN_SPEED);
    expect(clampSpeed(9)).toBe(MAX_SPEED);
    expect(clampSpeed(1.2500000001)).toBe(1.25);
    expect(clampSpeed(1.27)).toBe(1.25);
    expect(clampSpeed(1.28)).toBe(1.3);
  });

  it('steps without float noise and stops at the ends', () => {
    expect(stepSpeed(1, 1)).toBe(1.05);
    expect(stepSpeed(1.1, -1)).toBe(1.05);
    expect(stepSpeed(MAX_SPEED, 1)).toBe(MAX_SPEED);
    expect(stepSpeed(MIN_SPEED, -1)).toBe(MIN_SPEED);
  });

  it('formats without trailing zeros', () => {
    expect(formatSpeed(1)).toBe('1');
    expect(formatSpeed(1.5)).toBe('1.5');
    expect(formatSpeed(1.25)).toBe('1.25');
  });
});

describe('sleep timer', () => {
  // Three 10-second chapters across two files: [0–10 s, 10–20 s] in file 1, [20–30 s] in file 2.
  const chapters = buildChapters(
    [
      { title: 'File 1', durationMs: 20_000 },
      { title: 'File 2', durationMs: 10_000 },
    ],
    [
      { track_idx: 0, title: 'One', start_ms: 0 },
      { track_idx: 0, title: 'Two', start_ms: 10_000 },
    ],
  );

  it('counts a duration down and stops at zero', () => {
    const sleep: SleepTimer = { kind: 'duration', remainingMs: 60_000 };
    expect(tickSleep(sleep, 500, 0, chapters)).toEqual({
      action: 'continue',
      sleep: { kind: 'duration', remainingMs: 59_500 },
      volume: 1,
    });
    expect(tickSleep({ kind: 'duration', remainingMs: 400 }, 500, 0, chapters)).toEqual({
      action: 'stop',
      resumeAtGlobalMs: null,
    });
  });

  it('fades the volume over the last 10 seconds', () => {
    expect(fadeVolume(20_000)).toBe(1);
    expect(fadeVolume(5_000)).toBe(0.5);
    expect(fadeVolume(0)).toBe(0);
    const tick = tickSleep({ kind: 'duration', remainingMs: 5_500 }, 500, 0, chapters);
    expect(tick).toMatchObject({ action: 'continue', volume: 0.5 });
  });

  it('stops after the chapter ends and rests at the next chapter start', () => {
    const sleep: SleepTimer = { kind: 'chapterEnd', chapterIdx: 0 };
    expect(tickSleep(sleep, 500, 9_900, chapters)).toMatchObject({ action: 'continue' });
    expect(tickSleep(sleep, 500, 10_300, chapters)).toEqual({ action: 'stop', resumeAtGlobalMs: 10_000 });
  });

  it('moves an end-of-chapter timer to the chapter a seek lands in', () => {
    const sleep: SleepTimer = { kind: 'chapterEnd', chapterIdx: 0 };
    expect(retargetSleep(sleep, chapters, 25_000)).toEqual({ kind: 'chapterEnd', chapterIdx: 2 });
    const duration: SleepTimer = { kind: 'duration', remainingMs: 1000 };
    expect(retargetSleep(duration, chapters, 25_000)).toBe(duration);
  });

  it('stops at a file boundary only when that file ends the target chapter', () => {
    // File 1 ends at 20 s, which is the end of chapter 1 ("Two").
    expect(trackEndStops({ kind: 'chapterEnd', chapterIdx: 1 }, chapters, 20_000)).toBe(true);
    expect(trackEndStops({ kind: 'chapterEnd', chapterIdx: 2 }, chapters, 20_000)).toBe(false);
    expect(trackEndStops({ kind: 'duration', remainingMs: 5 }, chapters, 20_000)).toBe(false);
    expect(trackEndStops(null, chapters, 20_000)).toBe(false);
  });
});
