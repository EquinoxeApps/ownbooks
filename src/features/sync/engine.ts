import { findByFingerprint } from '@/db/repositories/books';
import * as kv from '@/db/repositories/kv';
import { applyRemoteProgress, getProgress, holdRemoteProgress } from '@/db/repositories/progress';
import {
  applyRemoteDetails,
  deletePendingOp,
  insertPlaceholder,
  listDirtyBooks,
  listDirtyProgress,
  listPendingOps,
  markBooksClean,
  markProgressClean,
} from '@/db/repositories/sync';
import { listTracks } from '@/db/repositories/tracks';
import type { Db } from '@/db/types';

import { decideProgress, remoteToLocal, shiftIso, toIso, toMs } from './merge';
import type { Device, PullCursor, Remote, RemoteBook, RemoteProgress } from './remote';

/**
 * One sync pass (plan: "Sync engine"):
 * 1. upsert this device; 2. push queued removals, dirty books and dirty positions;
 * 3. pull books, then positions, changed since the stored cursors; 4. merge, last write wins.
 * Client timestamps decide which write wins; the server's change time drives the pull cursor.
 */

const PAGE = 500;
/**
 * Rows are re-read from slightly before the cursor: a server timestamp is taken when its
 * transaction starts, so a slow write can become visible after rows stamped later. Merging is
 * idempotent, so the overlap is harmless.
 */
const PULL_OVERLAP_MS = 5_000;

export type SyncDeps = {
  db: Db;
  remote: Remote;
  userId: string;
  device: Device;
  newId(): string;
  /** Removes a book on this device (files, then rows) after another device removed it everywhere. */
  removeBook(bookId: string): Promise<void>;
};

export type SyncResult = { pushed: number; pulled: number };

export async function syncOnce(deps: SyncDeps): Promise<SyncResult> {
  const { db, remote, userId } = deps;
  let pushed = 0;
  let pulled = 0;

  await remote.upsertDevice(userId, deps.device);

  const ops = await listPendingOps(db, userId);
  for (const { id, op } of ops) {
    if (op.kind === 'removeEverywhere') await remote.removeEverywhere(op.fingerprint, toIso(op.at));
    await deletePendingOp(db, id);
    pushed += 1;
  }
  const removed = new Set(ops.map(({ op }) => op.fingerprint));

  const books = await listDirtyBooks(db, userId);
  await remote.pushBooks(
    userId,
    books.map((b) => ({
      fingerprint: b.fingerprint,
      type: b.type,
      title: b.title,
      author: b.author,
      duration_ms: b.duration_ms,
      updated_at: toIso(b.updated_at),
      deleted_at: null,
    })),
  );
  await markBooksClean(db, books);
  pushed += books.length;

  const positions = await listDirtyProgress(db, userId);
  await remote.pushProgress(
    userId,
    positions.map((p) => ({
      fingerprint: p.fingerprint,
      track_idx: p.track_idx,
      position_ms: p.position_ms,
      cfi: p.cfi,
      fraction: Math.min(1, Math.max(0, p.fraction)),
      speed: p.speed,
      finished_at: p.finished_at == null ? null : toIso(p.finished_at),
      device_id: deps.device.id,
      device_name: deps.device.name,
      updated_at: toIso(p.updated_at),
    })),
  );
  await markProgressClean(db, positions);
  pushed += positions.length;

  pulled += await pullAll(deps, 'books', (after) => remote.pullBooks(after, PAGE), (row) =>
    mergeBook(deps, row, removed),
  );
  pulled += await pullAll(deps, 'progress', (after) => remote.pullProgress(after, PAGE), (row) =>
    mergeProgress(deps, row, removed),
  );
  return { pushed, pulled };
}

const cursorKey = (userId: string, table: string) => kv.userKey(userId, `sync.cursor.${table}`);

async function pullAll<T extends { fingerprint: string; server_updated_at: string }>(
  deps: SyncDeps,
  table: 'books' | 'progress',
  fetchPage: (after: PullCursor | null) => Promise<T[]>,
  merge: (row: T) => Promise<void>,
): Promise<number> {
  const key = cursorKey(deps.userId, table);
  const saved = await kv.getJson<PullCursor>(deps.db, key);
  let after: PullCursor | null = saved ? { ts: shiftIso(saved.ts, -PULL_OVERLAP_MS), fingerprint: null } : null;
  let count = 0;
  for (;;) {
    const rows = await fetchPage(after);
    for (const row of rows) await merge(row);
    count += rows.length;
    const last = rows[rows.length - 1];
    if (last) {
      after = { ts: last.server_updated_at, fingerprint: last.fingerprint };
      // Only ever move the stored cursor forward (the overlap re-reads older rows).
      if (!saved || (toMs(last.server_updated_at) ?? 0) >= (toMs(saved.ts) ?? 0)) {
        await kv.setJson(deps.db, key, after);
      }
    }
    if (rows.length < PAGE) return count;
  }
}

async function mergeBook(deps: SyncDeps, r: RemoteBook, removed: Set<string>): Promise<void> {
  // A book just removed everywhere from here mustn't come back as a placeholder from an older row.
  if (removed.has(r.fingerprint) && !r.deleted_at) return;
  const local = await findByFingerprint(deps.db, deps.userId, r.fingerprint);
  if (r.deleted_at) {
    if (local) await deps.removeBook(local.id);
    return;
  }
  const updatedAt = toMs(r.updated_at) ?? 0;
  if (!local) {
    await insertPlaceholder(deps.db, {
      id: deps.newId(),
      userId: deps.userId,
      fingerprint: r.fingerprint,
      type: r.type,
      title: r.title,
      author: r.author,
      durationMs: r.duration_ms,
      addedAt: toMs(r.created_at) ?? updatedAt,
      updatedAt,
    });
    return;
  }
  await applyRemoteDetails(deps.db, local.id, {
    title: r.title,
    author: r.author,
    durationMs: r.duration_ms,
    updatedAt,
  });
}

async function mergeProgress(deps: SyncDeps, r: RemoteProgress, removed: Set<string>): Promise<void> {
  if (removed.has(r.fingerprint)) return;
  const book = await findByFingerprint(deps.db, deps.userId, r.fingerprint);
  if (!book) return;
  const remote = remoteToLocal(r, book.id);
  const [local, tracks] = await Promise.all([getProgress(deps.db, book.id), listTracks(deps.db, book.id)]);
  const decision = decideProgress({
    type: book.type,
    onDevice: book.on_device === 1,
    tracks: tracks.map((t) => ({ durationMs: t.duration_ms })),
    local,
    remote,
    thisDeviceId: deps.device.id,
  });
  if (decision === 'apply') await applyRemoteProgress(deps.db, remote);
  else if (decision === 'hold') await holdRemoteProgress(deps.db, remote);
}
