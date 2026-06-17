import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/site";
import { PUBLIC_SITEMAP_ROUTES } from "@/lib/seo/sitemap-routes";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  return PUBLIC_SITEMAP_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
