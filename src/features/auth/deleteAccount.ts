import { FunctionsFetchError } from '@supabase/supabase-js';

import type { Db } from '@/db/types';
import { track } from '@/features/analytics';
import { unload as unloadPlayer } from '@/features/player/controller';
import { stopSync } from '@/features/sync/service';
import { supabase } from '@/lib/supabase';

import { removeLocalDataFor } from './otherAccounts';
import { AuthFlowError, signOutRemote } from './providers';
import { useAuthStore } from './store';

/**
 * Deletes the account (spec §4.1): the server deletes the auth user and every synced row
 * (the delete-account Edge Function), then this phone forgets the account and its books.
 * Nothing local is touched unless the server deletion succeeded.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  if (!supabase) throw new AuthFlowError('errors.notConfigured');
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    throw new AuthFlowError(error instanceof FunctionsFetchError ? 'errors.offline' : 'errors.generic', error);
  }
  track('account_deleted');
  stopSync();
  await unloadPlayer();
  await removeLocalDataFor(db, [userId]);
  await signOutRemote();
  await useAuthStore.getState().signedOut(db);
}
