import "server-only";
import { cookies, headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { getPublicApiBase } from "./env";
import {
  isAuthorizedForSurface,
  type AuthorizedSessionLike,
  type SurfacePolicyId,
} from "./surface-policy";

/**
 * Shape returned by `GET /api/v1/auth/session`.
 *
 * The authoritative fields here are `role` and `employeeRole` — the API
 * sources both from `SessionValidator` + current DB state, so the web
 * layouts must never fall back to offline JWT claims for final access
 * decisions (those become stale after a role demotion or re-issue).
 */
interface ApiSessionUser {
  id?: string;
  role?: string;
  employeeRole?: string;
}

interface ApiSessionResponse {
  data?: {
    authenticated?: boolean;
    user?: ApiSessionUser;
  };
}

/**
 * Authoritative server-side surface gate shared by every protected layout
 * (`/admin`, `/kds`, `/pos`). Each of those layouts is a thin wrapper
 * around this helper so the three surfaces stay in lock-step on:
 *
 *   - cookie-missing fast path: redirect to `/auth/login` without any
 *     network hop,
 *   - API call to `GET /api/v1/auth/session` with forwarded cookies and
 *     `cache: "no-store"` so the response is never stale,
 *   - `authenticated === false` -> redirect to `/auth/login`,
 *   - authenticated but policy fails -> either redirect to a caller-chosen
 *     fallback or call `forbidden()` to render the shared
 *     `app/forbidden.tsx` with a real HTTP 403,
 *   - pass -> return the authoritative session so the layout can use the
 *     current role/employeeRole for rendering (e.g. nav items).
 *
 * The Edge middleware has already prefiltered obvious cases (missing JWT,
 * non-matching role claim) but cannot check revocation or DB role drift,
 * which is why this layer must exist. Internal API failures must surface
 * as real server errors here instead of being flattened into a fake
 * "signed out" redirect.
 */
interface SurfaceAccessOptions {
  forbiddenRedirectTo?: string;
  notFoundOnUnauthenticated?: boolean;
  notFoundOnForbidden?: boolean;
}

export async function requireSurfaceAccess(
  policyId: SurfacePolicyId,
  options: SurfaceAccessOptions = {},
): Promise<AuthorizedSessionLike> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  if (!accessToken) {
    if (options.notFoundOnUnauthenticated) {
      notFound();
    }
    redirect("/auth/login");
  }

  const cookieHeader = (await headers()).get("cookie") ?? "";
  const base = getPublicApiBase();
  const fetchUrl = `${base}/api/v1/auth/session`;

  // Dev-time resilience: the Nest API does incremental recompiles, so
  // there's a ~1–3s window after a file change where port 3001 is closed.
  // Without a retry, any admin/KDS/POS navigation during that window
  // explodes the layout with `fetch failed`. Retry a small number of
  // times with linear backoff before giving up — total wait stays well
  // under 1s so the user never sees a noticeable stall when the API is
  // actually healthy. Any non-network failure (e.g. the server replied
  // with 5xx) is not retried; that goes straight to the !ok branch below
  // so we don't mask real server bugs.
  const attemptDelaysMs = [0, 150, 400];
  let res: Response | null = null;
  let lastError: unknown = null;
  for (const delay of attemptDelaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      res = await fetch(fetchUrl, {
        method: "GET",
        headers: { cookie: cookieHeader },
        cache: "no-store",
        credentials: "include",
        // AbortSignal.timeout keeps a stuck TCP from hanging the RSC
        // render — 4s is generous for a healthy local API, and any
        // longer than that the user deserves a real error.
        signal: AbortSignal.timeout(4000),
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      res = null;
    }
  }

  if (!res) {
    const cause =
      lastError instanceof Error ? lastError.message : "unknown error";
    console.error(
      "[requireSurfaceAccess] session fetch failed after retries",
      { fetchUrl, cause },
    );
    throw new Error(
      `Failed to reach auth session endpoint at ${fetchUrl} after retries: ${cause}. ` +
        `In dev this usually means the Nest API (port 3001) is not running, ` +
        `is mid-recompile, or INTERNAL_API_URL points at the wrong host. ` +
        `Start it with \`npm run dev:api\` (or \`npm run dev\` from the repo root) ` +
        `and reload the page.`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `Auth session endpoint failed while gating protected surface (${res.status} ${res.statusText})`,
    );
  }

  const body = (await res.json()) as ApiSessionResponse;
  const data = body?.data;
  if (data?.authenticated === false) {
    if (options.notFoundOnUnauthenticated) {
      notFound();
    }
    redirect("/auth/login");
  }
  if (!data?.authenticated || !data.user?.role) {
    throw new Error(
      "Auth session endpoint returned an invalid protected-surface payload",
    );
  }

  const session: AuthorizedSessionLike = {
    role: data.user.role as AuthorizedSessionLike["role"],
    employeeRole: data.user.employeeRole as
      | AuthorizedSessionLike["employeeRole"]
      | undefined,
  };

  if (!isAuthorizedForSurface(session, policyId)) {
    if (options.forbiddenRedirectTo) {
      redirect(options.forbiddenRedirectTo);
    }
    if (options.notFoundOnForbidden) {
      notFound();
    }
    forbidden();
  }

  return session;
}
