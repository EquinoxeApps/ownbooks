import { createTestDb } from '../../../../test/nodeDb';
import { migrate } from '@/db/migrations';
import type { Db } from '@/db/types';

import {
  __setBackendForTests,
  setAnalyticsConsent,
  setUserProperty,
  startAnalytics,
  stopAnalytics,
  track,
  useAnalyticsStore,
} from '../analytics';
import { durationBucket, EVENTS, formatOf, sanitize, sizeBucket } from '../events';
import type { AnalyticsBackend } from '../native';
import { listeningSessions } from '../useAnalytics';

function fakeBackend() {
  const calls: string[] = [];
  const events: { name: string; params: Record<string, string | number> }[] = [];
  const backend: AnalyticsBackend = {
    async setEnabled(enabled) {
      calls.push(`enabled:${enabled}`);
    },
    async reset() {
      calls.push('reset');
    },
    async logEvent(name, params) {
      events.push({ name, params });
    },
    async setUserProperty(name, value) {
      calls.push(`property:${name}=${value}`);
    },
  };
  return { backend, calls, events };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sanitize', () => {
  it('passes allowed parameters through', () => {
    expect(
      sanitize('import_completed', { type: 'audio', format: 'm4b', size: '100_500mb', track_count: 1 }),
    ).toEqual({ type: 'audio', format: 'm4b', size: '100_500mb', track_count: 1 });
    expect(sanitize('playback_started')).toEqual({});
  });

  it('drops events carrying book data or anything unknown', () => {
    // Book data under a known event.
    expect(sanitize('import_completed', { type: 'audio', title: 'Frankenstein' })).toBeNull();
    expect(sanitize('book_finished', { type: 'audio', author: 'Mary Shelley' })).toBeNull();
    expect(sanitize('import_failed', { reason: 'drm', filename: 'book.epub' })).toBeNull();
    expect(sanitize('import_completed', { fingerprint: 'ab12' })).toBeNull();
    // Free text where a fixed value is expected.
    expect(sanitize('import_failed', { reason: 'Frankenstein.epub is damaged' })).toBeNull();
    expect(sanitize('login', { method: 'google ' })).toBeNull();
    // Numbers must be small whole numbers; strings are never numbers.
    expect(sanitize('import_started', { type: 'audio', file_count: 2.5 })).toBeNull();
    expect(sanitize('import_started', { type: 'audio', file_count: '3' })).toBeNull();
    expect(sanitize('import_started', { type: 'audio', file_count: 1e9 })).toBeNull();
    // Unknown events, including inherited object keys.
    expect(sanitize('screen_view', {})).toBeNull();
    expect(sanitize('toString', {})).toBeNull();
    expect(sanitize('login', { constructor: 'apple' })).toBeNull();
  });

  it('only allows fixed lists or bounded counts in every event', () => {
    for (const schema of Object.values(EVENTS)) {
      for (const allowed of Object.values(schema)) {
        if (Array.isArray(allowed)) expect(allowed.every((v) => /^[a-z0-9_]+$/.test(v))).toBe(true);
        else expect(allowed).toEqual({ max: expect.any(Number) });
      }
    }
  });

  it('buckets sizes, durations and formats', () => {
    expect(sizeBucket(5e6)).toBe('under_10mb');
    expect(sizeBucket(460e6)).toBe('100_500mb');
    expect(sizeBucket(2e9)).toBe('over_1gb');
    expect(durationBucket(30_000)).toBe('under_1m');
    expect(durationBucket(20 * 60_000)).toBe('15_30m');
    expect(durationBucket(3 * 3_600_000)).toBe('over_60m');
    expect(formatOf(['MP3', 'mp3'])).toBe('mp3');
    expect(formatOf(['mp3', 'm4a'])).toBe('mixed');
    expect(formatOf(['flac'])).toBe('mixed');
  });
});

describe('consent', () => {
  let db: Db & { close(): void };
  let fake: ReturnType<typeof fakeBackend>;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    fake = fakeBackend();
    __setBackendForTests(fake.backend);
  });
  afterEach(() => db.close());

  it('sends nothing before the account answers, then the waiting events after a yes', async () => {
    track('login', { method: 'google' });
    await startAnalytics(db, 'u1');
    expect(useAnalyticsStore.getState().consent).toBe('unset');
    track('playback_started');
    await flush();
    expect(fake.events).toEqual([]);
    expect(fake.calls).toEqual([]);

    setUserProperty('bring_first', 'audio');
    await setAnalyticsConsent(true);
    expect(fake.calls).toEqual(['enabled:true', 'property:bring_first=audio']);
    expect(fake.events.map((e) => e.name)).toEqual(['login', 'playback_started']);

    track('reader_opened');
    await flush();
    expect(fake.events.map((e) => e.name)).toEqual(['login', 'playback_started', 'reader_opened']);
  });

  it('drops waiting events after a no and keeps collection off', async () => {
    await startAnalytics(db, 'u1');
    track('login', { method: 'email' });
    await setAnalyticsConsent(false);
    track('reader_opened');
    await flush();
    expect(fake.events).toEqual([]);
    expect(fake.calls).toEqual(['enabled:false', 'reset']);
  });

  it('remembers the choice per account', async () => {
    await startAnalytics(db, 'u1');
    await setAnalyticsConsent(true);
    await stopAnalytics();
    expect(useAnalyticsStore.getState().consent).toBeNull();

    await startAnalytics(db, 'u2');
    expect(useAnalyticsStore.getState().consent).toBe('unset');
    await stopAnalytics();

    fake.calls.length = 0;
    await startAnalytics(db, 'u1');
    expect(useAnalyticsStore.getState().consent).toBe('granted');
    expect(fake.calls).toEqual(['enabled:true']);
  });

  it('withdrawing in Profile turns collection off and forgets the installation', async () => {
    await startAnalytics(db, 'u1');
    await setAnalyticsConsent(true);
    fake.calls.length = 0;
    await setAnalyticsConsent(false);
    expect(fake.calls).toEqual(['enabled:false', 'reset']);
    track('playback_started');
    await flush();
    expect(fake.events).toEqual([]);
  });

  it('never sends an event with book data, even with consent', async () => {
    await startAnalytics(db, 'u1');
    await setAnalyticsConsent(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Bypasses the types on purpose: this is what a mistake in a caller would look like.
    (track as (name: string, params?: object) => void)('book_finished', { type: 'ebook', title: 'Dracula' });
    await flush();
    warn.mockRestore();
    expect(fake.events).toEqual([]);
  });

  it('does nothing in a build without Firebase', async () => {
    __setBackendForTests(fake.backend, false);
    await startAnalytics(db, 'u1');
    await setAnalyticsConsent(true);
    track('playback_started');
    await stopAnalytics();
    await flush();
    expect(fake.calls).toEqual([]);
    expect(fake.events).toEqual([]);
  });
});

describe('listening sessions', () => {
  let fake: ReturnType<typeof fakeBackend>;
  let now = 0;
  const clock = () => now;

  beforeEach(async () => {
    jest.useFakeTimers();
    fake = fakeBackend();
    __setBackendForTests(fake.backend);
    const db = createTestDb();
    await migrate(db);
    await startAnalytics(db, 'u1');
    await setAnalyticsConsent(true);
    fake.events.length = 0;
    now = 0;
  });
  afterEach(() => jest.useRealTimers());

  const names = () => fake.events.map((e) => (e.params.duration ? `${e.name}:${e.params.duration}` : e.name));

  it('reports one session from play to a lasting pause', async () => {
    const s = listeningSessions(clock);
    s.play('b1');
    now = 20 * 60_000;
    s.pause();
    expect(names()).toEqual(['playback_started']);
    now += 5_000;
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    expect(names()).toEqual(['playback_started', 'playback_session:15_30m']);
  });

  it('keeps a session going across a short gap (the next file of a book)', () => {
    const s = listeningSessions(clock);
    s.play('b1');
    now = 3 * 60_000;
    s.pause();
    now += 500;
    s.play('b1');
    now += 3 * 60_000;
    s.pause();
    s.flush();
    expect(names()).toEqual(['playback_started', 'playback_session:5_15m']);
  });

  it('starts a new session for another book', () => {
    const s = listeningSessions(clock);
    s.play('b1');
    now = 30_000;
    s.end();
    s.play('b2');
    now += 2 * 60_000;
    s.end();
    expect(names()).toEqual([
      'playback_started',
      'playback_session:under_1m',
      'playback_started',
      'playback_session:1_5m',
    ]);
  });
});
