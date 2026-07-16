"use client";

const CURRENT_ROUTE_KEY = "wings4u:current-route";
const PREVIOUS_ROUTE_KEY = "wings4u:previous-route";
const SUPPORT_RETURN_ROUTE_KEY = "wings4u:support-return-route";

export const DEFAULT_ACCOUNT_RETURN_ROUTE = "/account/profile";

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function normalizeRoute(value?: string | null): string | null {
  if (!value || typeof window === "undefined") return null;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function getPathname(route: string): string {
  try {
    return new URL(route, window.location.origin).pathname;
  } catch {
    return route.split(/[?#]/, 1)[0] || route;
  }
}

function isSupportRoute(route: string): boolean {
  const pathname = getPathname(route);
  return pathname === "/account/support" || pathname.startsWith("/account/support/");
}

export function rememberAppRoute(pathname: string | null) {
  if (typeof window === "undefined" || !pathname) return;

  const nextRoute = normalizeRoute(`${pathname}${window.location.search}${window.location.hash}`);
  if (!nextRoute) return;

  const currentRoute = normalizeRoute(readStorage(CURRENT_ROUTE_KEY));
  if (currentRoute && currentRoute !== nextRoute) {
    writeStorage(PREVIOUS_ROUTE_KEY, currentRoute);

    if (isSupportRoute(nextRoute) && !isSupportRoute(currentRoute)) {
      writeStorage(SUPPORT_RETURN_ROUTE_KEY, currentRoute);
    }
  }

  if (!isSupportRoute(nextRoute)) {
    writeStorage(SUPPORT_RETURN_ROUTE_KEY, nextRoute);
  } else if (!currentRoute) {
    const referrerRoute = normalizeRoute(document.referrer);
    if (referrerRoute && referrerRoute !== nextRoute && !isSupportRoute(referrerRoute)) {
      writeStorage(SUPPORT_RETURN_ROUTE_KEY, referrerRoute);
    }
  }

  writeStorage(CURRENT_ROUTE_KEY, nextRoute);
}

export function getSupportReturnRoute(fallback = DEFAULT_ACCOUNT_RETURN_ROUTE): string {
  if (typeof window === "undefined") return fallback;

  const currentRoute = normalizeRoute(window.location.href);
  const candidates = [
    readStorage(SUPPORT_RETURN_ROUTE_KEY),
    readStorage(PREVIOUS_ROUTE_KEY),
    document.referrer,
  ];

  for (const candidate of candidates) {
    const route = normalizeRoute(candidate);
    if (!route || route === currentRoute || isSupportRoute(route)) continue;
    return route;
  }

  return fallback;
}
