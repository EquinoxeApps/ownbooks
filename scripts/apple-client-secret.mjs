// Prints the client secret Supabase needs for Sign in with Apple's web flow (Android): a JWT signed
// with the Sign in with Apple key (.p8). Apple accepts at most 6 months, so it has to be renewed;
// paste the output into Supabase → Authentication → Sign In / Providers → Apple → Secret Key.
//
//   node scripts/apple-client-secret.mjs --key-id <Key ID> --p8 <path to AuthKey_XXXX.p8>
//
// The .p8 is a private key: keep it in a password manager, never in the repo.

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'key-id': { type: 'string' },
    p8: { type: 'string' },
    'team-id': { type: 'string', default: 'K447M735N4' },
    'client-id': { type: 'string', default: 'app.equinoxe.ownbooks.signin' },
    days: { type: 'string', default: '180' },
  },
});

if (!values['key-id'] || !values.p8) {
  console.error('Usage: node scripts/apple-client-secret.mjs --key-id <Key ID> --p8 <AuthKey_XXXX.p8>');
  process.exit(1);
}

const days = Number(values.days);
if (!(days > 0 && days <= 180)) {
  console.error('--days must be between 1 and 180 (Apple allows at most 6 months).');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 60 * 60;
const b64url = (data) => Buffer.from(data).toString('base64url');

const header = b64url(JSON.stringify({ alg: 'ES256', kid: values['key-id'], typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({
    iss: values['team-id'],
    iat: now,
    exp,
    aud: 'https://appleid.apple.com',
    sub: values['client-id'],
  }),
);

const key = createPrivateKey(readFileSync(values.p8));
const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });

console.log(`${header}.${payload}.${b64url(signature)}`);
console.error(`Expires ${new Date(exp * 1000).toISOString().slice(0, 10)}: renew it before then.`);
