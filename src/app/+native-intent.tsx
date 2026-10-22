import { isAuthCallback } from '@/features/auth/authCallback';

// Expo Router opens every incoming link as a screen. The web sign-in's return link is consumed by
// the sign-in code instead, so it must not navigate: null keeps the current screen. If the link
// starts the app (the sign-in was lost with the process), go to the start screen.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (isAuthCallback(path)) return initial ? '/' : null;
    return path;
  } catch {
    return initial ? '/' : null;
  }
}
