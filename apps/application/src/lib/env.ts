/**
 * Environment configuration for the mobile app.
 *
 * Mirrors `apps/web/src/lib/env.ts` but uses Expo Constants instead of
 * `process.env.NEXT_PUBLIC_*` variables. Config values come from
 * `app.json -> expo.extra` or the `.env` loaded via `expo-constants`.
 *
 * In development the API runs on your machine at `http://<LAN_IP>:3001`.
 * For the Android emulator, `10.0.2.2` maps to the host loopback.
 * For iOS Simulator, `localhost` / `127.0.0.1` works directly.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Fallback dev host: Android emulator -> 10.0.2.2, iOS sim -> 127.0.0.1 */
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const DEV_API_PORT = "3001";

/**
 * Base URL for `/api/v1/*` JSON calls.
 *
 * Resolution order:
 *   1. `Constants.expoConfig?.extra?.apiOrigin`  – explicit override in app.json
 *   2. Dev fallback based on platform
 */
export function getApiBase(): string {
  const explicit =
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
      ?.apiOrigin;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.replace(/\/$/, "");
  }
  // Dev fallback
  return `http://${DEV_HOST}:${DEV_API_PORT}`;
}

/**
 * Socket.IO origin for the `/ws` gateway.
 *
 * Resolution order:
 *   1. `Constants.expoConfig?.extra?.realtimeOrigin`
 *   2. `Constants.expoConfig?.extra?.apiOrigin`
 *   3. Dev fallback
 */
export function getRealtimeOrigin(): string {
  const extra = Constants.expoConfig?.extra as
    | Record<string, unknown>
    | undefined;
  const realtime = extra?.realtimeOrigin;
  if (typeof realtime === "string" && realtime.trim()) {
    return realtime.replace(/\/$/, "");
  }
  return getApiBase();
}

/**
 * Default location ID.
 *
 * Mirrors `NEXT_PUBLIC_DEFAULT_LOCATION_ID` from the web app.
 */
export const DEFAULT_LOCATION_ID: string = (() => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, unknown>
    | undefined;
  const id = extra?.defaultLocationId;
  if (typeof id === "string" && id.trim()) return id;
  return "00000000-0000-4000-8000-000000000000";
})();
