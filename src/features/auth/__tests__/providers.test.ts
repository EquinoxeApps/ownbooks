import { AuthApiError, AuthWeakPasswordError } from '@supabase/supabase-js';

const mockAuth = {
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  resend: jest.fn(),
  verifyOtp: jest.fn(),
  updateUser: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};

// A getter, because the import of ../providers is hoisted above mockAuth's definition.
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return { auth: mockAuth };
  },
}));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

// eslint-disable-next-line import/first
import {
  createAccount,
  setNewPassword,
  signInWithEmail,
  toAuthError,
} from '../providers';

const apiError = (code: string, status = 400) => new AuthApiError(code, status, code);
// What supabase-js actually returns for a refused password (a separate class, not AuthApiError).
const weak = (...reasons: ('length' | 'characters' | 'pwned')[]) =>
  new AuthWeakPasswordError('Password is known to be weak', 422, reasons);

beforeEach(() => {
  for (const fn of Object.values(mockAuth)) fn.mockReset();
});

describe('signInWithEmail', () => {
  it('signs in, trimming the email', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(signInWithEmail('  a@b.co ', 'secret123')).resolves.toBe('signedIn');
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret123' });
  });

  it('reports a wrong password', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ error: apiError('invalid_credentials') });
    await expect(signInWithEmail('a@b.co', 'nope')).rejects.toMatchObject({ key: 'password.wrong' });
  });

  it('sends a new code when the email was never confirmed', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ error: apiError('email_not_confirmed') });
    mockAuth.resend.mockResolvedValue({ error: null });
    await expect(signInWithEmail('a@b.co', 'secret123')).resolves.toBe('confirmEmail');
    expect(mockAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.co' });
  });
});

describe('createAccount', () => {
  it('asks for the code when confirmations are on', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    await expect(createAccount('a@b.co', 'longenough')).resolves.toBe('confirmEmail');
  });

  it('reports an address that already has an account (no identities, no email sent)', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    await expect(createAccount('a@b.co', 'longenough')).rejects.toMatchObject({ key: 'createAccount.exists' });
  });

  it('rejects a short password before calling the server', async () => {
    await expect(createAccount('a@b.co', 'short')).rejects.toMatchObject({ key: 'password.tooShort' });
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });
});

describe('setNewPassword', () => {
  it('maps a leaked password to its own message', async () => {
    mockAuth.updateUser.mockResolvedValue({ error: weak('pwned') });
    await expect(setNewPassword('longenough')).rejects.toMatchObject({ key: 'password.leaked' });
  });

  it('never calls the server with a password that is too short', async () => {
    await expect(setNewPassword('short')).rejects.toMatchObject({ key: 'password.tooShort' });
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
  });
});

describe('toAuthError', () => {
  it('maps rate limits, expired codes and weak passwords', () => {
    expect(toAuthError(apiError('over_request_rate_limit', 429)).key).toBe('errors.rateLimited');
    expect(toAuthError(apiError('otp_expired', 403)).key).toBe('verify.invalid');
    expect(toAuthError(weak('length')).key).toBe('password.tooShort');
    expect(toAuthError(weak('characters')).key).toBe('password.weak');
  });
});
