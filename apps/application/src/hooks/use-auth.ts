/**
 * useAuth - OTP-based login / logout for the mobile app.
 *
 * Auth flow (mirrors the web site):
 *   1. POST /api/v1/auth/otp/request  { phone }         -> sends OTP
 *   2. POST /api/v1/auth/otp/verify   { phone, otp_code } -> returns tokens
 *   3. Store tokens in expo-secure-store
 *   4. Refresh session context
 *
 * Profile completion (PUT /api/v1/auth/profile) is also handled here
 * for new users whose displayName hasn't been set yet.
 */
import { useCallback, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  clearAllTokens,
  setAccessToken,
  setRefreshToken,
} from "../lib/token-store";
import { useSession } from "../context/session";

type OtpRequestResult = {
  otp_sent: boolean;
  expires_in_seconds: number;
};

type OtpVerifyResult = {
  user: {
    id: string;
    role: string;
    displayName: string;
    phone?: string;
  };
  profile_complete: boolean;
  needs_profile_completion: boolean;
  access_token: string;
  refresh_token: string;
};

type ProfileUpdateResult = {
  user: { id: string; displayName: string };
  profile_complete: boolean;
};

export type UseAuthResult = {
  /** Step 1: Request OTP - sends a 6-digit code to the phone */
  requestOtp: (phone: string) => Promise<OtpRequestResult>;
  /** Step 2: Verify OTP - returns tokens + user profile */
  verifyOtp: (phone: string, otpCode: string) => Promise<OtpVerifyResult>;
  /** Complete profile for new users */
  updateProfile: (fullName: string, email?: string) => Promise<ProfileUpdateResult>;
  /** Logout */
  logout: () => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
};

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as {
    errors?: Array<{ message?: string }>;
    message?: string | string[];
    error?: string;
  };
  const firstEnvelopeMsg = candidate.errors?.[0]?.message?.trim();
  if (firstEnvelopeMsg) return firstEnvelopeMsg;
  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message.trim();
  }
  if (Array.isArray(candidate.message)) {
    const joined = candidate.message
      .filter((m): m is string => typeof m === "string")
      .map((m) => m.trim())
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  if (typeof candidate.error === "string" && candidate.error.trim()) {
    return candidate.error.trim();
  }
  return fallback;
}

export function useAuth(): UseAuthResult {
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  /* ---------------------------------------------------------------- */
  /*  Step 1: Request OTP                                              */
  /* ---------------------------------------------------------------- */
  const requestOtp = useCallback(async (phone: string): Promise<OtpRequestResult> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = extractErrorMessage(body, "Failed to send OTP");
        throw new Error(msg);
      }

      return (body?.data ?? body) as OtpRequestResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Step 2: Verify OTP                                               */
  /* ---------------------------------------------------------------- */
  const verifyOtp = useCallback(
    async (phone: string, otpCode: string): Promise<OtpVerifyResult> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/v1/auth/otp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, otp_code: otpCode }),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok) {
          const msg = extractErrorMessage(body, "OTP verification failed");
          throw new Error(msg);
        }

        const result = (body?.data ?? body) as OtpVerifyResult;

        // Store tokens from the response body
        if (result.access_token) {
          await setAccessToken(result.access_token);
        }
        if (result.refresh_token) {
          await setRefreshToken(result.refresh_token);
        }

        // Refresh the session context
        await session.refresh();

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  /* ---------------------------------------------------------------- */
  /*  Profile completion                                               */
  /* ---------------------------------------------------------------- */
  const updateProfile = useCallback(
    async (fullName: string, email?: string): Promise<ProfileUpdateResult> => {
      setLoading(true);
      setError(null);
      try {
        const payload: Record<string, string> = { full_name: fullName };
        if (email) payload.email = email;

        const res = await apiFetch("/api/v1/auth/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const body = await res.json().catch(() => null);

        if (!res.ok) {
          const msg = extractErrorMessage(body, "Profile update failed");
          throw new Error(msg);
        }

        await session.refresh();

        return (body?.data ?? body) as ProfileUpdateResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  /* ---------------------------------------------------------------- */
  /*  Logout                                                           */
  /* ---------------------------------------------------------------- */
  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    } finally {
      await clearAllTokens();
      session.clear();
      setLoading(false);
    }
  }, [session]);

  return { requestOtp, verifyOtp, updateProfile, logout, loading, error, clearError };
}
