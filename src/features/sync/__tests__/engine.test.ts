import { createTestDb } from '../../../../test/nodeDb';
import { migrate } from '@/db/migrations';
import {
  deleteBookRows,
  findByFingerprint,
  insertAudioBook,
  insertEbook,
  listLibrary,
  makePlaceholder,
  updateBookDetails,
} from '@/db/repositories/books';
import {
  applyRemoteProgress,
  getProgress,
  getRemoteProgress,
  keepLocalProgress,
  saveAudioPosition,
  saveEbookPosition,
} from '@/db/repositories/progress';
import { addPendingOp, countUnsynced } from '@/db/repositories/sync';
import type { Db } from '@/db/types';

import { syncOnce } from '../engine';
import type { Device, PullCursor, Remote, RemoteBook, RemoteProgress } from '../remote';

/**
 * Two phones and one server. The in-memory server behaves like the Supabase schema: upserts
 * keyed by fingerprint, stale writes dropped by client timestamp, and a server change time
 * (with microseconds, as Postgres returns it) that drives the pull cursor.
 */
class FakeServer {
  books = new Map<string, RemoteBook>();
  progress = new Map<string, RemoteProgress>();
  devices = new Map<string, Device>();
  private tick = 0;
  /** Set to make the next call fail, as if the network dropped. */
  failNext = false;

  private stamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 9, 20) + this.tick).toISOString().replace('Z', '456+00:00');
  }

  private fail() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('network down');
    }
  }

  client(): Remote {
    const pull = <T extends { fingerprint: string; server_updated_at: string }>(
      rows: Iterable<T>,
      after: PullCursor | null,
    ): T[] => {
      const ms = (s: string) => Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
      return [...rows]
        .filter((r) => {
          if (!after) return true;
          const a = ms(after.ts);
          const t = ms(r.server_updated_at);
          if (after.fingerprint == null) return t >= a;
          return t > a || (t === a && r.fingerprint > after.fingerprint);
        })
        .sort((x, y) => ms(x.server_updated_at) - ms(y.server_updated_at) || x.fingerprint.localeCompare(y.fingerprint))
        .map((r) => ({ ...r }));
    };
    return {
      sessionUserId: async () => 'user-a',
      upsertDevice: async (_userId, device) => {
        this.fail();
        this.devices.set(device.id, device);
      },
      pushBooks: async (_userId, rows) => {
        this.fail();
        for (const r of rows) {
          const old = this.books.get(r.fingerprint);
          if (old && r.updated_at < old.updated_at) continue;
          this.books.set(r.fingerprint, {
            ...r,
            created_at: old?.created_at ?? this.stamp(),
            server_updated_at: this.stamp(),
          });
        }
      },
      pushProgress: async (_userId, rows) => {
        this.fail();
        for (const r of rows) {
          if (!this.books.has(r.fingerprint)) throw new Error('foreign key: book missing');
          const old = this.progress.get(r.fingerprint);
          if (old && r.updated_at < old.updated_at) continue;
          this.progress.set(r.fingerprint, { ...r, server_updated_at: this.stamp() });
        }
      },
      removeEverywhere: async (fingerprint, at) => {
        this.fail();
        const old = this.books.get(fingerprint);
        if (old && at >= old.updated_at) {
          this.books.set(fingerprint, { ...old, deleted_at: at, updated_at: at, server_updated_at: this.stamp() });
        }
        this.progress.delete(fingerprint);
      },
      pullBooks: async (after) => pull(this.books.values(), after),
      pullProgress: async (after) => pull(this.progress.values(), after),
    };
  }
}

type Phone = { db: Db & { close(): void }; device: Device; removed: string[] };

let server: FakeServer;
let phone: Phone;
let ipad: Phone;
let ids = 0;

async function makePhone(id: string, name: string): Promise<Phone> {
  const db = createTestDb();
  await migrate(db);
  return { db, device: { id, name, platform: 'android' }, removed: [] };
}

const sync = (p: Phone) =>
  syncOnce({
    db: p.db,
    remote: server.client(),
    userId: 'user-a',
    device: p.device,
    newId: () => `placeholder-${++ids}`,
    removeBook: async (bookId) => {
      p.removed.push(bookId);
      await deleteBookRows(p.db, bookId);
    },
  });

const FP = 'a'.repeat(64);
const EPUB_FP = 'e'.repeat(64);

/** Imports the same 2-track audiobook (10 min per track) on a phone. */
async function importAudio(p: Phone, id: string, at: number) {
  await insertAudioBook(p.db, {
    id,
    userId: 'user-a',
    fingerprint: FP,
    title: 'Moby-Dick',
    author: 'Herman Melville',
    sizeBytes: 1000,
    coverPath: null,
    chapters: [],
    addedAt: at,
    tracks: [
      { id: `${id}-t0`, filePath: `books/${id}/001.mp3`, title: null, durationMs: 600_000 },
      { id: `${id}-t1`, filePath: `books/${id}/002.mp3`, title: null, durationMs: 600_000 },
    ],
  });
}

const play = (p: Phone, bookId: string, trackIdx: number, positionMs: number, at: number) =>
  saveAudioPosition(p.db, { bookId, trackIdx, positionMs, fraction: (trackIdx * 600_000 + positionMs) / 1_200_000, speed: 1, at });

beforeEach(async () => {
  server = new FakeServer();
  phone = await makePhone('phone', 'Galaxy S25+');
  ipad = await makePhone('ipad', 'iPad');
});

afterEach(() => {
  phone.db.close();
  ipad.db.close();
});

describe('sync between two devices', () => {
  it('shows a book from another device as a placeholder with its place', async () => {
    await importAudio(phone, 'p1', 1_000);
    await play(phone, 'p1', 0, 300_000, 2_000);
    await sync(phone);
    expect(await countUnsynced(phone.db, 'user-a')).toBe(0);

    await sync(ipad);
    const [book] = await listLibrary(ipad.db, 'user-a');
    expect(book).toMatchObject({ title: 'Moby-Dick', on_device: 0, cover_path: null, last_device: 'Galaxy S25+' });
    expect(book.fraction).toBeCloseTo(0.25);
    expect(server.devices.has('ipad')).toBe(true);
  });

  it('adopts the placeholder when the same file is imported, keeping the synced place', async () => {
    await importAudio(phone, 'p1', 1_000);
    await play(phone, 'p1', 1, 60_000, 2_000);
    await sync(phone);
    await sync(ipad);

    const placeholder = await findByFingerprint(ipad.db, 'user-a', FP);
    await importAudio(ipad, placeholder!.id, 5_000);

    const book = await findByFingerprint(ipad.db, 'user-a', FP);
    expect(book).toMatchObject({ id: placeholder!.id, on_device: 1, dirty: 0 });
    expect(await getProgress(ipad.db, book!.id)).toMatchObject({ track_idx: 1, position_ms: 60_000 });
  });

  it('holds a newer, distant position for the conflict sheet, and keeps or takes it on request', async () => {
    await importAudio(phone, 'p1', 1_000);
    await importAudio(ipad, 'i1', 1_000);
    await play(ipad, 'i1', 0, 120_000, 2_000);
    await sync(ipad);
    await play(phone, 'p1', 1, 300_000, 3_000);
    await sync(phone);

    await sync(ipad);
    // The iPad keeps its own place until asked.
    expect(await getProgress(ipad.db, 'i1')).toMatchObject({ track_idx: 0, position_ms: 120_000 });
    const held = await getRemoteProgress(ipad.db, 'i1');
    expect(held).toMatchObject({ track_idx: 1, position_ms: 300_000, device_name: 'Galaxy S25+' });

    await applyRemoteProgress(ipad.db, held!);
    expect(await getProgress(ipad.db, 'i1')).toMatchObject({ track_idx: 1, position_ms: 300_000, dirty: 0 });
    expect(await getRemoteProgress(ipad.db, 'i1')).toBeNull();
  });

  it('“keep this phone’s position” makes it the newest everywhere', async () => {
    await importAudio(phone, 'p1', 1_000);
    await importAudio(ipad, 'i1', 1_000);
    await play(ipad, 'i1', 0, 120_000, 2_000);
    await sync(ipad);
    await play(phone, 'p1', 1, 300_000, 3_000);
    await sync(phone);
    await sync(ipad);

    await keepLocalProgress(ipad.db, 'i1', 4_000);
    await sync(ipad);
    expect(server.progress.get(FP)).toMatchObject({ track_idx: 0, position_ms: 120_000, device_name: 'iPad' });

    await sync(phone);
    expect(await getRemoteProgress(phone.db, 'p1')).toMatchObject({ position_ms: 120_000 });
  });

  it('takes a nearby newer position without asking', async () => {
    await importAudio(phone, 'p1', 1_000);
    await importAudio(ipad, 'i1', 1_000);
    await play(ipad, 'i1', 0, 120_000, 2_000);
    await play(phone, 'p1', 0, 140_000, 3_000);
    await sync(phone);
    await sync(ipad);
    // The iPad's own position is older, so it was overwritten rather than pushed.
    expect(await getProgress(ipad.db, 'i1')).toMatchObject({ position_ms: 140_000, device_name: 'Galaxy S25+' });
    expect(await getRemoteProgress(ipad.db, 'i1')).toBeNull();
    expect(server.progress.get(FP)?.position_ms).toBe(140_000);
  });

  it('last write wins: a newer local position is pushed, not overwritten', async () => {
    await importAudio(phone, 'p1', 1_000);
    await importAudio(ipad, 'i1', 1_000);
    await play(phone, 'p1', 0, 140_000, 2_000);
    await sync(phone);
    await play(ipad, 'i1', 1, 0, 3_000);
    await sync(ipad);
    expect(await getProgress(ipad.db, 'i1')).toMatchObject({ track_idx: 1, position_ms: 0 });
    expect(server.progress.get(FP)).toMatchObject({ track_idx: 1, device_id: 'ipad' });
  });

  it('syncs renames by timestamp', async () => {
    await importAudio(phone, 'p1', 1_000);
    await sync(phone);
    await sync(ipad);
    await updateBookDetails(phone.db, 'p1', { title: 'Moby Dick; or, The Whale', author: 'H. Melville' }, 9_000);
    await sync(phone);
    await sync(ipad);
    expect(await findByFingerprint(ipad.db, 'user-a', FP)).toMatchObject({
      title: 'Moby Dick; or, The Whale',
      author: 'H. Melville',
      dirty: 0,
    });
  });

  it('removes a book from every device', async () => {
    await importAudio(phone, 'p1', 1_000);
    await importAudio(ipad, 'i1', 1_000);
    await sync(phone);
    await sync(ipad);

    await addPendingOp(phone.db, 'user-a', { kind: 'removeEverywhere', fingerprint: FP, at: 10_000 });
    await deleteBookRows(phone.db, 'p1');
    await sync(phone);
    expect(server.books.get(FP)?.deleted_at).not.toBeNull();
    expect(await listLibrary(phone.db, 'user-a')).toEqual([]);

    await sync(ipad);
    expect(ipad.removed).toEqual(['i1']);
    expect(await listLibrary(ipad.db, 'user-a')).toEqual([]);
  });

  it('brings a removed book back when it is imported again later', async () => {
    await importAudio(phone, 'p1', 1_000);
    await sync(phone);
    await addPendingOp(phone.db, 'user-a', { kind: 'removeEverywhere', fingerprint: FP, at: 10_000 });
    await deleteBookRows(phone.db, 'p1');
    await sync(phone);

    await importAudio(phone, 'p2', 20_000);
    await sync(phone);
    expect(server.books.get(FP)?.deleted_at).toBeNull();
    await sync(ipad);
    expect((await listLibrary(ipad.db, 'user-a')).map((b) => b.title)).toEqual(['Moby-Dick']);
  });

  it('keeps a book deleted from one phone as a placeholder with its place', async () => {
    await importAudio(phone, 'p1', 1_000);
    await play(phone, 'p1', 0, 300_000, 2_000);
    await makePlaceholder(phone.db, 'p1');
    await sync(phone);
    await sync(phone);
    const [book] = await listLibrary(phone.db, 'user-a');
    expect(book).toMatchObject({ on_device: 0, fraction: 0.25 });
    expect(server.progress.get(FP)?.position_ms).toBe(300_000);
  });

  it('syncs ebook positions as CFIs', async () => {
    await insertEbook(phone.db, {
      id: 'e1',
      userId: 'user-a',
      fingerprint: EPUB_FP,
      title: 'Walden',
      author: 'Henry David Thoreau',
      sizeBytes: 10,
      filePath: 'books/e1/book.epub',
      coverPath: null,
      addedAt: 1_000,
    });
    await saveEbookPosition(phone.db, { bookId: 'e1', cfi: 'epubcfi(/6/14!/4/2/1:0)', fraction: 0.33, at: 2_000 });
    await sync(phone);
    await sync(ipad);
    const [book] = await listLibrary(ipad.db, 'user-a');
    expect(book).toMatchObject({ type: 'ebook', on_device: 0, fraction: 0.33 });
    expect(await getProgress(ipad.db, book.id)).toMatchObject({ cfi: 'epubcfi(/6/14!/4/2/1:0)' });
  });

  it('keeps changes queued through a failed pass and sends them on the next', async () => {
    await importAudio(phone, 'p1', 1_000);
    await play(phone, 'p1', 0, 300_000, 2_000);
    server.failNext = true;
    await expect(sync(phone)).rejects.toThrow('network down');
    expect(await countUnsynced(phone.db, 'user-a')).toBe(2);
    await sync(phone);
    expect(await countUnsynced(phone.db, 'user-a')).toBe(0);
    expect(server.progress.get(FP)?.position_ms).toBe(300_000);
  });

  it('re-pulling the overlap changes nothing', async () => {
    await importAudio(phone, 'p1', 1_000);
    await play(phone, 'p1', 0, 300_000, 2_000);
    await sync(phone);
    await sync(ipad);
    const before = await listLibrary(ipad.db, 'user-a');
    await sync(ipad);
    await sync(ipad);
    expect(await listLibrary(ipad.db, 'user-a')).toEqual(before);
  });
});
