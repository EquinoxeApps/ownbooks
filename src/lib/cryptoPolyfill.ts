import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

/**
 * supabase-js creates PKCE verifiers with crypto.getRandomValues (falling back to Math.random) and
 * hashes them with crypto.subtle.digest (falling back to a "plain" challenge). React Native has
 * neither, so web sign-ins (Apple on Android) would use a weak verifier and no SHA-256. Expo's
 * native implementations fill in exactly the two calls it makes. Import before creating the client.
 */
type CryptoLike = { getRandomValues?: unknown; subtle?: { digest?: unknown } };
const g = globalThis as { crypto?: CryptoLike };
const target: CryptoLike = g.crypto ?? (g.crypto = {});

if (typeof target.getRandomValues !== 'function') target.getRandomValues = getRandomValues;
if (typeof target.subtle?.digest !== 'function') {
  target.subtle = {
    digest: (algorithm: string | { name: string }, data: BufferSource) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase() !== 'SHA-256') throw new Error(`Unsupported digest: ${name}`);
      return digest(CryptoDigestAlgorithm.SHA256, data);
    },
  };
}
