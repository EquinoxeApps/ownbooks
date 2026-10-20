import type { Db } from './types';

/**
 * Versioned schema migrations. Append new entries; never edit a shipped one.
 * The applied version is stored in PRAGMA user_version.
 */
export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE books (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL,
        fingerprint    TEXT NOT NULL,
        type           TEXT NOT NULL CHECK (type IN ('audio', 'ebook')),
        title          TEXT NOT NULL,
        author         TEXT,
        cover_path     TEXT,
        duration_ms    INTEGER,
        size_bytes     INTEGER,
        on_device      INTEGER NOT NULL DEFAULT 1,
        added_at       INTEGER NOT NULL,
        last_opened_at INTEGER,
        finished_at    INTEGER,
        updated_at     INTEGER NOT NULL,
        dirty          INTEGER NOT NULL DEFAULT 1,
        UNIQUE (user_id, fingerprint)
      );
      CREATE INDEX books_user_opened ON books (user_id, last_opened_at);

      CREATE TABLE tracks (
        id          TEXT PRIMARY KEY,
        book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        idx         INTEGER NOT NULL,
        file_path   TEXT NOT NULL,
        title       TEXT,
        duration_ms INTEGER NOT NULL
      );
      CREATE INDEX tracks_book ON tracks (book_id, idx);

      CREATE TABLE chapters (
        id        TEXT PRIMARY KEY,
        book_id   TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        track_idx INTEGER NOT NULL,
        title     TEXT,
        start_ms  INTEGER NOT NULL
      );
      CREATE INDEX chapters_book ON chapters (book_id, track_idx, start_ms);

      CREATE TABLE ebook_files (
        book_id   TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL
      );

      CREATE TABLE progress (
        book_id     TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        track_idx   INTEGER,
        position_ms INTEGER,
        cfi         TEXT,
        fraction    REAL NOT NULL DEFAULT 0,
        speed       REAL,
        finished_at INTEGER,
        updated_at  INTEGER NOT NULL,
        dirty       INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE activity_days (
        user_id        TEXT NOT NULL,
        day            TEXT NOT NULL,
        listen_s       INTEGER NOT NULL DEFAULT 0,
        read_s         INTEGER NOT NULL DEFAULT 0,
        finished_count INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL,
        dirty          INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, day)
      );

      CREATE TABLE pending_ops (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    // Set once a book's embedded tags (cover, chapters, track titles) have been read.
    version: 2,
    sql: `ALTER TABLE books ADD COLUMN tags_read INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // Sync: which device a pulled position came from, and newer positions from other devices
    // held back until the user picks one (the conflict sheet).
    version: 3,
    sql: `
      ALTER TABLE progress ADD COLUMN device_id TEXT;
      ALTER TABLE progress ADD COLUMN device_name TEXT;

      CREATE TABLE remote_progress (
        book_id     TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        track_idx   INTEGER,
        position_ms INTEGER,
        cfi         TEXT,
        fraction    REAL NOT NULL DEFAULT 0,
        speed       REAL,
        finished_at INTEGER,
        device_id   TEXT,
        device_name TEXT,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
];

export const LATEST_VERSION = migrations[migrations.length - 1].version;

/** Per-connection settings; run every time the database is opened. */
export async function configureConnection(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
}

export async function migrate(db: Db): Promise<number> {
  await configureConnection(db);
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let current = row?.user_version ?? 0;

  for (const m of migrations) {
    if (m.version <= current) continue;
    // Each migration and its version bump commit together, so a crash
    // mid-migration leaves the previous version intact.
    try {
      await db.execAsync(`BEGIN; ${m.sql}\nPRAGMA user_version = ${m.version}; COMMIT;`);
    } catch (error) {
      await db.execAsync('ROLLBACK;').catch(() => undefined);
      throw error;
    }
    current = m.version;
  }
  return current;
}
