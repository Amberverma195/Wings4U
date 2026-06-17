import type { Metadata } from "next";
import DenialView from "@/components/denial-view";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Page not available",
  description: "This page is not available.",
  noIndex: true,
});

/**
 * Middleware rewrite target. The Edge middleware rewrites (not redirects)
 * non-admin requests to `/admin/*` here with HTTP 403 preserved, so the
 * browser sees a real "Forbidden" response and address-bar URL stays put.
 */
export default function ForbiddenRoute() {
  return <DenialView />;
}
