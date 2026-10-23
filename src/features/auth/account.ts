import type { User } from '@supabase/supabase-js';

export type AuthProvider = 'apple' | 'google' | 'facebook' | 'email';

/** What the device remembers about the signed-in account, so it works offline. */
export type LocalAccount = {
  id: string;
  email: string | null;
  name: string | null;
  provider: AuthProvider;
};

const asString = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const time = (v: string | undefined) => (v ? Date.parse(v) || 0 : 0);

/**
 * The provider of the sign-in that is happening now. app_metadata.provider stays the one the
 * account was created with, so with Apple linked to a Google account it still says google; each
 * identity's updated_at moves on every sign-in with it, so the newest identity is the one in use.
 */
function currentProvider(user: User): string | null {
  const latest = [...(user.identities ?? [])].sort((a, b) => time(b.updated_at) - time(a.updated_at))[0];
  return asString(latest?.provider) ?? asString(user.app_metadata?.provider);
}

export function accountFromUser(user: User): LocalAccount {
  const meta = user.user_metadata ?? {};
  let providerRaw = currentProvider(user);
  // Facebook on Android signs in through our Edge Function, which Supabase records as email.
  if (providerRaw === 'email' && user.app_metadata?.signed_up_with === 'facebook') providerRaw = 'facebook';
  const provider: AuthProvider =
    providerRaw === 'apple' || providerRaw === 'google' || providerRaw === 'facebook' ? providerRaw : 'email';
  return {
    id: user.id,
    email: user.email ?? null,
    name: asString(meta.full_name) ?? asString(meta.name) ?? null,
    provider,
  };
}

/** Name shown on the profile card: real name, else the email's local part. */
export function displayName(account: LocalAccount): string {
  if (account.name) return account.name;
  if (account.email) return account.email.split('@')[0];
  return 'Reader';
}
