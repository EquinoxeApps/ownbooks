/**
 * @jest-environment node
 */
import { createHmac } from 'node:crypto';

import { FacebookSignInError, verifyFacebookToken, type VerifyDeps } from '../supabase/functions/facebook-sign-in/verify';

const APP_ID = '1419717433706997';
const SECRET = 'test-secret';
const TOKEN = 'EAAUtestTOKEN1234567890abcdef';

type Reply = { status?: number; body: unknown };

/** Fake Graph API: answers debug_token and /me, and records the URLs it was asked for. */
function graph(debug: Reply, me: Reply) {
  const urls: string[] = [];
  const deps: VerifyDeps = {
    appId: APP_ID,
    appSecret: SECRET,
    hmacSha256Hex: async (key, message) => createHmac('sha256', key).update(message).digest('hex'),
    fetch: async (url) => {
      urls.push(url);
      const reply = url.includes('/debug_token') ? debug : me;
      const status = reply.status ?? 200;
      return { ok: status < 400, status, json: async () => reply.body };
    },
  };
  return { deps, urls };
}

const validDebug = { body: { data: { is_valid: true, app_id: APP_ID, user_id: '42' } } };

describe('verifyFacebookToken', () => {
  it('accepts a valid token for our app and returns the profile', async () => {
    const { deps, urls } = graph(validDebug, { body: { id: '42', name: ' Jane Austen ', email: 'Jane@Example.com' } });
    await expect(verifyFacebookToken(TOKEN, deps)).resolves.toEqual({
      id: '42',
      email: 'jane@example.com',
      name: 'Jane Austen',
    });
    // The profile request carries appsecret_proof, so the token only works with our secret.
    const proof = createHmac('sha256', SECRET).update(TOKEN).digest('hex');
    expect(urls[1]).toContain(`appsecret_proof=${proof}`);
    expect(urls[0]).toContain(encodeURIComponent(`${APP_ID}|${SECRET}`));
  });

  it('rejects a token issued to another app', async () => {
    const { deps } = graph({ body: { data: { is_valid: true, app_id: '999', user_id: '42' } } }, { body: {} });
    await expect(verifyFacebookToken(TOKEN, deps)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects an invalid or expired token', async () => {
    const { deps } = graph({ body: { data: { is_valid: false, app_id: APP_ID } } }, { body: {} });
    await expect(verifyFacebookToken(TOKEN, deps)).rejects.toMatchObject({ code: 'invalid_token' });
    const bad = graph({ status: 400, body: { error: { message: 'Invalid OAuth access token' } } }, { body: {} });
    await expect(verifyFacebookToken(TOKEN, bad.deps)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('rejects a profile for a different user than the token', async () => {
    const { deps } = graph(validDebug, { body: { id: '43', email: 'x@example.com' } });
    await expect(verifyFacebookToken(TOKEN, deps)).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('reports a Facebook account without an email', async () => {
    const { deps } = graph(validDebug, { body: { id: '42', name: 'No Email' } });
    await expect(verifyFacebookToken(TOKEN, deps)).rejects.toMatchObject({ code: 'no_email' });
  });

  it('rejects garbage before calling Facebook, and reports Facebook being down', async () => {
    const { deps, urls } = graph(validDebug, { body: {} });
    await expect(verifyFacebookToken('a.b.c', deps)).rejects.toBeInstanceOf(FacebookSignInError);
    expect(urls).toHaveLength(0);
    const down = graph({ status: 503, body: {} }, { body: {} });
    await expect(verifyFacebookToken(TOKEN, down.deps)).rejects.toMatchObject({ code: 'facebook_unreachable' });
  });
});
