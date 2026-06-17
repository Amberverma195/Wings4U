import type { MetadataRoute } from "next";

type SitemapRoute = {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
};

/**
 * Public, indexable marketing and ordering surfaces.
 * Auth, account, staff, and checkout flows are excluded intentionally.
 */
export const PUBLIC_SITEMAP_ROUTES: SitemapRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/menu", changeFrequency: "daily", priority: 0.9 },
  { path: "/order", changeFrequency: "daily", priority: 0.9 },
  { path: "/sauces", changeFrequency: "weekly", priority: 0.8 },
  { path: "/catering", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

/** Paths crawlers must not index (also mirrored in robots.ts). */
export const ROBOTS_DISALLOW_PATHS = [
  "/admin/",
  "/account/",
  "/api/",
  "/kds/",
  "/pos/",
  "/checkout/",
  "/orders/",
  "/cart/",
  "/devices/",
  "/timeclock/",
  "/surfaces/",
  "/403/",
] as const;
