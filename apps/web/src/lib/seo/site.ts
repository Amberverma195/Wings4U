export const SITE_NAME = "Wings 4 U";

export const OG_SITE_NAME = "Wings 4 U London";

export const DEFAULT_DESCRIPTION =
  "Enjoy 100% fresh, never frozen chicken wings with over 70+ legendary flavors and dry rubs. Located at 1544 Dundas Street. Order online today!";

/** Default social share image (served from /public). */
export const DEFAULT_OG_IMAGE_PATH = "/logo.png";

export const DEFAULT_OG_IMAGE_ALT = "Wings 4 U London Official Logo";

export const OG_IMAGE_SIZE = 512;

/**
 * Canonical site origin for sitemap, robots, and Open Graph URLs.
 *
 * Resolution order:
 * 1. `NEXT_PUBLIC_SITE_URL` — set explicitly in Vercel (recommended).
 * 2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel's primary production domain.
 * 3. `VERCEL_URL` — deployment hostname (preview *.vercel.app URLs).
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return configured.startsWith("http") ? configured : `https://${configured}`;
  }

  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/\/$/, "");
  if (productionDomain) {
    return productionDomain.startsWith("http")
      ? productionDomain
      : `https://${productionDomain}`;
  }

  const deploymentHost = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (deploymentHost) {
    return `https://${deploymentHost}`;
  }

  return "http://localhost:3000";
}
