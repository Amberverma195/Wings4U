import { HomePageClient } from "./home-page-client";
import { createPageMetadata } from "@/lib/seo/metadata";
import { DEFAULT_DESCRIPTION } from "@/lib/seo/site";

export const metadata = createPageMetadata({
  description: DEFAULT_DESCRIPTION,
  path: "/",
});

export default function HomePage() {
  return <HomePageClient />;
}
