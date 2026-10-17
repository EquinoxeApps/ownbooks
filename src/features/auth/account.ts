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

export function accountFromUser(user: User): LocalAccount {
  const meta = user.user_metadata ?? {};
  const providerRaw = asString(user.app_metadata?.provider);
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
