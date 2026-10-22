/** Where web sign-ins (Apple on Android) return to; must be in Supabase's redirect allow-list. */
export const AUTH_REDIRECT = 'ownbooks://auth/callback';

/**
 * Whether an incoming link is the web sign-in's return (`ownbooks://auth/callback?code=…`).
 * openAuthSessionAsync hands that link to the sign-in code, but Android also delivers it to the
 * router, which has no screen for it (see src/app/+native-intent.tsx).
 */
export function isAuthCallback(path: string): boolean {
  return /^(?:ownbooks:\/\/|\/)?auth\/callback(?:[/?#]|$)/.test(path);
}
