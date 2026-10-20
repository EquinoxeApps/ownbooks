import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { supabaseRemote, type PullCursor, type Remote } from '../../src/features/sync/remote';

// The app's sync adapter (src/features/sync/remote.ts) against a real local Supabase: the
// PostgREST queries, the keyset pull cursor, last-write-wins and tombstones.

const url = process.env.SUPABASE_URL ?? process.env.API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see `npx supabase status -o env`).');
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);

type User = { id: string; remote: Remote };
const users: string[] = [];

async function createUser(): Promise<User> {
  const email = `sync-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  users.push(data.user.id);
  const client = createClient(url!, anonKey!, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, remote: supabaseRemote(client) };
}

afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

const fp = () => randomUUID().replace(/-/g, '').padEnd(64, '0');
const iso = (ms: number) => new Date(ms).toISOString();
const book = (fingerprint: string, at: number, title = 'Walden') => ({
  fingerprint,
  type: 'ebook' as const,
  title,
  author: null,
  duration_ms: null,
  updated_at: iso(at),
  deleted_at: null,
});
const position = (fingerprint: string, deviceId: string, fraction: number, at: number) => ({
  fingerprint,
  track_idx: null,
  position_ms: null,
  cfi: `epubcfi(/6/${Math.round(fraction * 100)})`,
  fraction,
  speed: null,
  finished_at: null,
  device_id: deviceId,
  device_name: 'Test phone',
  updated_at: iso(at),
});

describe('supabaseRemote', () => {
  let alice: User;
  const device = { id: randomUUID(), name: 'Test phone', platform: 'android' as const };

  beforeAll(async () => {
    alice = await createUser();
    await alice.remote.upsertDevice(alice.id, device);
    // Upserting the same device again only refreshes it.
    await alice.remote.upsertDevice(alice.id, { ...device, name: 'Renamed phone' });
  });

  it('knows whose session it has', async () => {
    expect(await alice.remote.sessionUserId()).toBe(alice.id);
  });

  it('pushes and pulls books and positions', async () => {
    const f = fp();
    const t = Date.now();
    await alice.remote.pushBooks(alice.id, [book(f, t)]);
    await alice.remote.pushProgress(alice.id, [position(f, device.id, 0.4, t)]);

    const books = await alice.remote.pullBooks(null, 500);
    expect(books.find((b) => b.fingerprint === f)).toMatchObject({ title: 'Walden', deleted_at: null });
    const progress = await alice.remote.pullProgress(null, 500);
    expect(progress.find((p) => p.fingerprint === f)).toMatchObject({ fraction: 0.4, device_id: device.id });
  });

  it('drops stale writes (last write wins)', async () => {
    const f = fp();
    const t = Date.now();
    await alice.remote.pushBooks(alice.id, [book(f, t, 'New title')]);
    await alice.remote.pushBooks(alice.id, [book(f, t - 1000, 'Old title')]);
    await alice.remote.pushProgress(alice.id, [position(f, device.id, 0.8, t)]);
    await alice.remote.pushProgress(alice.id, [position(f, device.id, 0.2, t - 1000)]);

    expect((await alice.remote.pullBooks(null, 500)).find((b) => b.fingerprint === f)?.title).toBe('New title');
    expect((await alice.remote.pullProgress(null, 500)).find((p) => p.fingerprint === f)?.fraction).toBeCloseTo(0.8);
  });

  it('pages through rows with the keyset cursor, each row once', async () => {
    const bob = await createUser();
    const t = Date.now();
    // One upsert: the rows share a server timestamp, so paging relies on the fingerprint tiebreak.
    const fps = [fp(), fp(), fp()];
    await bob.remote.pushBooks(bob.id, fps.map((f) => book(f, t)));

    const seen: string[] = [];
    let after: PullCursor | null = null;
    for (;;) {
      const page = await bob.remote.pullBooks(after, 1);
      if (page.length === 0) break;
      seen.push(page[0].fingerprint);
      after = { ts: page[0].server_updated_at, fingerprint: page[0].fingerprint };
    }
    expect(seen).toEqual([...fps].sort());

    // From a timestamp inclusive (the overlap re-read) returns them all again.
    const again = await bob.remote.pullBooks({ ts: iso(t - 60_000), fingerprint: null }, 500);
    expect(again).toHaveLength(3);
  });

  it('only ever sees its own rows', async () => {
    const carol = await createUser();
    expect(await carol.remote.pullBooks(null, 500)).toEqual([]);
    expect(await carol.remote.pullProgress(null, 500)).toEqual([]);
  });

  it('tombstones a book removed everywhere and drops its position', async () => {
    const f = fp();
    const t = Date.now();
    await alice.remote.pushBooks(alice.id, [book(f, t)]);
    await alice.remote.pushProgress(alice.id, [position(f, device.id, 0.5, t)]);
    await alice.remote.removeEverywhere(f, iso(t + 1000));

    const removed = (await alice.remote.pullBooks(null, 500)).find((b) => b.fingerprint === f);
    expect(removed?.deleted_at).not.toBeNull();
    expect((await alice.remote.pullProgress(null, 500)).find((p) => p.fingerprint === f)).toBeUndefined();

    // Imported again later: a newer push brings it back.
    await alice.remote.pushBooks(alice.id, [book(f, t + 2000)]);
    expect((await alice.remote.pullBooks(null, 500)).find((b) => b.fingerprint === f)?.deleted_at).toBeNull();
  });
});
