import { useCallback, useRef, useState } from 'react';
import { apiFetch, getApiErrorMessage } from '../lib/api';
import { clearAllTokens, setAccessToken, setRefreshToken } from '../lib/token-store';
import { useSession, withSilentRefresh } from '../context/session';
import {
  normalizeEmail, normalizeFullName, normalizeLoginIdentifier,
  validateLoginPassword, validateNewPassword, validateOtp,
} from '../lib/auth-validation';

export type AuthSessionResult = {
  user: { id: string; role: string; displayName: string; phone?: string };
  profile_complete: boolean;
  needs_profile_completion: boolean;
  needs_email_verification?: false;
  access_token: string;
  refresh_token: string;
};
export type LoginResult = AuthSessionResult | {
  needs_email_verification: true;
  email: string;
};
type ProfileUpdateResult = {
  user?: { id: string; displayName: string };
  profile_complete: boolean;
};

export class AuthRequestError extends Error {
  constructor(message: string, public status: number, public retrySeconds: number | null = null) {
    super(message);
  }
}

async function readResponse<T>(res: Response, fallback: string, generic401 = false): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = generic401 && res.status === 401
      ? 'Invalid phone/email or password' : getApiErrorMessage(body, fallback);
    const wait = message.match(/wait\s+(\d+)\s+seconds/i);
    const retryHeader = Number(res.headers.get('Retry-After'));
    const retrySeconds = retryHeader > 0 ? retryHeader : wait ? Number(wait[1]) : null;
    throw new AuthRequestError(message, res.status, retrySeconds);
  }
  if (!body?.data || typeof body.data !== 'object') throw new Error(fallback);
  return body.data as T;
}

async function authPost<T>(path: string, payload: object, fallback: string, generic401 = false): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readResponse<T>(res, fallback, generic401);
}

export function useAuth() {
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const clearError = useCallback(() => setError(null), []);

  // Guard same-frame submissions before React updates the disabled button.
  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (inFlight.current) throw new Error('Please wait for the current request');
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try { return await operation(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to complete request');
      throw cause;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const establishSession = useCallback(async (result: AuthSessionResult) => {
    if (!result || typeof result.access_token !== 'string' || !result.access_token ||
        typeof result.refresh_token !== 'string' || !result.refresh_token) {
      throw new Error('Sign in failed: no valid session was returned. Please try again.');
    }
    await setAccessToken(result.access_token);
    await setRefreshToken(result.refresh_token);
    if (!(await session.refresh())) {
      await clearAllTokens();
      session.clear();
      throw new Error('Sign in succeeded but your session could not be established. Please try again or contact support.');
    }
    return result;
  }, [session]);

  const login = useCallback((identifier: string, password: string) => run(async () => {
    const normalized = normalizeLoginIdentifier(identifier);
    validateLoginPassword(password);
    const result = await authPost<LoginResult>('/api/v1/auth/login',
      { identifier: normalized, password }, 'Sign in failed', true);
    if (result.needs_email_verification) {
      normalizeEmail(result.email);
      return result;
    }
    return establishSession(result);
  }), [run, establishSession]);

  const verifyEmail = useCallback((email: string, code: string) => run(async () => {
    validateOtp(code);
    return establishSession(await authPost<AuthSessionResult>('/api/v1/auth/signup/verify',
      { email: normalizeEmail(email), otp_code: code }, 'Verification failed'));
  }), [run, establishSession]);

  const resendVerification = useCallback((email: string) => run(() =>
    authPost('/api/v1/auth/signup/resend', { email: normalizeEmail(email) }, 'Resend failed')),
  [run]);

  const requestPasswordReset = useCallback((identifier: string) => run(() =>
    authPost<{ delivery_email?: string }>('/api/v1/auth/password-reset/request',
      { identifier: normalizeLoginIdentifier(identifier) }, 'Could not send reset code')),
  [run]);

  const confirmPasswordReset = useCallback((identifier: string, code: string, password: string, confirmation: string) => run(async () => {
    validateOtp(code);
    validateNewPassword(password, confirmation);
    return establishSession(await authPost<AuthSessionResult>('/api/v1/auth/password-reset/confirm', {
      identifier: normalizeLoginIdentifier(identifier), otp_code: code,
      new_password: password, confirm_password: confirmation,
    }, 'Could not reset password'));
  }), [run, establishSession]);

  const signup = useCallback((name: string, phone: string, email: string, password: string, confirmation: string) => run(async () => {
    validateNewPassword(password, confirmation);
    const normalizedPhone = normalizeLoginIdentifier(phone);
    if (!normalizedPhone.startsWith('+1')) throw new Error('Please enter a valid 10 digit phone number');
    return authPost<{ email: string }>('/api/v1/auth/signup', {
      full_name: normalizeFullName(name), phone: normalizedPhone, email: normalizeEmail(email),
      password, confirm_password: confirmation,
    }, 'Sign up failed');
  }), [run]);

  const updateProfile = useCallback((fullName: string, email?: string) => run(async () => {
    const payload = {
      full_name: normalizeFullName(fullName),
      ...(email === undefined ? {} : { email: normalizeEmail(email) }),
    };
    const res = await withSilentRefresh(() => apiFetch('/api/v1/auth/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), session.refresh, session.clear);
    const result = await readResponse<ProfileUpdateResult>(res, 'Profile update failed');
    if (!(await session.refresh())) throw new Error('Your session could not be confirmed. Please sign in again.');
    return result;
  }), [run, session]);

  const logout = useCallback(() => run(async () => {
    try { await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {}); }
    finally { await clearAllTokens(); session.clear(); }
  }), [run, session]);

  return { login, verifyEmail, resendVerification, requestPasswordReset, confirmPasswordReset,
    signup, updateProfile, logout, loading, error, clearError };
}
