"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Deadline-based, so rerenders and background-tab timer delays cannot reset it. */
export function useResendCooldown(active: boolean) {
  const deadline = useRef(0);
  const [availableAt, setAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const start = useCallback((seconds = 30) => {
    const current = Date.now();
    deadline.current = Math.max(deadline.current, current + seconds * 1000);
    setAvailableAt(deadline.current);
    setNow(current);
  }, []);
  const seconds = active ? Math.max(0, Math.ceil((availableAt - now) / 1000)) : 0;
  useEffect(() => {
    if (!active || availableAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= availableAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, availableAt]);
  return { seconds, start, isCoolingDown: () => deadline.current > Date.now() };
}
