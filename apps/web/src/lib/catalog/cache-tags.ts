/** Global tag - invalidates all catalog menu responses in the Next.js Data Cache. */
export const CATALOG_MENU_TAG = "catalog-menu";

/** Global tag - invalidates all wing-flavour responses in the Next.js Data Cache. */
export const CATALOG_WING_FLAVOURS_TAG = "catalog-wing-flavours";

export function catalogMenuLocationTag(locationId: string): string {
  return `catalog-menu:${locationId}`;
}

export function catalogWingFlavoursLocationTag(locationId: string): string {
  return `catalog-wing-flavours:${locationId}`;
}

export function allCatalogTagsForLocation(locationId: string): string[] {
  return [
    CATALOG_MENU_TAG,
    CATALOG_WING_FLAVOURS_TAG,
    catalogMenuLocationTag(locationId),
    catalogWingFlavoursLocationTag(locationId),
  ];
}
