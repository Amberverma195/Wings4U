"use client";

import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Sonner host; styled to align with Wing Kings toasts (see globals `.wk-sonner-*`).
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group wk-sonner"
      position="bottom-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "wk-sonner-toast-root",
          title: "wk-sonner-title",
          description: "wk-sonner-description",
        },
      }}
      {...props}
    />
  );
}
