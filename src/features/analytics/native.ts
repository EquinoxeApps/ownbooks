import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The only code that talks to Firebase. Analytics and Crashlytics exist only in builds made with
 * the Firebase config files (app.config.ts sets `extra.analytics`); without them, and in tests,
 * every call is a no-op.
 */
export type AnalyticsBackend = {
  /** Turns collection on or off and sets consent mode: analytics storage follows the choice, ads stay denied. */
  setEnabled(enabled: boolean): Promise<void>;
  /** Forgets the app-instance ID and anything not yet sent (after a "no"). */
  reset(): Promise<void>;
  logEvent(name: string, params: Record<string, string | number>): Promise<void>;
  setUserProperty(name: string, value: string): Promise<void>;
};

export const isAnalyticsAvailable = Platform.OS !== 'web' && Constants.expoConfig?.extra?.analytics === true;

function load() {
  // Required lazily so a build without Firebase never touches the native modules.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const analytics = require('@react-native-firebase/analytics') as typeof import('@react-native-firebase/analytics');
  const crashlytics = require('@react-native-firebase/crashlytics') as typeof import('@react-native-firebase/crashlytics');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { analytics, crashlytics };
}

let firebase: ReturnType<typeof load> | null = null;
const fb = () => (firebase ??= load());

export const firebaseBackend: AnalyticsBackend = {
  async setEnabled(enabled) {
    const { analytics: a, crashlytics: c } = fb();
    const instance = a.getAnalytics();
    await a.setConsent(instance, {
      analytics_storage: enabled,
      ad_storage: false,
      ad_user_data: false,
      ad_personalization: false,
    });
    await a.setAnalyticsCollectionEnabled(instance, enabled);
    await c.setCrashlyticsCollectionEnabled(c.getCrashlytics(), enabled);
  },
  async reset() {
    const { analytics: a, crashlytics: c } = fb();
    await a.resetAnalyticsData(a.getAnalytics());
    await c.deleteUnsentReports(c.getCrashlytics());
  },
  async logEvent(name, params) {
    const { analytics: a } = fb();
    // Our own event names; the typed overloads only cover Google's recommended events.
    await (a.logEvent as (i: unknown, n: string, p: object) => Promise<void>)(a.getAnalytics(), name, params);
  },
  async setUserProperty(name, value) {
    const { analytics: a } = fb();
    await a.setUserProperty(a.getAnalytics(), name, value);
  },
};
