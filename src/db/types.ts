export type BindValue = string | number | null | boolean | Uint8Array;

export type RunResult = { changes: number; lastInsertRowId: number };

/**
 * The subset of expo-sqlite's SQLiteDatabase the app uses. Repositories depend on
 * this interface so tests can run them against node:sqlite.
 */
export interface Db {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: BindValue[]): Promise<RunResult>;
  getAllAsync<T>(source: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: BindValue[]): Promise<T | null>;
}

export type BookType = 'audio' | 'ebook';

export type BookRow = {
  id: string;
  user_id: string;
  fingerprint: string;
  type: BookType;
  title: string;
  author: string | null;
  cover_path: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  on_device: number;
  added_at: number;
  last_opened_at: number | null;
  finished_at: number | null;
  updated_at: number;
  dirty: number;
  /** 1 once the files' tags have been read (cover, chapters, track titles). */
  tags_read: number;
};

export type ProgressRow = {
  book_id: string;
  track_idx: number | null;
  position_ms: number | null;
  cfi: string | null;
  fraction: number;
  speed: number | null;
  finished_at: number | null;
  updated_at: number;
  dirty: number;
  /** Set when the position was pulled from another device; null for this device's own writes. */
  device_id: string | null;
  device_name: string | null;
};

/** A newer position from another device, waiting for the user to choose it or keep their own. */
export type RemoteProgressRow = Omit<ProgressRow, 'dirty'>;
