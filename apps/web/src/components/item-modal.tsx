"use client";

import type { MenuItem } from "@/lib/types";
import { ItemCustomizationOverlay } from "./item-customization-overlay";

/** Keep legacy callers on the same authoritative customization path. */
export function ItemModal(props: { item: MenuItem; onClose: () => void }) {
  return <ItemCustomizationOverlay {...props} />;
}
