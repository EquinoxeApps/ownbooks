// Deletes the signed-in user's account (spec §4.1; required by both app stores).
//
// The caller sends its session token as `Authorization: Bearer <access token>` (supabase-js
// functions.invoke does this). The token is checked with Supabase Auth, then the auth user is
// deleted with the service role; every table cascades from auth.users, so all synced rows go too.
//
// Deployed with verify_jwt off, like facebook-sign-in: the token is verified here instead
// (getUser), which works with any of the project's JWT signing keys.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'not_configured' }, 500);

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);

  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
  if (deleteError) {
    console.error('delete-account failed:', deleteError.message);
    return json({ error: 'server_error' }, 500);
  }
  return json({ deleted: true });
});
