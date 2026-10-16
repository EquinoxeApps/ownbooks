/** Playback speed range (spec §4.4). expo-audio's own cap is raised to match in our patch. */
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;
export const SPEED_STEP = 0.05;
export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2, 3] as const;

/** Clamps to the range and rounds to the step, avoiding float noise like 1.2500000001. */
export function clampSpeed(speed: number): number {
  const stepped = Math.round(speed / SPEED_STEP) * SPEED_STEP;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, stepped)) * 100) / 100;
}

export function stepSpeed(speed: number, direction: 1 | -1): number {
  return clampSpeed(speed + direction * SPEED_STEP);
}

/** 1 → "1", 1.5 → "1.5", 1.25 → "1.25" (the "×" lives in the translation). */
export function formatSpeed(speed: number): string {
  return String(clampSpeed(speed));
}
