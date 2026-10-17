// Facebook token checks for the facebook-sign-in Edge Function. No Deno APIs here, so the same
// code is unit-tested with Jest (test/facebook-sign-in.test.ts).

export type FacebookProfile = { id: string; email: string; name: string | null };

export type FacebookSignInErrorCode = 'invalid_token' | 'no_email' | 'facebook_unreachable';

export class FacebookSignInError extends Error {
  constructor(public readonly code: FacebookSignInErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export type VerifyDeps = {
  appId: string;
  appSecret: string;
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** HMAC-SHA256 of `message` with `key`, as lowercase hex (Facebook's appsecret_proof). */
  hmacSha256Hex: (key: string, message: string) => Promise<string>;
};

const GRAPH = 'https://graph.facebook.com';

async function getJson(deps: VerifyDeps, url: string): Promise<Record<string, unknown>> {
  let res;
  try {
    res = await deps.fetch(url);
  } catch {
    throw new FacebookSignInError('facebook_unreachable');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Facebook answers a bad or expired token with a 4xx and an error object.
  if (!res.ok) throw new FacebookSignInError(res.status >= 500 ? 'facebook_unreachable' : 'invalid_token');
  return body;
}

/**
 * Proves an access token came from Facebook Login for *our* app, then reads the person's
 * Facebook ID, name and email.
 *  1. debug_token with the app access token: valid, issued to our App ID, for a user.
 *  2. /me with appsecret_proof, so the token only works together with our App Secret.
 */
export async function verifyFacebookToken(accessToken: string, deps: VerifyDeps): Promise<FacebookProfile> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(accessToken)) throw new FacebookSignInError('invalid_token', 'format');

  const appToken = `${deps.appId}|${deps.appSecret}`;
  const debug = await getJson(
    deps,
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`,
  );
  const data = (debug.data ?? {}) as Record<string, unknown>;
  if (data.is_valid !== true) throw new FacebookSignInError('invalid_token', 'not valid');
  if (String(data.app_id) !== deps.appId) throw new FacebookSignInError('invalid_token', 'other app');
  const userId = typeof data.user_id === 'string' ? data.user_id : null;
  if (!userId) throw new FacebookSignInError('invalid_token', 'no user');

  const proof = await deps.hmacSha256Hex(deps.appSecret, accessToken);
  const me = await getJson(
    deps,
    `${GRAPH}/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}&appsecret_proof=${proof}`,
  );
  if (me.id !== userId) throw new FacebookSignInError('invalid_token', 'user mismatch');
  const email = typeof me.email === 'string' ? me.email.trim().toLowerCase() : '';
  if (!email.includes('@')) throw new FacebookSignInError('no_email');
  return { id: userId, email, name: typeof me.name === 'string' && me.name.trim() ? me.name.trim() : null };
}
