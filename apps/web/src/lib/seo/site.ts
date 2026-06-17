export const SITE_NAME = "Wings 4 U";

export const DEFAULT_DESCRIPTION =
  "Premium wings. 70+ sauces and dry rubs. Crispy every time. No excuses.";

/** Default social share image (served from /public). */
export const DEFAULT_OG_IMAGE_PATH = "/uploads/menu/combo-2lb-a3405132.jpeg";

/**
 * Canonical site origin for sitemap, robots, and Open Graph URLs.
 * Set `NEXT_PUBLIC_SITE_URL` in Vercel (e.g. https://www.wings4u.com).
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return configured.startsWith("http") ? configured : `https://${configured}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }

  return "http://localhost:3000";
}
