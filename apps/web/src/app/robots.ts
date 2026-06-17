import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW_PATHS } from "@/lib/seo/sitemap-routes";
import { getSiteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW_PATHS],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
    host: getSiteUrl(),
  };
}
