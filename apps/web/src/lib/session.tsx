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
  /** Re-fetch session from server */
  refresh: () => Promise<void>;
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
  const pathname = usePathname();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<SessionApiResponse>(SIGNED_OUT_SESSION);

  // KDS is excluded from this list because it uses station password access
  // instead of redirecting to /auth/login.
  const isProtectedSurface =
    pathname?.startsWith("/admin") === true ||
    pathname?.startsWith("/pos") === true;

  const applySignedOut = useCallback(() => {
    setData(SIGNED_OUT_SESSION);
    setLoaded(true);
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/auth/session");
      if (res.ok) {
        const envelope = (await res.json()) as ApiEnvelope<SessionApiResponse>;
        setData(envelope.data ?? SIGNED_OUT_SESSION);
      } else if (res.status === 401 || res.status === 403) {
        applySignedOut();
        notifyAuthSessionCleared();
      }
    } catch {
      // Session fetch is best-effort; stay signed out on failure
    } finally {
      setLoaded(true);
    }
  }, [applySignedOut]);

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
        router.replace("/auth/login");
      }
    });
  }, [applySignedOut, isProtectedSurface, router]);

  useEffect(() => {
    if (!loaded || data.authenticated || !isProtectedSurface) {
      return;
    }
    router.replace("/auth/login");
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
let inFlightRefresh: Promise<{ refreshed: boolean }> | null = null;

async function performRefresh(): Promise<{ refreshed: boolean }> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    try {
      const refreshRes = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
      });
      if (!refreshRes.ok) {
        return { refreshed: false };
      }
      const envelope = (await refreshRes.json()) as ApiEnvelope<{ refreshed: boolean }>;
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
  sessionClear: () => void,
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
