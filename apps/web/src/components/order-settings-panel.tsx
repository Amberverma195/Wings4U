import { useEffect, useRef, type ReactNode } from "react";

/** Non-modal: focus enters on open, but Tab is free to leave. */
export function OrderSettingsPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!panel.current || typeof document === 'undefined') return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, select, input, [tabindex]') ?? [])
      .find(element => element.tabIndex >= 0 && !element.matches(':disabled'));
    (first ?? panel.current)?.focus();
  }, []);
  return <div ref={panel} className="wk-order-settings-panel" role="dialog" aria-modal={false}
    aria-label="Order settings" tabIndex={-1} onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      onClose();
      if (opener.current?.isConnected) opener.current.focus();
    }}>{children}</div>;
}
