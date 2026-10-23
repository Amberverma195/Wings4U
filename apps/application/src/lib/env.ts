/**
 * Environment configuration for the mobile app.
 *
 * Mirrors `apps/web/src/lib/env.ts` but uses Expo Constants instead of
 * `process.env.NEXT_PUBLIC_*` variables. Config values come from
 * `app.config.js -> expo.extra`, using public Expo build variables.
 *
 * In development the API runs on your machine at `http://<LAN_IP>:3001`.
 * For the Android emulator, `10.0.2.2` maps to the host loopback.
 * For iOS Simulator, `localhost` / `127.0.0.1` works directly.
 */
import Constants from "expo-constants";
import { isDevice } from "expo-device";
import { Platform } from "react-native";
const { validateApiOrigin, isLocalDevelopmentOrigin, realtimeTargetsApi } = require('../../config/api-origin.cjs') as {
  validateApiOrigin: (value: string, production: boolean) => string;
  isLocalDevelopmentOrigin: (value: string) => boolean;
  realtimeTargetsApi: (apiOrigin: string, realtimeOrigin: string, aliasOf: unknown, production: boolean) => boolean;
};

/** Fallback dev host: Android emulator -> 10.0.2.2, iOS sim -> 127.0.0.1 */
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
const DEV_API_PORT = "3001";

/**
 * Base URL for `/api/v1/*` JSON calls.
 *
 * Release builds require a public HTTPS origin from app.config.js.
 * Development precedence: an explicit `EXPO_PUBLIC_API_ORIGIN` or a remote
 * `developmentApiOrigin` (both opted into at build time), then the Android
 * emulator's host loopback in place of a local LAN default, then the LAN
 * default, then the platform fallback.
 */
export function getApiBase(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const production = !__DEV__ || extra?.environment === 'production';
  const configured = typeof extra?.apiOrigin === "string" ? extra.apiOrigin.trim() : "";
  if (production) {
    if (!configured) throw new Error('Production mobile API origin is not configured.');
    return validateApiOrigin(configured, true);
  }
  if (configured && (extra?.apiOriginExplicit === true || !isLocalDevelopmentOrigin(configured))) {
    return validateApiOrigin(configured, false);
  }
  if (__DEV__ && Platform.OS === "android" && !isDevice) {
    return `http://10.0.2.2:${DEV_API_PORT}`;
  }
  if (configured) {
    return validateApiOrigin(configured, false);
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
    const production = !__DEV__ || extra?.environment === 'production';
    const origin = validateApiOrigin(realtime.trim(), production);
    // Re-check app.config.js against the REST origin actually in use, which
    // can differ from the build-time value on the Android emulator.
    if (!realtimeTargetsApi(getApiBase(), origin, extra?.realtimeAliasOf, production)) {
      throw new Error('Realtime origin does not target the API backend in use.');
    }
    return origin;
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

// export const STRIPE_PUBLISHABLE_KEY: string = (() => {
//   const extra = Constants.expoConfig?.extra as
//     | Record<string, unknown>
//     | undefined;
//   const key = extra?.stripePublishableKey;
//   if (typeof key === "string" && key.trim()) return key;
//   return "pk_test_placeholder";
// })();

/** Public legal documents always use the website, independently of the API host. */
function getLegalWebsiteOrigin(): string {
  const { PUBLIC_WEBSITE_ORIGIN, validateWebsiteOrigin } = require('../../config/website-origin.cjs') as {
    PUBLIC_WEBSITE_ORIGIN: string;
    validateWebsiteOrigin: (value: unknown, production: boolean) => string;
  };
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  // Canonical fallback also protects installed builds whose extras predate websiteUrl.
  return validateWebsiteOrigin(extra?.websiteUrl ?? PUBLIC_WEBSITE_ORIGIN, !__DEV__ || extra?.environment === 'production');
}

export function getPrivacyPolicyUrl(): string {
  return `${getLegalWebsiteOrigin()}/privacy`;
}

export function getTermsOfServiceUrl(): string {
  return `${getLegalWebsiteOrigin()}/terms`;
}
