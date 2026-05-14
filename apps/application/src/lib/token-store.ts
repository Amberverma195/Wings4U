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

/* ------------------------------------------------------------------ */
/*  Access Token                                                       */
/* ------------------------------------------------------------------ */

export async function getAccessToken(): Promise<string | null> {
  if (_inMemoryAccessToken) return _inMemoryAccessToken;
  if (SecureStore) {
    try {
      const stored = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (stored) {
        _inMemoryAccessToken = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  return _inMemoryAccessToken;
}

export async function setAccessToken(token: string): Promise<void> {
  _inMemoryAccessToken = token;
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
    } catch {
      // ignore
    }
  }
}

export async function clearAccessToken(): Promise<void> {
  _inMemoryAccessToken = null;
  if (SecureStore) {
    try {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Refresh Token                                                      */
/* ------------------------------------------------------------------ */

export async function getRefreshToken(): Promise<string | null> {
  if (_inMemoryRefreshToken) return _inMemoryRefreshToken;
  if (SecureStore) {
    try {
      const stored = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (stored) {
        _inMemoryRefreshToken = stored;
        return stored;
      }
    } catch {
      // ignore
    }
  }
  return _inMemoryRefreshToken;
}

export async function setRefreshToken(token: string): Promise<void> {
  _inMemoryRefreshToken = token;
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    } catch {
      // ignore
    }
  }
}

export async function clearRefreshToken(): Promise<void> {
  _inMemoryRefreshToken = null;
  if (SecureStore) {
    try {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience                                                        */
/* ------------------------------------------------------------------ */

export async function clearAllTokens(): Promise<void> {
  await clearAccessToken();
  await clearRefreshToken();
}
