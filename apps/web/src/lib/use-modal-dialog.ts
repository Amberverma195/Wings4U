"use client";

import { useEffect, useRef, type RefObject } from "react";

export type ModalDialogOptions = {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose?: () => void;
  returnFocusTo?: HTMLElement | null;
  active?: boolean;
  lockScroll?: boolean;
  closeOnEscape?: boolean;
};

/**
 * Universal accessible modal dialog hook for customer and admin dialogs.
 * Implements WCAG 2.1 Level A (1.3.1, 2.1.1, 2.1.2, 2.4.3, 4.1.2):
 * 1. Initial Focus: Automatically focuses initialFocusRef, or first focusable element inside the dialog, or the dialog element itself.
 * 2. Focus Trap: Constrains Tab and Shift+Tab traversal strictly within the dialog.
 * 3. Focus Containment: Focus shifts outside the dialog (e.g. via virtual cursors) are brought back inside.
 * 4. Keyboard Dismissal: Escape triggers onClose where appropriate.
 * 5. Focus Restoration: Returning focus to the original triggering element upon modal unmount or close.
 * 6. Scroll Lock: Disables document body scrolling while open and restores on close.
 */
export function useModalDialog({
  dialogRef,
  initialFocusRef,
  onClose,
  returnFocusTo,
  active = true,
  lockScroll = true,
  closeOnEscape = true,
}: ModalDialogOptions) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (typeof document === "undefined" || !active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // 1. Capture the element that had focus before opening, or explicit returnFocusTo
    const previousFocus =
      returnFocusTo ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    // 2. Lock body scroll if requested
    const previousOverflow = document.body.style.overflow;
    if (lockScroll) {
      document.body.style.overflow = "hidden";
    }

    // 3. Helper to query all visible, enabled focusable elements
    const getFocusable = (): HTMLElement[] => {
      const candidates = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]',
        ),
      );
      return candidates.filter((el) => {
        if (el.tabIndex < 0) return false;
        if (typeof el.matches === "function" && el.matches(":disabled, [hidden]")) return false;
        if (typeof el.closest === "function" && el.closest('[inert], [aria-hidden="true"]')) return false;
        if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
        return true;
      });
    };

    // 4. Initial focus placement
    const focusTarget = initialFocusRef?.current ?? getFocusable()[0] ?? dialog;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }

    // 5. Keyboard event handler (Tab trapping & Escape closing)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape && onCloseRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab") {
        const elements = getFocusable();
        const first = elements[0] ?? dialog;
        const last = elements[elements.length - 1] ?? dialog;

        if (
          !dialog.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          const target = event.shiftKey ? last : first;
          if (target && typeof target.focus === "function") {
            target.focus();
          }
        }
      }
    };

    // 6. Focus containment handler (prevents focus from leaking outside dialog)
    const onFocusIn = (event: FocusEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) {
        const elements = getFocusable();
        const target = elements[0] ?? dialog;
        if (target && typeof target.focus === "function") {
          target.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);

    // 7. Cleanup
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      if (lockScroll) {
        document.body.style.overflow = previousOverflow;
      }
      if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [active, closeOnEscape, dialogRef, initialFocusRef, lockScroll, returnFocusTo]);
}
