import type { Metadata } from "next";
import { SaucesPage } from "@/Wings4u/components/sauces-page";
import { buildSauceFlavoursFromApi } from "@/Wings4u/data/sauces";
import { getCachedWingFlavours } from "@/lib/catalog/server-catalog";
import { createPageMetadata } from "@/lib/seo/metadata";
import { DEFAULT_LOCATION_ID } from "@/lib/env";

export const metadata: Metadata = createPageMetadata({
  title: "Sauces & Dry Rubs",
  description: "House sauces and dry rubs, from mellow crowd-pleasers to full-send heat.",
  path: "/sauces",
});

/** On-demand revalidation only - see `/api/revalidate/catalog`. */
export const revalidate = false;

export default async function SaucesRoutePage() {
  const apiFlavours = await getCachedWingFlavours(DEFAULT_LOCATION_ID);

  if (apiFlavours === null) {
    throw new Error("Unable to load sauces from the catalog API.");
  }

  return <SaucesPage flavours={buildSauceFlavoursFromApi(apiFlavours)} />;
}
