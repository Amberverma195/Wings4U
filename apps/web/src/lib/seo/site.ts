export const SITE_NAME = "Wings 4 U";

export const DEFAULT_DESCRIPTION =
  "Premium wings. 70+ sauces and dry rubs. Crispy every time. No excuses.";

/** Default social share image (served from /public). */
export const DEFAULT_OG_IMAGE_PATH = "/uploads/menu/combo-2lb-a3405132.jpeg";

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
