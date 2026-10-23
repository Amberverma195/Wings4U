import type { KeyboardEvent } from "react";

/** Shared keyboard behavior for button-based radio groups. Native clicks keep selection rules centralized. */
export function handleRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>) {
  const previous = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const next = event.key === "ArrowRight" || event.key === "ArrowDown";
  if (!previous && !next && event.key !== "Home" && event.key !== "End") return;
  const target = event.target as HTMLElement;
  if (target.closest('[role="radiogroup"]') !== event.currentTarget) return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]'))
    .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.closest('[role="radiogroup"]') === event.currentTarget);
  const index = radios.indexOf(target as HTMLButtonElement);
  if (index < 0 || !radios.length) return;
  event.preventDefault();
  const destination = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1
    : (index + (previous ? -1 : 1) + radios.length) % radios.length;
  radios[destination].focus();
  radios[destination].click();
}
