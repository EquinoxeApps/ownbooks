/**
 * Every event OwnBooks may send, and the only values each parameter may take (spec §4.8).
 * Parameters are either one of a fixed list of strings or a whole number, so nothing derived
 * from a book (title, author, filename, fingerprint, any free text) can ever get through:
 * `sanitize` drops an event with an unknown parameter or a value outside its list.
 */

const METHODS = ['apple', 'google', 'facebook', 'email'] as const;
const BOOK_TYPES = ['audio', 'ebook'] as const;
const FORMATS = ['mp3', 'm4a', 'm4b', 'epub', 'mixed'] as const;
const SIZES = ['under_10mb', '10_100mb', '100_500mb', '500mb_1gb', 'over_1gb'] as const;
const DURATIONS = ['under_1m', '1_5m', '5_15m', '15_30m', '30_60m', 'over_60m'] as const;
const IMPORT_FAILURES = ['drm', 'unsupported', 'duplicate', 'unplayable', 'no_space', 'unreadable', 'generic'] as const;

/** A whole number from 0 to `max`. */
type Count = { max: number };

const COUNT: Count = { max: 10_000 };

export const EVENTS = {
  sign_up: { method: METHODS },
  login: { method: METHODS },
  import_started: { type: BOOK_TYPES, file_count: COUNT },
  import_completed: { type: BOOK_TYPES, format: FORMATS, size: SIZES, track_count: COUNT },
  import_failed: { reason: IMPORT_FAILURES },
  playback_started: {},
  playback_session: { duration: DURATIONS },
  reader_opened: {},
  book_finished: { type: BOOK_TYPES },
  sync_conflict_shown: { type: BOOK_TYPES },
  account_deleted: {},
} as const satisfies Record<string, Record<string, readonly string[] | Count>>;

export const USER_PROPERTIES = {
  /** The onboarding answer to "What will you bring first?". */
  bring_first: ['audio', 'ebook', 'both'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENTS;
type ParamValue<S> = S extends readonly (infer V)[] ? V : number;
export type EventParams<E extends EventName> = { [K in keyof (typeof EVENTS)[E]]: ParamValue<(typeof EVENTS)[E][K]> };
export type UserPropertyName = keyof typeof USER_PROPERTIES;
export type UserPropertyValue<P extends UserPropertyName> = (typeof USER_PROPERTIES)[P][number];

/**
 * The event's parameters if every one is known and allowed, otherwise null. Types already stop
 * most mistakes; this is the runtime guard for anything that slips past them.
 */
export function sanitize(name: string, params: Record<string, unknown> = {}): Record<string, string | number> | null {
  if (!Object.hasOwn(EVENTS, name)) return null;
  const schema = EVENTS[name as EventName] as Record<string, readonly string[] | Count>;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    const allowed = Object.hasOwn(schema, key) ? schema[key] : undefined;
    if (!allowed) return null;
    if (Array.isArray(allowed)) {
      if (typeof value !== 'string' || !allowed.includes(value)) return null;
    } else {
      const { max } = allowed as Count;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
    }
    out[key] = value;
  }
  return out;
}

export function isAllowedUserProperty(name: string, value: unknown): boolean {
  if (!Object.hasOwn(USER_PROPERTIES, name)) return false;
  return (USER_PROPERTIES[name as UserPropertyName] as readonly string[]).includes(value as string);
}

export function sizeBucket(bytes: number): (typeof SIZES)[number] {
  if (bytes < 10e6) return 'under_10mb';
  if (bytes < 100e6) return '10_100mb';
  if (bytes < 500e6) return '100_500mb';
  if (bytes < 1e9) return '500mb_1gb';
  return 'over_1gb';
}

export function durationBucket(ms: number): (typeof DURATIONS)[number] {
  const minutes = ms / 60_000;
  if (minutes < 1) return 'under_1m';
  if (minutes < 5) return '1_5m';
  if (minutes < 15) return '5_15m';
  if (minutes < 30) return '15_30m';
  if (minutes < 60) return '30_60m';
  return 'over_60m';
}

/** Format of an import from its files' extensions; several kinds together are "mixed". */
export function formatOf(extensions: readonly string[]): (typeof FORMATS)[number] {
  const known = new Set(extensions.map((e) => e.toLowerCase()));
  if (known.size !== 1) return 'mixed';
  const [only] = known;
  return (FORMATS as readonly string[]).includes(only) ? (only as (typeof FORMATS)[number]) : 'mixed';
}
