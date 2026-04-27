"use client";

export const AUTH_HANDOFF_ERROR_MESSAGE =
  "Error while signing in. Please try again.";

const AUTH_HANDOFF_ERROR_EVENT = "wings4u:auth-handoff-error";
const AUTH_HANDOFF_ERROR_STORAGE_KEY = "wings4u:auth-handoff-error";

export type AuthHandoffErrorEvent = CustomEvent<{ message: string }>;

export function dispatchAuthHandoffError(
  message = AUTH_HANDOFF_ERROR_MESSAGE,
) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(AUTH_HANDOFF_ERROR_STORAGE_KEY, message);
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }

  window.dispatchEvent(
    new CustomEvent(AUTH_HANDOFF_ERROR_EVENT, { detail: { message } }),
  );
}

export function consumeStoredAuthHandoffError() {
  if (typeof window === "undefined") return null;

  try {
    const message = window.sessionStorage.getItem(
      AUTH_HANDOFF_ERROR_STORAGE_KEY,
    );
    if (message) {
      window.sessionStorage.removeItem(AUTH_HANDOFF_ERROR_STORAGE_KEY);
    }
    return message;
  } catch {
    return null;
  }
}

export function addAuthHandoffErrorListener(
  listener: (event: AuthHandoffErrorEvent) => void,
) {
  window.addEventListener(
    AUTH_HANDOFF_ERROR_EVENT,
    listener as EventListener,
  );

  return () => {
    window.removeEventListener(
      AUTH_HANDOFF_ERROR_EVENT,
      listener as EventListener,
    );
  };
}
