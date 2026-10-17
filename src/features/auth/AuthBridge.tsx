import { getNetworkStateAsync } from 'expo-network';
import { useEffect, useState, type ReactNode } from 'react';

import { useDb } from '@/db/provider';
import { unload as unloadPlayer } from '@/features/player/controller';
import { bootStep } from '@/lib/boot';
import { supabase } from '@/lib/supabase';

import { accountFromUser } from './account';
import { useAuthStore } from './store';

/**
 * Loads the local account state, then mirrors Supabase auth events into it.
 * Network trouble never signs the user out; only an explicit sign-out or a
 * session that's provably gone while online does.
 */
export function AuthBridge({ children }: { children: ReactNode }) {
  const db = useDb();
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const store = useAuthStore.getState();

    bootStep('loading account');
    const ready = store.hydrate(db).then(
      () => bootStep('account loaded'),
      (e: unknown) => {
        // Surface to the startup error boundary instead of hanging on the splash.
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    if (!supabase) {
      bootStep('no backend configured');
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase advises against awaiting inside this callback, so defer.
      setTimeout(async () => {
        await ready;
        if (cancelled) return;
        bootStep(`auth event ${event}`);
        const { signedIn, signedOut, account } = useAuthStore.getState();
        // A verified reset code creates a session, but the user is only signed in once the
        // new password is saved (the USER_UPDATED event that follows).
        if (event === 'PASSWORD_RECOVERY') return;
        if (session?.user) {
          await signedIn(db, accountFromUser(session.user));
          return;
        }
        if (event === 'SIGNED_OUT') {
          await signedOut(db);
          return;
        }
        if (event === 'INITIAL_SESSION' && account) {
          // No stored session but a remembered account: only sign out when
          // online, where a missing session can't be a connectivity problem.
          const net = await getNetworkStateAsync().catch(() => null);
          if (net?.isInternetReachable) await signedOut(db);
        }
      }, 0);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [db]);

  // Signing out (or a different account) stops playback and clears lock-screen controls.
  useEffect(
    () =>
      useAuthStore.subscribe((state, prev) => {
        if (prev.account && state.account?.id !== prev.account.id) void unloadPlayer();
      }),
    [],
  );

  if (error) throw error;
  return children;
}
