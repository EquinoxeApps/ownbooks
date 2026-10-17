// Signs in with a Facebook access token from the Facebook SDK on Android.
//
// Supabase's own signInWithIdToken only accepts Facebook Limited Login JWTs, which the Android SDK
// can't produce. This function verifies the access token with Facebook (it must be valid and
// issued to our App ID), finds or creates the OwnBooks account for the person's email, and returns
// a one-time token hash the app exchanges with auth.verifyOtp({ type: 'email' }).
//
// Secrets: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase). Deployed with verify_jwt off: the app sends a publishable key, which isn't
// a JWT, and the Facebook check above is what authenticates the request.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { FacebookSignInError, verifyFacebookToken } from './verify.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const appId = Deno.env.get('FACEBOOK_APP_ID');
  const appSecret = Deno.env.get('FACEBOOK_APP_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!appId || !appSecret || !url || !serviceKey) return json({ error: 'not_configured' }, 500);

  let accessToken: unknown;
  try {
    ({ accessToken } = await req.json());
  } catch {
    // Handled below.
  }
  if (typeof accessToken !== 'string') return json({ error: 'invalid_token' }, 400);

  let profile;
  try {
    profile = await verifyFacebookToken(accessToken, { appId, appSecret, fetch, hmacSha256Hex });
  } catch (error) {
    if (error instanceof FacebookSignInError) {
      console.warn('facebook-sign-in rejected:', error.message);
      return json({ error: error.code }, error.code === 'facebook_unreachable' ? 502 : 401);
    }
    throw error;
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // New person: create a confirmed account (Facebook vouches for the email). Existing email:
  // sign in to that account, as Supabase's own Facebook login does for verified emails.
  const { error: createError } = await admin.auth.admin.createUser({
    email: profile.email,
    email_confirm: true,
    user_metadata: profile.name ? { full_name: profile.name } : {},
    app_metadata: { signed_up_with: 'facebook', facebook_id: profile.id },
  });
  if (createError && createError.code !== 'email_exists') {
    console.error('facebook-sign-in createUser failed:', createError.message);
    return json({ error: 'server_error' }, 500);
  }

  // A magic link without sending email: the app redeems its hashed token for a session.
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('facebook-sign-in generateLink failed:', error?.message);
    return json({ error: 'server_error' }, 500);
  }
  return json({ tokenHash });
});
