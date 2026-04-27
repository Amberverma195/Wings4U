/**
 * Shared overlay root for OrderMethodModal, DeliveryAddressPickerPanel, etc.
 * Order-settings dismiss handlers must ignore interactions here (see cart/menu).
 */
export function isTargetInsideWkMethodOverlay(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Node)) return false;
  const el = target instanceof Element ? target : target.parentElement;
  return Boolean(el?.closest(".wk-method-overlay"));
}

export function isFocusInsideWkMethodOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.activeElement?.closest?.(".wk-method-overlay"));
}
