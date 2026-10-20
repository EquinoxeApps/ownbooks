import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The server side of sync, as the engine sees it. The Supabase implementation below is the only
 * code in the app that reads or writes Supabase tables; tests swap in an in-memory server.
 * Timestamps are ISO strings, as Postgres returns them.
 */

export type RemoteBook = {
  fingerprint: string;
  type: 'audio' | 'ebook';
  title: string;
  author: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  server_updated_at: string;
};

export type RemoteProgress = {
  fingerprint: string;
  track_idx: number | null;
  position_ms: number | null;
  cfi: string | null;
  fraction: number;
  speed: number | null;
  finished_at: string | null;
  device_id: string | null;
  device_name: string | null;
  updated_at: string;
  server_updated_at: string;
};

export type BookPush = Omit<RemoteBook, 'created_at' | 'server_updated_at'>;
export type ProgressPush = Omit<RemoteProgress, 'server_updated_at'>;

export type Device = { id: string; name: string; platform: 'ios' | 'android' };

/**
 * Where a pull continues: rows changed after `ts`, or at `ts` with a greater fingerprint.
 * A null fingerprint means "from `ts` inclusive", used to re-read a short overlap.
 */
export type PullCursor = { ts: string; fingerprint: string | null };

export interface Remote {
  /** The signed-in user per the server session, or null without a usable session. */
  sessionUserId(): Promise<string | null>;
  upsertDevice(userId: string, device: Device): Promise<void>;
  /** Upserts books; the server drops rows older than what it holds (last write wins). */
  pushBooks(userId: string, rows: BookPush[]): Promise<void>;
  pushProgress(userId: string, rows: ProgressPush[]): Promise<void>;
  /** Tombstones a book everywhere and drops its position. */
  removeEverywhere(fingerprint: string, at: string): Promise<void>;
  pullBooks(after: PullCursor | null, limit: number): Promise<RemoteBook[]>;
  pullProgress(after: PullCursor | null, limit: number): Promise<RemoteProgress[]>;
}

const BOOK_COLUMNS = 'fingerprint,type,title,author,duration_ms,created_at,updated_at,deleted_at,server_updated_at';
const PROGRESS_COLUMNS =
  'fingerprint,track_idx,position_ms,cfi,fraction,speed,finished_at,device_id,device_name,updated_at,server_updated_at';

function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error));
  return result.data;
}

export function supabaseRemote(client: SupabaseClient): Remote {
  async function pull<T>(table: string, columns: string, after: PullCursor | null, limit: number): Promise<T[]> {
    let query = client.from(table).select(columns);
    if (after?.fingerprint == null && after) {
      query = query.gte('server_updated_at', after.ts);
    } else if (after) {
      // Values are quoted: timestamps contain characters PostgREST's or() syntax reserves.
      query = query.or(
        `server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",fingerprint.gt.${after.fingerprint})`,
      );
    }
    const data = check(
      await query.order('server_updated_at', { ascending: true }).order('fingerprint', { ascending: true }).limit(limit),
    );
    return (data ?? []) as T[];
  }

  return {
    async sessionUserId() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async upsertDevice(userId, device) {
      check(
        await client
          .from('devices')
          .upsert({ ...device, user_id: userId, last_seen_at: new Date().toISOString() }, { onConflict: 'id' }),
      );
    },
    async pushBooks(userId, rows) {
      if (rows.length === 0) return;
      check(
        await client
          .from('books')
          .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,fingerprint' }),
      );
    },
    async pushProgress(userId, rows) {
      if (rows.length === 0) return;
      check(
        await client
          .from('progress')
          .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,fingerprint' }),
      );
    },
    async removeEverywhere(fingerprint, at) {
      check(await client.from('books').update({ deleted_at: at, updated_at: at }).eq('fingerprint', fingerprint));
      check(await client.from('progress').delete().eq('fingerprint', fingerprint));
    },
    pullBooks: (after, limit) => pull<RemoteBook>('books', BOOK_COLUMNS, after, limit),
    pullProgress: (after, limit) => pull<RemoteProgress>('progress', PROGRESS_COLUMNS, after, limit),
  };
}
