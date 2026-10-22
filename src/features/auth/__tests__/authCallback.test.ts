import { redirectSystemPath } from '@/app/+native-intent';

import { AUTH_REDIRECT, isAuthCallback } from '../authCallback';

describe('isAuthCallback', () => {
  it('matches the web sign-in return link in the forms the router passes', () => {
    expect(isAuthCallback(AUTH_REDIRECT)).toBe(true);
    expect(isAuthCallback(`${AUTH_REDIRECT}?code=abc`)).toBe(true);
    expect(isAuthCallback('/auth/callback?code=abc')).toBe(true);
    expect(isAuthCallback('auth/callback#error=access_denied')).toBe(true);
  });

  it('leaves other links alone', () => {
    expect(isAuthCallback('ownbooks://book/123')).toBe(false);
    expect(isAuthCallback('/auth/callbacks')).toBe(false);
    expect(isAuthCallback('/player')).toBe(false);
  });
});

describe('redirectSystemPath', () => {
  it('stays on the current screen for the return link while the app is open', () => {
    expect(redirectSystemPath({ path: `${AUTH_REDIRECT}?code=abc`, initial: false })).toBeNull();
  });

  it('goes to the start screen when the return link opens the app', () => {
    expect(redirectSystemPath({ path: `${AUTH_REDIRECT}?code=abc`, initial: true })).toBe('/');
  });

  it('passes every other link through', () => {
    expect(redirectSystemPath({ path: '/player', initial: false })).toBe('/player');
  });
});
