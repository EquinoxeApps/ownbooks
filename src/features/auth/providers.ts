import {
  FunctionsFetchError,
  FunctionsHttpError,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { openAuthSessionAsync } from 'expo-web-browser';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/** i18n keys under auth.* for errors shown to the user. */
export type AuthErrorKey =
  | 'errors.offline'
  | 'errors.notConfigured'
  | 'errors.providerUnavailable'
  | 'errors.rateLimited'
  | 'errors.generic'
  | 'verify.invalid'
  | 'password.wrong'
  | 'password.tooShort'
  | 'password.leaked'
  | 'password.weak'
  | 'createAccount.exists'
  | 'facebook.noEmail';

export class AuthFlowError extends Error {
  constructor(public readonly key: AuthErrorKey, cause?: unknown) {
    super(key, { cause });
  }
}

/** Thrown when the user backs out of a native sign-in sheet. Not an error to show. */
export class AuthCancelled extends Error {}

function client() {
  if (!supabase) throw new AuthFlowError('errors.notConfigured');
  return supabase;
}

export function toAuthError(error: unknown, fallback: AuthErrorKey = 'errors.generic'): AuthFlowError {
  if (error instanceof AuthFlowError) return error;
  if (isAuthRetryableFetchError(error)) return new AuthFlowError('errors.offline', error);
  // supabase-js reports a refused password as its own error class, not as an AuthApiError.
  if (isAuthWeakPasswordError(error)) {
    if (error.reasons.includes('pwned')) return new AuthFlowError('password.leaked', error);
    if (error.reasons.includes('length')) return new AuthFlowError('password.tooShort', error);
    return new AuthFlowError('password.weak', error);
  }
  if (isAuthApiError(error)) {
    if (error.status === 429) return new AuthFlowError('errors.rateLimited', error);
    if (error.code === 'invalid_credentials') return new AuthFlowError('password.wrong', error);
    if (error.code === 'otp_expired') return new AuthFlowError('verify.invalid', error);
  }
  if (error instanceof TypeError && /network/i.test(error.message)) {
    return new AuthFlowError('errors.offline', error);
  }
  return new AuthFlowError(fallback, error);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches the project's minimum (supabase/config.toml); the server also rejects leaked passwords. */
export const MIN_PASSWORD_LENGTH = 8;

/** Checked before any request, so a reset never verifies its code with a password the server refuses. */
export function passwordProblem(password: string): AuthErrorKey | null {
  return password.length < MIN_PASSWORD_LENGTH ? 'password.tooShort' : null;
}

/** Signs in with email + password. An account that never confirmed its email gets a new code instead. */
export async function signInWithEmail(email: string, password: string): Promise<'signedIn' | 'confirmEmail'> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return 'signedIn';
  if (isAuthApiError(error) && error.code === 'email_not_confirmed') {
    await resendSignUpCode(email);
    return 'confirmEmail';
  }
  throw toAuthError(error);
}

/**
 * Creates an email + password account. Supabase hides whether an address is taken (it answers
 * with a user that has no identities and sends no email), so that case is reported here.
 */
export async function createAccount(email: string, password: string): Promise<'signedIn' | 'confirmEmail'> {
  const problem = passwordProblem(password);
  if (problem) throw new AuthFlowError(problem);
  const { data, error } = await client().auth.signUp({ email: email.trim(), password });
  if (error) throw toAuthError(error);
  if (data.user && (data.user.identities?.length ?? 0) === 0) throw new AuthFlowError('createAccount.exists');
  return data.session ? 'signedIn' : 'confirmEmail';
}

export async function confirmSignUp(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'signup' });
  if (error) throw toAuthError(error, 'verify.invalid');
}

export async function resendSignUpCode(email: string): Promise<void> {
  const { error } = await client().auth.resend({ type: 'signup', email: email.trim() });
  if (error) throw toAuthError(error);
}

export async function sendResetCode(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim());
  if (error) throw toAuthError(error);
}

/**
 * Checks a reset code. This creates a session but emits PASSWORD_RECOVERY, which AuthBridge
 * ignores, so the user stays on the reset screen until the new password is saved.
 */
export async function verifyResetCode(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'recovery' });
  if (error) throw toAuthError(error, 'verify.invalid');
}

/** Saves a new password; the USER_UPDATED event that follows signs the user in. */
export async function setNewPassword(password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new AuthFlowError(problem);
  const { error } = await client().auth.updateUser({ password });
  if (error) throw toAuthError(error);
}

export const isAppleSignInSupported = Platform.OS === 'ios' || (Platform.OS === 'android' && env.appleWebSignIn);
export const isGoogleSignInConfigured = Boolean(
  env.googleWebClientId && (Platform.OS !== 'ios' || env.googleIosClientId),
);
export const isFacebookSignInConfigured = Boolean(env.facebookAppId);

/** Where web sign-ins (Apple on Android) return to; must be in Supabase's redirect allow-list. */
export const AUTH_REDIRECT = 'ownbooks://auth/callback';

export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== 'ios') return signInWithAppleWeb();
  const auth = client();
  // Apple gets the SHA-256 of the nonce; Supabase verifies it against the raw value.
  const rawNonce = randomUUID();
  const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthCancelled();
    throw toAuthError(e);
  }
  if (!credential.identityToken) throw new AuthFlowError('errors.generic');

  const { error } = await auth.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw toAuthError(error);

  // Apple only shares the name on the very first authorization.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ');
  if (fullName) await auth.auth.updateUser({ data: { full_name: fullName } });
}

/** Apple has no native sign-in on Android, so its web sign-in runs in a secure browser tab (PKCE). */
async function signInWithAppleWeb(): Promise<void> {
  const auth = client().auth;
  const { data, error } = await auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw toAuthError(error);
  const result = await openAuthSessionAsync(data.url, AUTH_REDIRECT);
  if (result.type !== 'success') throw new AuthCancelled();
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new AuthFlowError('errors.generic');
  const { error: exchangeError } = await auth.exchangeCodeForSession(code);
  if (exchangeError) throw toAuthError(exchangeError);
}

export async function signInWithGoogle(): Promise<void> {
  const auth = client();
  if (!isGoogleSignInConfigured) throw new AuthFlowError('errors.providerUnavailable');
  // Loaded lazily: the native module isn't present until Google sign-in is configured.
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await import(
    '@react-native-google-signin/google-signin'
  );
  GoogleSignin.configure({
    webClientId: env.googleWebClientId,
    iosClientId: env.googleIosClientId,
  });
  let idToken: string | null = null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new AuthCancelled();
    idToken = response.data.idToken;
  } catch (e) {
    if (e instanceof AuthCancelled) throw e;
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) throw new AuthCancelled();
    throw toAuthError(e);
  }
  if (!idToken) throw new AuthFlowError('errors.generic');
  const { error } = await auth.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw toAuthError(error);
}

/**
 * Facebook through its SDK. Supabase's signInWithIdToken only accepts Facebook Limited Login
 * JWTs, which the Android SDK can't produce, so the access token goes to our facebook-sign-in
 * Edge Function: it checks the token with Facebook and returns a one-time token hash, redeemed
 * here for a session. The SDK doesn't log app events or collect the advertising ID, starts only
 * when the button is tapped, and is logged out straight after, so it keeps no session of its own.
 */
export async function signInWithFacebook(): Promise<void> {
  const supa = client();
  if (!isFacebookSignInConfigured) throw new AuthFlowError('errors.providerUnavailable');
  const { AccessToken, LoginManager, Settings } = await import('react-native-fbsdk-next');
  let token: string | undefined;
  try {
    Settings.initializeSDK();
    const result = await LoginManager.logInWithPermissions(['public_profile', 'email']);
    if (result.isCancelled) throw new AuthCancelled();
    token = (await AccessToken.getCurrentAccessToken())?.accessToken;
  } catch (e) {
    if (e instanceof AuthCancelled) throw e;
    throw toAuthError(e);
  }
  if (!token) throw new AuthFlowError('errors.generic');
  try {
    const { data, error } = await supa.functions.invoke<{ tokenHash?: string }>('facebook-sign-in', {
      body: { accessToken: token },
    });
    if (error) throw await facebookError(error);
    if (!data?.tokenHash) throw new AuthFlowError('errors.generic');
    const { error: verifyError } = await supa.auth.verifyOtp({ token_hash: data.tokenHash, type: 'email' });
    if (verifyError) throw toAuthError(verifyError);
  } finally {
    LoginManager.logOut();
  }
}

/** Maps the Edge Function's { error } reply; anything unexpected is a generic failure. */
async function facebookError(error: unknown): Promise<AuthFlowError> {
  if (error instanceof FunctionsFetchError) return new AuthFlowError('errors.offline', error);
  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => null);
    if (body?.error === 'no_email') return new AuthFlowError('facebook.noEmail', error);
  }
  return new AuthFlowError('errors.generic', error);
}

/** Signs this device out only. Local files stay; the library is hidden until sign-in. */
export async function signOutRemote(): Promise<void> {
  if (!supabase) return;
  // Even if the network call fails, the local session is cleared.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
