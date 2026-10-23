export const SIGNUP_DEVICE_STORAGE_KEY = "w4u_signup_device_id";
/** Fixed lifetime, matching the backend's signup-device cookie. Reads never renew it. */
export const SIGNUP_DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function readSignupDeviceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(SIGNUP_DEVICE_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw);
    if (record && typeof record.id === "string" && record.id.length >= 16 && record.id.length <= 128 &&
      Number.isFinite(record.createdAt) && record.createdAt <= Date.now() &&
      record.expiresAt === record.createdAt + SIGNUP_DEVICE_TTL_MS && record.expiresAt > Date.now()) {
      return record.id;
    }
  } catch { /* Legacy raw IDs have no known creation date; discard rather than extend them. */ }
  window.localStorage.removeItem(SIGNUP_DEVICE_STORAGE_KEY);
  return undefined;
}

export function getSignupDeviceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const existing = readSignupDeviceId();
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const createdAt = Date.now();
    window.localStorage.setItem(SIGNUP_DEVICE_STORAGE_KEY, JSON.stringify({ id, createdAt, expiresAt: createdAt + SIGNUP_DEVICE_TTL_MS }));
    return id;
  } catch {
    return undefined;
  }
}

// Remove expired/legacy data on a browser load without minting an ID until signup.
try { readSignupDeviceId(); } catch { /* Storage may be unavailable. */ }
