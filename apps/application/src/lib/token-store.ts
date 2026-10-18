/**
 * Secure token storage for mobile auth.
 *
 * Uses expo-secure-store on native (iOS/Android) for encrypted persistence.
 * Falls back to in-memory storage when expo-secure-store is unavailable (web).
 *
 * The web app uses httpOnly cookies set by the API; on mobile we must manage
 * tokens ourselves. The API issues a JWT `access_token` (+ optional
 * `refresh_token`) which we persist here and attach as a Bearer header via
 * `apiFetch()`.
 */

let _inMemoryAccessToken: string | null = null;
let _inMemoryRefreshToken: string | null = null;
let _inMemorySignupDeviceId: string | null = null;
let sessionGeneration = 0;
let accessLoaded = false;
let refreshLoaded = false;
let tokenWrites: Promise<void> = Promise.resolve();
const sessionListeners = new Set<() => void>();

export function getSessionGeneration(): number { return sessionGeneration; }
export function subscribeSessionGeneration(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
function publishSessionChange() { for (const listener of sessionListeners) listener(); }

// Serialize native writes: an already-started old write must finish before a
// newer login is persisted. In-memory credentials always change atomically.
function persistTokens(generation: number, values: Array<[string, string | null]>): Promise<void> {
  const write = tokenWrites.then(async () => {
    for (const [key, value] of values) {
      if (generation !== sessionGeneration) return;
      try {
        if (value === null) await SecureStore?.deleteItemAsync(key);
        else await SecureStore?.setItemAsync(key, value);
      } catch { /* Keep the existing in-memory fallback. */ }
    }
  });
  tokenWrites = write.catch(() => {});
  return write;
}

function persistCurrentTokens(generation: number): Promise<void> {
  return persistTokens(generation, [
    ...(accessLoaded ? [[ACCESS_TOKEN_KEY, _inMemoryAccessToken] as [string, string | null]] : []),
    ...(refreshLoaded ? [[REFRESH_TOKEN_KEY, _inMemoryRefreshToken] as [string, string | null]] : []),
  ]);
}

let SecureStore: typeof import("expo-secure-store") | null = null;
try {
  // expo-secure-store is an optional dep; gracefully degrade when missing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SecureStore = require("expo-secure-store");
} catch {
  // Fallback to in-memory storage
}

const ACCESS_TOKEN_KEY = "wings4u_access_token";
const REFRESH_TOKEN_KEY = "wings4u_refresh_token";
const SIGNUP_DEVICE_ID_KEY = "wings4u_signup_device_id";

function createSignupDeviceId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const random = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
  return `rn-${Date.now().toString(36)}-${random}`;
}

/* ------------------------------------------------------------------ */
/*  Access Token                                                       */
/* ------------------------------------------------------------------ */

export async function getAccessToken(): Promise<string | null> {
  if (accessLoaded) return _inMemoryAccessToken;
  const generation = sessionGeneration;
  if (SecureStore) {
    try {
      const stored = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (generation !== sessionGeneration) throw new Error('Your session changed. Please try again.');
      if (accessLoaded) return _inMemoryAccessToken;
      if (stored) {
        _inMemoryAccessToken = stored;
        accessLoaded = true;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  if (generation !== sessionGeneration) throw new Error('Your session changed. Please try again.');
  accessLoaded = true;
  return _inMemoryAccessToken;
}

export async function setAccessToken(token: string): Promise<void> {
  const generation = ++sessionGeneration;
  _inMemoryAccessToken = token;
  accessLoaded = true;
  publishSessionChange();
  await persistCurrentTokens(generation);
}

export async function clearAccessToken(): Promise<void> {
  const generation = ++sessionGeneration;
  _inMemoryAccessToken = null;
  accessLoaded = true;
  publishSessionChange();
  await persistCurrentTokens(generation);
}

/* ------------------------------------------------------------------ */
/*  Refresh Token                                                      */
/* ------------------------------------------------------------------ */

export async function getRefreshToken(): Promise<string | null> {
  if (refreshLoaded) return _inMemoryRefreshToken;
  const generation = sessionGeneration;
  if (SecureStore) {
    try {
      const stored = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (generation !== sessionGeneration) throw new Error('Your session changed. Please try again.');
      if (refreshLoaded) return _inMemoryRefreshToken;
      if (stored) {
        _inMemoryRefreshToken = stored;
        refreshLoaded = true;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  if (generation !== sessionGeneration) throw new Error('Your session changed. Please try again.');
  refreshLoaded = true;
  return _inMemoryRefreshToken;
}

export async function setRefreshToken(token: string): Promise<void> {
  const generation = ++sessionGeneration;
  _inMemoryRefreshToken = token;
  refreshLoaded = true;
  publishSessionChange();
  await persistCurrentTokens(generation);
}

export async function clearRefreshToken(): Promise<void> {
  const generation = ++sessionGeneration;
  _inMemoryRefreshToken = null;
  refreshLoaded = true;
  publishSessionChange();
  await persistCurrentTokens(generation);
}

/* ------------------------------------------------------------------ */
/*  Signup Device ID                                                   */
/* ------------------------------------------------------------------ */

export async function getSignupDeviceId(): Promise<string> {
  if (_inMemorySignupDeviceId) return _inMemorySignupDeviceId;

  if (SecureStore) {
    try {
      const stored = await SecureStore.getItemAsync(SIGNUP_DEVICE_ID_KEY);
      if (stored) {
        _inMemorySignupDeviceId = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }

  const created = createSignupDeviceId();
  _inMemorySignupDeviceId = created;
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(SIGNUP_DEVICE_ID_KEY, created);
    } catch {
      // ignore
    }
  }
  return created;
}

/* ------------------------------------------------------------------ */
/*  Convenience                                                        */
/* ------------------------------------------------------------------ */

export async function clearAllTokens(expectedGeneration = sessionGeneration): Promise<void> {
  if (expectedGeneration !== sessionGeneration) return;
  const generation = ++sessionGeneration;
  _inMemoryAccessToken = null; _inMemoryRefreshToken = null;
  accessLoaded = true; refreshLoaded = true;
  publishSessionChange();
  await persistTokens(generation, [[ACCESS_TOKEN_KEY, null], [REFRESH_TOKEN_KEY, null]]);
}

/** A new login is one identity transition, never two independent token writes. */
export async function setSessionTokens(access: string, refresh: string, expectedGeneration = sessionGeneration): Promise<number | null> {
  if (expectedGeneration !== sessionGeneration) return null;
  const generation = ++sessionGeneration;
  _inMemoryAccessToken = access; _inMemoryRefreshToken = refresh;
  accessLoaded = true; refreshLoaded = true;
  publishSessionChange();
  await persistTokens(generation, [[ACCESS_TOKEN_KEY, access], [REFRESH_TOKEN_KEY, refresh]]);
  return generation;
}

/** Rotation belongs to the same identity; it must not invalidate sibling 401s. */
export async function commitRefreshedTokens(generation: number, access: string, refresh: string): Promise<boolean> {
  if (generation !== sessionGeneration) return false;
  _inMemoryAccessToken = access; _inMemoryRefreshToken = refresh;
  accessLoaded = true; refreshLoaded = true;
  await persistTokens(generation, [[ACCESS_TOKEN_KEY, access], [REFRESH_TOKEN_KEY, refresh]]);
  return generation === sessionGeneration;
}
