import type { User } from '@supabase/supabase-js';

import { accountFromUser, displayName } from '../account';

const user = (overrides: Partial<User>): User =>
  ({
    id: 'u1',
    aud: 'authenticated',
    created_at: '',
    app_metadata: {},
    user_metadata: {},
    ...overrides,
  }) as User;

describe('accountFromUser', () => {
  it('maps provider and name from metadata', () => {
    expect(
      accountFromUser(
        user({ email: 'a@b.co', app_metadata: { provider: 'apple' }, user_metadata: { full_name: ' Ada ' } }),
      ),
    ).toEqual({ id: 'u1', email: 'a@b.co', name: 'Ada', provider: 'apple' });
  });

  it('uses the identity signed in with most recently, not the one the account was created with', () => {
    const identity = (provider: string, updated_at: string) => ({ provider, updated_at }) as never;
    const linked = user({
      app_metadata: { provider: 'google', providers: ['google', 'apple'] },
      identities: [identity('google', '2026-10-22T22:16:06Z'), identity('apple', '2026-10-23T07:37:52Z')],
    });
    expect(accountFromUser(linked).provider).toBe('apple');

    const backToGoogle = user({
      app_metadata: { provider: 'google' },
      identities: [identity('google', '2026-10-24T08:00:00Z'), identity('apple', '2026-10-23T07:37:52Z')],
    });
    expect(accountFromUser(backToGoogle).provider).toBe('google');
  });

  it('reports Facebook for accounts our Edge Function signs in by email', () => {
    const facebook = user({
      app_metadata: { provider: 'email', signed_up_with: 'facebook' },
      identities: [{ provider: 'email', updated_at: '2026-10-17T11:00:00Z' } as never],
    });
    expect(accountFromUser(facebook).provider).toBe('facebook');
  });

  it('treats unknown providers as email', () => {
    expect(accountFromUser(user({ app_metadata: { provider: 'email' } })).provider).toBe('email');
    expect(accountFromUser(user({ app_metadata: { provider: 'github' } })).provider).toBe('email');
  });
});

describe('displayName', () => {
  it('prefers the name, then the email local part', () => {
    expect(displayName({ id: '1', email: 'reader@x.io', name: 'Ada', provider: 'email' })).toBe('Ada');
    expect(displayName({ id: '1', email: 'reader@x.io', name: null, provider: 'email' })).toBe('reader');
    expect(displayName({ id: '1', email: null, name: null, provider: 'apple' })).toBe('Reader');
  });
});
