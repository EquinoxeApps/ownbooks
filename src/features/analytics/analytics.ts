import { create } from 'zustand';

import * as kv from '@/db/repositories/kv';
import type { Db } from '@/db/types';

import {
  isAllowedUserProperty,
  sanitize,
  type EventName,
  type EventParams,
  type UserPropertyName,
  type UserPropertyValue,
} from './events';
import { firebaseBackend, isAnalyticsAvailable, type AnalyticsBackend } from './native';

/**
 * Consent-gated analytics (spec §4.8). Nothing is sent until the signed-in account says yes:
 * Firebase starts with every collection default off (firebase.json), and this module only turns
 * it on for an account that agreed. Events from before the answer (e.g. the sign-in itself) wait
 * in memory and are sent after a yes or dropped after a no.
 */

/** 'unset': this account hasn't been asked yet. */
export type Consent = 'granted' | 'denied' | 'unset';

type AnalyticsState = {
  /** null while no account is loaded (signed out, or still reading the stored choice). */
  consent: Consent | null;
};

export const useAnalyticsStore = create<AnalyticsState>(() => ({ consent: null }));
const set = useAnalyticsStore.setState;
const get = useAnalyticsStore.getState;

const CONSENT_KEY = 'analytics.consent';
const MAX_PENDING = 20;

let backend: AnalyticsBackend = firebaseBackend;
let available = isAnalyticsAvailable;
let db: Db | null = null;
let userId: string | null = null;
let pending: { name: string; params: Record<string, string | number> }[] = [];
const userProperties = new Map<string, string>();

/** Whether this build can send analytics at all; without it there's nothing to ask about. */
export const analyticsAvailable = () => available;

/** Loads the signed-in account's choice and applies it. */
export async function startAnalytics(database: Db, id: string): Promise<void> {
  db = database;
  userId = id;
  const stored = await kv.getString(database, kv.userKey(id, CONSENT_KEY));
  if (userId !== id) return;
  const consent: Consent = stored === 'granted' || stored === 'denied' ? stored : 'unset';
  set({ consent });
  await apply(consent);
}

/** Signed out: stop collecting until an account with a yes signs in. */
export async function stopAnalytics(): Promise<void> {
  db = null;
  userId = null;
  pending = [];
  set({ consent: null });
  if (available) await quietly(() => backend.setEnabled(false));
}

/** The answer from the consent screen or the Profile toggle. */
export async function setAnalyticsConsent(granted: boolean): Promise<void> {
  if (!db || !userId) return;
  const consent: Consent = granted ? 'granted' : 'denied';
  await kv.setString(db, kv.userKey(userId, CONSENT_KEY), consent);
  set({ consent });
  await apply(consent);
  // Withdrawn (or declined): also forget the installation ID and anything not yet sent.
  if (!granted && available) await quietly(() => backend.reset());
}

/** Sends an event if the account agreed. Unknown events or parameters are dropped. */
export function track<E extends EventName>(
  name: E,
  ...[params]: keyof EventParams<E> extends never ? [] : [EventParams<E>]
): void {
  if (!available) return;
  const clean = sanitize(name, params);
  if (!clean) {
    if (__DEV__) console.warn(`Analytics: "${name}" dropped, its parameters aren't allowed`);
    return;
  }
  const { consent } = get();
  if (consent === 'granted') void quietly(() => backend.logEvent(name, clean));
  else if (consent !== 'denied' && pending.length < MAX_PENDING) pending.push({ name, params: clean });
}

/** Sets an anonymous user property (sent once the account agreed). */
export function setUserProperty<P extends UserPropertyName>(name: P, value: UserPropertyValue<P>): void {
  if (!available || !isAllowedUserProperty(name, value)) return;
  userProperties.set(name, value);
  if (get().consent === 'granted') void quietly(() => backend.setUserProperty(name, value));
}

async function apply(consent: Consent): Promise<void> {
  if (!available) {
    pending = [];
    return;
  }
  // Not asked yet: collection stays off and events keep waiting for the answer.
  if (consent === 'unset') return;
  if (consent === 'denied') {
    pending = [];
    await quietly(() => backend.setEnabled(false));
    return;
  }
  await quietly(() => backend.setEnabled(true));
  for (const [name, value] of userProperties) await quietly(() => backend.setUserProperty(name, value));
  const queued = pending;
  pending = [];
  for (const e of queued) await quietly(() => backend.logEvent(e.name, e.params));
}

/** Analytics never breaks the app: native failures are logged and ignored. */
async function quietly(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.warn('Analytics call failed', error);
  }
}

/** Tests only: swap in a fake backend. */
export function __setBackendForTests(fake: AnalyticsBackend, isAvailable = true): void {
  backend = fake;
  available = isAvailable;
  db = null;
  userId = null;
  pending = [];
  userProperties.clear();
  set({ consent: null });
}
