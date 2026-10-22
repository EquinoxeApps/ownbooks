// EXPO_PUBLIC_* variables are inlined at build time, so each one must be read
// with a static `process.env.NAME` expression.

const clean = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : undefined);

export const env = {
  supabaseUrl: clean(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  googleWebClientId: clean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  googleIosClientId: clean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
  facebookAppId: clean(process.env.EXPO_PUBLIC_FACEBOOK_APP_ID),
  /** Apple's web sign-in on Android; needs an Apple Services ID configured in Supabase. */
  appleWebSignIn: process.env.EXPO_PUBLIC_APPLE_WEB_SIGN_IN === '1',
  legalBaseUrl:
    clean(process.env.EXPO_PUBLIC_LEGAL_BASE_URL) ?? 'https://equinoxeapps.github.io/ownbooks',
} as const;

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
