import { HomePageClient } from "./home-page-client";
import {
  buildSauceFlavoursFromApi,
  selectCarouselSauceFlavours,
} from "@/Wings4u/data/sauces";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { getCachedWingFlavours } from "@/lib/catalog/server-catalog";
import { createPageMetadata } from "@/lib/seo/metadata";
import { DEFAULT_DESCRIPTION } from "@/lib/seo/site";

export const metadata = createPageMetadata({
  description: DEFAULT_DESCRIPTION,
  path: "/",
});

/** On-demand revalidation only - see `/api/revalidate/catalog`. */
export const revalidate = false;

export default async function HomePage() {
  const apiFlavours = await getCachedWingFlavours(DEFAULT_LOCATION_ID);

  if (apiFlavours === null) {
    throw new Error("Unable to load homepage sauces from the catalog API.");
  }

  const carouselSauces = selectCarouselSauceFlavours(
    buildSauceFlavoursFromApi(apiFlavours),
  );

  return <HomePageClient carouselSauces={carouselSauces} />;
}
