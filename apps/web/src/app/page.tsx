import { HomePageClient } from "./home-page-client";
import { createPageMetadata } from "@/lib/seo/metadata";
import { DEFAULT_DESCRIPTION } from "@/lib/seo/site";

export const metadata = createPageMetadata({
  title: "Premium Wings, 70+ Sauces & Dry Rubs",
  description: DEFAULT_DESCRIPTION,
  path: "/",
});

export default function HomePage() {
  return <HomePageClient />;
}
