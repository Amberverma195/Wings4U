import type { MenuItem } from "@/lib/types";

/**
 * Menu copy cleanup: older DB rows may still end with this phrase; seed no longer includes it.
 */
export function menuCardDescriptionForItem(
  item: Pick<MenuItem, "slug" | "description">,
): string | null {
  const trimmed = item.description?.trim();
  if (!trimmed) return null;
  if (item.slug === "wings-4u-special") {
    return trimmed
      .replace(/,\s*and\s+any\s+removals\s+or\s+extras\.?/gi, "")
      .replace(
        /\s+Pick wing type,\s*1 flavour,\s*salad,\s*(?:and\s+)?2 pops\.?/gi,
        "",
      )
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return trimmed;
}
