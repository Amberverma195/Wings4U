"use client";

const AUTH_SESSION_CLEARED_EVENT = "wings4u:auth-session-cleared";
const AUTH_SESSION_CLEARED_STORAGE_KEY = "wings4u:auth-session-cleared";

export function notifyAuthSessionCleared() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));

  try {
    window.localStorage.setItem(
      AUTH_SESSION_CLEARED_STORAGE_KEY,
      `${Date.now()}:${Math.random()}`,
    );
  } catch {
    // localStorage can be unavailable in private/restricted browser contexts.
  }
}

export function addAuthSessionClearedListener(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_SESSION_CLEARED_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(AUTH_SESSION_CLEARED_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
