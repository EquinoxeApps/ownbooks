import type { ProgressRow, RemoteProgressRow } from '@/db/types';

import { decideProgress, differsMeaningfully, shiftIso, toIso, toMs } from '../merge';

const tracks = [{ durationMs: 600_000 }, { durationMs: 600_000 }];

const local = (o: Partial<ProgressRow> = {}): ProgressRow => ({
  book_id: 'b',
  track_idx: 0,
  position_ms: 120_000,
  cfi: null,
  fraction: 0.1,
  speed: 1,
  finished_at: null,
  updated_at: 1_000,
  dirty: 0,
  device_id: null,
  device_name: null,
  ...o,
});

const remote = (o: Partial<RemoteProgressRow> = {}): RemoteProgressRow => ({
  book_id: 'b',
  track_idx: 1,
  position_ms: 60_000,
  cfi: null,
  fraction: 0.55,
  speed: 1,
  finished_at: null,
  device_id: 'ipad',
  device_name: 'iPad',
  updated_at: 2_000,
  ...o,
});

const decide = (l: ProgressRow | null, r: RemoteProgressRow, o: { onDevice?: boolean; type?: 'audio' | 'ebook' } = {}) =>
  decideProgress({
    type: o.type ?? 'audio',
    onDevice: o.onDevice ?? true,
    tracks,
    local: l,
    remote: r,
    thisDeviceId: 'phone',
  });

describe('decideProgress', () => {
  it('holds a newer, distant position from another device for the conflict sheet', () => {
    expect(decide(local(), remote())).toBe('hold');
  });

  it('ignores a position that is not newer than this device’s', () => {
    expect(decide(local({ updated_at: 2_000 }), remote())).toBe('ignore');
    expect(decide(local({ updated_at: 3_000 }), remote())).toBe('ignore');
  });

  it('applies when there is nothing here to protect', () => {
    expect(decide(null, remote())).toBe('apply');
    expect(decide(local(), remote(), { onDevice: false })).toBe('apply');
    expect(decide(local({ track_idx: 0, position_ms: 0, fraction: 0 }), remote())).toBe('apply');
  });

  it('applies positions within 30 seconds without asking', () => {
    expect(decide(local(), remote({ track_idx: 0, position_ms: 145_000 }))).toBe('apply');
    expect(decide(local(), remote({ track_idx: 0, position_ms: 151_000 }))).toBe('hold');
  });

  it('applies this device’s own writes and follows a device it already follows', () => {
    expect(decide(local(), remote({ device_id: 'phone' }))).toBe('apply');
    expect(decide(local({ device_id: 'ipad', dirty: 0 }), remote())).toBe('apply');
    // Moved here since it was pulled: that's this phone's position now.
    expect(decide(local({ device_id: 'ipad', dirty: 1 }), remote())).toBe('hold');
  });

  it('compares ebooks by share of the book', () => {
    const e = { type: 'ebook' as const };
    expect(decide(local({ fraction: 0.5, cfi: 'a' }), remote({ fraction: 0.501, cfi: 'b' }), e)).toBe('apply');
    expect(decide(local({ fraction: 0.5, cfi: 'a' }), remote({ fraction: 0.52, cfi: 'b' }), e)).toBe('hold');
  });
});

describe('differsMeaningfully', () => {
  it('measures audio across track boundaries', () => {
    const a = { track_idx: 0, position_ms: 590_000, cfi: null, fraction: 0 };
    const b = { track_idx: 1, position_ms: 10_000, cfi: null, fraction: 0 };
    expect(differsMeaningfully('audio', tracks, a, b)).toBe(false);
    expect(differsMeaningfully('audio', tracks, a, { ...b, position_ms: 30_001 })).toBe(true);
  });
});

describe('timestamps', () => {
  it('reads Postgres timestamps with microseconds', () => {
    expect(toMs('2026-10-20T08:12:03.123456+00:00')).toBe(Date.UTC(2026, 9, 20, 8, 12, 3, 123));
    expect(toMs(null)).toBeNull();
  });

  it('shifts a cursor back for the pull overlap', () => {
    expect(shiftIso('2026-10-20T08:12:03.123456+00:00', -5_000)).toBe(toIso(Date.UTC(2026, 9, 20, 8, 11, 58, 123)));
  });
});
