"use client";

import { useEffect } from "react";

/**
 * Locks page scroll while an overlay is mounted.
 * Restores the previous overflow value on unmount.
 */
export function useLockBodyScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, []);
}
