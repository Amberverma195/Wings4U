/**
 * Lib barrel export.
 *
 * Import utilities from this file:
 *   import { apiFetch, apiJson, cents, statusLabel } from "../src/lib";
 */
export { apiFetch, apiJson, getApiErrorMessage, addConnectivityListener } from "./api";
export { getApiBase, getRealtimeOrigin, DEFAULT_LOCATION_ID } from "./env";
export { cents, shortTime, shortDate, relativeTime, statusLabel, orderStatusCustomerLabel } from "./format";
export { toE164, phoneInputPlaceholder, formatPhoneForDisplay } from "./phone";
export { getAccessToken, setAccessToken, clearAccessToken, clearAllTokens } from "./token-store";
export { createOrdersSocket, subscribeToChannels } from "./realtime";
