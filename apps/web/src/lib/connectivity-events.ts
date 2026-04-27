export const CONNECTIVITY_EVENT = "wings4u:connectivity";

export type ConnectivityReason = "offline" | "network" | "server";

export function dispatchConnectivityFailure(reason: ConnectivityReason): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONNECTIVITY_EVENT, { detail: { reason } })
  );
}
