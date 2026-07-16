"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "./api";
import {
  addAuthSessionClearedListener,
  notifyAuthSessionCleared,
} from "./auth-events";
import type { ApiEnvelope } from "@wings4u/contracts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  role: string;
  /**
   * Present only for STAFF users. Consumers (notably the KDS/admin surface
   * surfaces and any shared policy helper) must never fall back to JWT
   * claims for this value — the API is the source of truth and reflects
   * the current DB `employeeProfile.role`.
   */
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
  isPosSession: boolean;
  stationLocationId?: string;
  profileComplete: boolean;
  needsProfileCompletion: boolean;
  /** Re-fetch session from server. Resolves true when authenticated. */
  refresh: () => Promise<boolean>;
  /** Clear local session (on logout) */
  clear: () => void;
}

interface SessionApiResponse {
  authenticated: boolean;
  user?: SessionUser;
  is_pos_session?: boolean;
  station_location_id?: string;
  profile_complete: boolean;
  needs_profile_completion: boolean;
}

const SIGNED_OUT_SESSION: SessionApiResponse = {
  authenticated: false,
  is_pos_session: false,
  station_location_id: undefined,
  profile_complete: false,
  needs_profile_completion: false,
};

const SESSION_FETCH_TIMEOUT_MS =
  process.env.NODE_ENV === "production" ? 12_000 : 4_000;

function hasRefreshSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)csrf_token=/.test(document.cookie);
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const SessionContext = createContext<SessionState>({
  loaded: false,
  authenticated: false,
  user: null,
  isPosSession: false,
  stationLocationId: undefined,
  profileComplete: false,
  needsProfileCompletion: false,
  refresh: async () => false,
  clear: () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<SessionApiResponse>(SIGNED_OUT_SESSION);

  // KDS and POS use station password access instead of redirecting to
  // /login. Their server layouts perform the store-network gate first.
  const isProtectedSurface =
    pathname?.startsWith("/admin") === true;

  const applySignedOut = useCallback(() => {
    setData(SIGNED_OUT_SESSION);
    setLoaded(true);
  }, []);

  const fetchSession = useCallback(async (): Promise<boolean> => {
    let timeoutId: number | undefined;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(
        () => controller.abort(),
        SESSION_FETCH_TIMEOUT_MS,
      );
      const res = await apiFetch("/api/v1/auth/session", {
        signal: controller.signal,
      });
      if (res.ok) {
        const envelope = (await res.json()) as ApiEnvelope<SessionApiResponse>;
        const next = envelope.data ?? SIGNED_OUT_SESSION;
        if (next.authenticated === true) {
          setData(next);
          return true;
        }

        // The public session endpoint intentionally returns 200 with
        // `authenticated: false` when the 15-minute access cookie is gone.
        // The readable CSRF cookie has the same 30-day lifetime as the
        // httpOnly refresh cookie, so it is a safe hint that recovery should
        // be attempted before the UI is changed to signed out.
        if (hasRefreshSessionHint()) {
          const refresh = await performRefresh();
          if (refresh.refreshed) {
            const retry = await apiFetch("/api/v1/auth/session");
            if (retry.ok) {
              const retryEnvelope = (await retry.json()) as ApiEnvelope<SessionApiResponse>;
              const recovered = retryEnvelope.data ?? SIGNED_OUT_SESSION;
              setData(recovered);
              return recovered.authenticated === true;
            }

            // A temporary API failure after successful token rotation must
            // not erase the last known client session.
            return data.authenticated === true;
          }

          if (!refresh.definitive) {
            return data.authenticated === true;
          }

          applySignedOut();
          notifyAuthSessionCleared();
          return false;
        }

        setData(next);
        return false;
      }

      // Access token may have expired while the refresh cookie is still valid.
      // Try one silent refresh before treating the user as signed out.
      if (res.status === 401 || res.status === 403) {
        const { refreshed, definitive } = await performRefresh();
        if (refreshed) {
          const retry = await apiFetch("/api/v1/auth/session");
          if (retry.ok) {
            const envelope = (await retry.json()) as ApiEnvelope<SessionApiResponse>;
            const next = envelope.data ?? SIGNED_OUT_SESSION;
            setData(next);
            return next.authenticated === true;
          }
        }
        if (!definitive) {
          return data.authenticated === true;
        }
        applySignedOut();
        notifyAuthSessionCleared();
        return false;
      }

      // Other HTTP failures (5xx, etc.) keep the last known session instead
      // of forcing a signed-out state that bounces the user back to /login.
      return data.authenticated === true;
    } catch (cause) {
      const isAbort =
        cause instanceof DOMException
          ? cause.name === "AbortError"
          : cause instanceof Error && cause.name === "AbortError";
      if (isAbort) {
        // Slow API / cold start: do not treat a timeout as logout.
        return data.authenticated === true;
      }
      // Transient network error: same policy. Fail closed only when we have
      // no prior authenticated session to preserve.
      return data.authenticated === true;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      setLoaded(true);
    }
  }, [applySignedOut, data.authenticated]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!loaded) return;
    void fetchSession();
  }, [fetchSession, loaded, pathname]);

  useEffect(() => {
    const revalidate = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void fetchSession();
    };

    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidate);

    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [fetchSession]);

  useEffect(() => {
    return addAuthSessionClearedListener(() => {
      applySignedOut();
      if (isProtectedSurface) {
        router.replace("/login");
      }
    });
  }, [applySignedOut, isProtectedSurface, router]);

  useEffect(() => {
    if (!loaded || data.authenticated || !isProtectedSurface) {
      return;
    }
    router.replace("/login");
  }, [data.authenticated, isProtectedSurface, loaded, router]);

  const clear = useCallback(() => {
    applySignedOut();
    notifyAuthSessionCleared();
  }, [applySignedOut]);

  const value = useMemo<SessionState>(
    () => ({
      loaded,
      authenticated: data.authenticated,
      user: data.user ?? null,
      isPosSession: data.is_pos_session === true,
      stationLocationId: data.station_location_id,
      profileComplete: data.profile_complete,
      needsProfileCompletion: data.needs_profile_completion,
      refresh: fetchSession,
      clear,
    }),
    [loaded, data, fetchSession, clear],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Silent refresh helper                                              */
/* ------------------------------------------------------------------ */

/**
 * Module-level dedupe of in-flight refresh calls.
 *
 * Prevents the classic single-use refresh-token rotation race: when the access
 * token expires, multiple concurrent API calls (including React StrictMode's
 * double-effect runs) all hit 401 at the same instant. Without dedupe, each
 * caller fires its own `/auth/refresh` request with the *same* refresh-token
 * cookie value; the first one rotates the token and the rest are treated as
 * replays, which the server interprets as a stolen token and kills the
 * session entirely. By funneling every concurrent refresh attempt through
 * the same Promise we only ever rotate the token once.
 */
interface RefreshResult {
  refreshed: boolean;
  /** True when the server definitively rejected the refresh session. */
  definitive: boolean;
}

let inFlightRefresh: Promise<RefreshResult> | null = null;

async function performRefresh(): Promise<RefreshResult> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    try {
      const refreshRes = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
      });
      if (!refreshRes.ok) {
        return { refreshed: false, definitive: refreshRes.status < 500 };
      }
      const envelope = (await refreshRes.json()) as ApiEnvelope<{ refreshed: boolean }>;
      const refreshed = envelope.data?.refreshed === true;
      return { refreshed, definitive: !refreshed };
    } catch {
      return { refreshed: false, definitive: false };
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
  sessionRefresh: () => Promise<void | boolean>,
  sessionClear: () => void,
): Promise<Response> {
  const res = await apiCall();

  if (res.status !== 401) {
    return res;
  }

  const { refreshed, definitive } = await performRefresh();

  if (refreshed) {
    await sessionRefresh();
    return apiCall();
  }

  if (definitive) {
    sessionClear();
  }
  return res;
}
