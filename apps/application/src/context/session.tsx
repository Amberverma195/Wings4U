/**
 * Session context - ported from `apps/web/src/lib/session.tsx`.
 *
 * Key differences from the web version:
 *   - No `usePathname` / `useRouter` from next/navigation - uses expo-router.
 *   - No DOM events (focus, visibilitychange, pageshow) - uses React Native
 *     AppState instead.
 *   - No `window.localStorage` cross-tab events - mobile is single-instance.
 *   - Auth uses Bearer tokens via `apiFetch()` (set in token-store), not cookies.
 *   - Silent refresh sends refresh token from secure store, not httpOnly cookie.
 *
 * The useState/useEffect/useCallback patterns are preserved as-is so you can
 * copy-paste component logic between web and mobile.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { apiFetch } from "../lib/api";
import {
  clearAllTokens,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from "../lib/token-store";
import type { ApiEnvelope } from "@wings4u/contracts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  role: string;
  employeeRole?: string;
  displayName: string;
  phone?: string;
  email?: string;
}

export interface SessionState {
  /** null while the initial fetch is in-flight */
  loaded: boolean;
  authenticated: boolean;
  user: SessionUser | null;
  profileComplete: boolean;
  needsProfileCompletion: boolean;
  /** Re-fetch session from server */
  refresh: () => Promise<void>;
  /** Clear local session (on logout) */
  clear: () => void;
}

interface SessionApiResponse {
  authenticated: boolean;
  user?: SessionUser;
  profile_complete: boolean;
  needs_profile_completion: boolean;
}

const SIGNED_OUT_SESSION: SessionApiResponse = {
  authenticated: false,
  profile_complete: false,
  needs_profile_completion: false,
};

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const SessionContext = createContext<SessionState>({
  loaded: false,
  authenticated: false,
  user: null,
  profileComplete: false,
  needsProfileCompletion: false,
  refresh: async () => {},
  clear: () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<SessionApiResponse>(SIGNED_OUT_SESSION);

  const applySignedOut = useCallback(() => {
    setData(SIGNED_OUT_SESSION);
    setLoaded(true);
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/auth/session");
      if (res.ok) {
        const envelope =
          (await res.json()) as ApiEnvelope<SessionApiResponse>;
        setData(envelope.data ?? SIGNED_OUT_SESSION);
      } else if (res.status === 401 || res.status === 403) {
        applySignedOut();
      }
    } catch {
      // Session fetch is best-effort; stay signed out on failure
    } finally {
      setLoaded(true);
    }
  }, [applySignedOut]);

  // Initial session fetch
  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  // Re-fetch when app comes back to foreground (replaces web's focus/visibilitychange)
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void fetchSession();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );
    return () => {
      subscription.remove();
    };
  }, [fetchSession]);

  const clear = useCallback(() => {
    applySignedOut();
    void clearAllTokens();
  }, [applySignedOut]);

  const value = useMemo<SessionState>(
    () => ({
      loaded,
      authenticated: data.authenticated,
      user: data.user ?? null,
      profileComplete: data.profile_complete,
      needsProfileCompletion: data.needs_profile_completion,
      refresh: fetchSession,
      clear,
    }),
    [loaded, data, fetchSession, clear]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Silent refresh helper                                              */
/* ------------------------------------------------------------------ */

let inFlightRefresh: Promise<{ refreshed: boolean }> | null = null;

async function performRefresh(): Promise<{ refreshed: boolean }> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return { refreshed: false };

      const refreshRes = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!refreshRes.ok) {
        return { refreshed: false };
      }
      const envelope = (await refreshRes.json()) as ApiEnvelope<{
        refreshed: boolean;
        access_token?: string;
        refresh_token?: string;
      }>;
      if (envelope.data?.access_token) {
        await setAccessToken(envelope.data.access_token);
      }
      if (envelope.data?.refresh_token) {
        await setRefreshToken(envelope.data.refresh_token);
      }
      return { refreshed: envelope.data?.refreshed === true };
    } catch {
      return { refreshed: false };
    }
  })();

  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

/**
 * Wraps an API call with one-time silent refresh on 401.
 * If refresh succeeds, the original call is retried once.
 * If refresh fails, the session is cleared and the error propagates.
 */
export async function withSilentRefresh(
  apiCall: () => Promise<Response>,
  sessionRefresh: () => Promise<void>,
  sessionClear: () => void
): Promise<Response> {
  const res = await apiCall();

  if (res.status !== 401) {
    return res;
  }

  const { refreshed } = await performRefresh();

  if (refreshed) {
    await sessionRefresh();
    return apiCall();
  }

  sessionClear();
  return res;
}
