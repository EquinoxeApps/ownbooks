/** 75_000 → "1:15", 3_725_000 → "1:02:05". Negative values are clamped to 0. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Remaining time with a leading minus sign, as in the player design ("−12:04"). */
export function formatRemaining(ms: number): string {
  return `−${formatClock(ms)}`;
}

/** Coarse duration for lists: "12 min", "3 h 5 min", "< 1 min". */
export function formatDurationShort(ms: number): { hours: number; minutes: number } {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

/**
 * A moment as "today", "yesterday" or a short date, plus the time, for labels such as
 * "Today 08:12" or "12 Oct, 08:12". Callers translate "today" and "yesterday".
 */
export function dayAndTime(at: number, language: string, now = Date.now()): { day: string; time: string } {
  const date = new Date(at);
  const time = date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (at >= startOfToday.getTime()) return { day: 'today', time };
  if (at >= startOfYesterday.getTime()) return { day: 'yesterday', time };
  return { day: date.toLocaleDateString(language, { day: 'numeric', month: 'short' }), time };
}
