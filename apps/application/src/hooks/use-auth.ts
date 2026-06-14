import { useCallback, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  clearAllTokens,
  setAccessToken,
  setRefreshToken,
} from "../lib/token-store";
import { useSession } from "../context/session";

type LoginResult = {
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
  login: (identifier: string, password: string) => Promise<LoginResult>;
  updateProfile: (fullName: string) => Promise<ProfileUpdateResult>;
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

  const login = useCallback(
    async (identifier: string, password: string): Promise<LoginResult> => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(extractErrorMessage(body, "Sign in failed"));
        }

        const result = (body?.data ?? body) as LoginResult;
        if (result.access_token) await setAccessToken(result.access_token);
        if (result.refresh_token) await setRefreshToken(result.refresh_token);
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

  const updateProfile = useCallback(
    async (fullName: string): Promise<ProfileUpdateResult> => {
      setLoading(true);
      setError(null);
      try {
        const payload: Record<string, string> = { full_name: fullName };

        const res = await apiFetch("/api/v1/auth/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(extractErrorMessage(body, "Profile update failed"));
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

  return { login, updateProfile, logout, loading, error, clearError };
}
