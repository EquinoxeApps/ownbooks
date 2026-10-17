import 'react-native-url-polyfill/auto';
import './cryptoPolyfill';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from './env';
import { createChunkedStorage } from './secureStorage';

/**
 * The only Supabase client in the app. Auth uses it directly; table access is
 * reserved for src/features/sync. Null when the build has no backend config.
 */
export const supabase: SupabaseClient | null =
  env.supabaseUrl && env.supabaseAnonKey
    ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: {
          storage: createChunkedStorage(),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          // Web sign-ins (Apple on Android) return a code to exchange; ID-token and OTP flows are unaffected.
          flowType: 'pkce',
        },
      })
    : null;

if (supabase) {
  // Only refresh tokens while the app is in the foreground.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
