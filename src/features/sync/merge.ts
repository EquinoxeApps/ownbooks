import type { BookType, ProgressRow, RemoteProgressRow } from '@/db/types';
import { toGlobal, type TrackSpan } from '@/features/player/position';

import type { RemoteProgress } from './remote';

/** Positions closer than this aren't worth asking about (spec: "more than 30 s or one page away"). */
export const AUDIO_CONFLICT_MS = 30_000;
/**
 * Ebook pages depend on screen size and settings, so "one page" is approximated by a share of
 * the book: about a page of a 500-page book.
 */
export const EBOOK_CONFLICT_FRACTION = 0.002;

export const toMs = (iso: string | null): number | null => (iso == null ? null : Date.parse(trimFraction(iso)));
export const toIso = (ms: number): string => new Date(ms).toISOString();

/** Postgres timestamps carry microseconds; not every JS engine parses more than milliseconds. */
function trimFraction(iso: string): string {
  return iso.replace(/(\.\d{3})\d+/, '$1');
}

/** An ISO timestamp moved by `deltaMs`, for re-reading a short overlap before the pull cursor. */
export function shiftIso(iso: string, deltaMs: number): string {
  return toIso((toMs(iso) ?? 0) + deltaMs);
}

export function remoteToLocal(r: RemoteProgress, bookId: string): RemoteProgressRow {
  return {
    book_id: bookId,
    track_idx: r.track_idx,
    position_ms: r.position_ms,
    cfi: r.cfi,
    fraction: r.fraction,
    speed: r.speed,
    finished_at: toMs(r.finished_at),
    device_id: r.device_id,
    device_name: r.device_name,
    updated_at: toMs(r.updated_at) ?? 0,
  };
}

type Position = Pick<ProgressRow, 'track_idx' | 'position_ms' | 'cfi' | 'fraction'>;

/** True if two positions in the same book are far enough apart to ask which one to keep. */
export function differsMeaningfully(type: BookType, tracks: readonly TrackSpan[], a: Position, b: Position): boolean {
  if (type === 'audio' && tracks.length > 0) {
    const ga = toGlobal(tracks, a.track_idx ?? 0, a.position_ms ?? 0);
    const gb = toGlobal(tracks, b.track_idx ?? 0, b.position_ms ?? 0);
    return Math.abs(ga - gb) > AUDIO_CONFLICT_MS;
  }
  return Math.abs(a.fraction - b.fraction) >= EBOOK_CONFLICT_FRACTION;
}

/** A position that was never moved from the start of the book: nothing worth keeping. */
function untouched(p: ProgressRow): boolean {
  return p.fraction === 0 && !p.position_ms && !p.track_idx && !p.cfi && p.finished_at == null;
}

export type ProgressDecision = 'ignore' | 'apply' | 'hold';

/**
 * What to do with a position pulled from the server (last write wins by timestamp):
 * - ignore: this device's position is as new or newer, and gets pushed instead;
 * - apply: take it silently (nothing here worth protecting, or the difference is small);
 * - hold: keep this device's position and ask when the book is next opened (the conflict sheet).
 */
export function decideProgress(args: {
  type: BookType;
  onDevice: boolean;
  tracks: readonly TrackSpan[];
  local: ProgressRow | null;
  remote: RemoteProgressRow;
  thisDeviceId: string;
}): ProgressDecision {
  const { local, remote } = args;
  if (!local) return 'apply';
  if (remote.updated_at <= local.updated_at) return 'ignore';
  if (remote.device_id === args.thisDeviceId) return 'apply';
  if (!args.onDevice || untouched(local)) return 'apply';
  // Already following that device (pulled earlier and not moved here since).
  if (local.device_id != null && local.dirty === 0) return 'apply';
  return differsMeaningfully(args.type, args.tracks, local, remote) ? 'hold' : 'apply';
}
