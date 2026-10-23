"use client";

import { useModalDialog } from "@/lib/use-modal-dialog";
import type { RefObject } from "react";

/** One active dialog at a time: keyboard containment, scroll lock and focus return. */
export function useAdminDialog({
  dialogRef,
  initialFocusRef,
  onClose,
  returnFocusTo,
  active = true,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  active?: boolean;
}) {
  useModalDialog({
    dialogRef,
    initialFocusRef,
    onClose,
    returnFocusTo,
    active,
  });
}

