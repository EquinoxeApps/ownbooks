/** 460_000_000 → { value: 460, unit: 'MB' }. Decimal units, like the phone's storage settings. */
export function formatSize(bytes: number): { value: number; unit: 'KB' | 'MB' | 'GB' } {
  if (bytes >= 1e9) return { value: Math.round(bytes / 1e8) / 10, unit: 'GB' };
  if (bytes >= 1e6) return { value: Math.round(bytes / 1e6), unit: 'MB' };
  return { value: Math.max(1, Math.round(bytes / 1e3)), unit: 'KB' };
}
