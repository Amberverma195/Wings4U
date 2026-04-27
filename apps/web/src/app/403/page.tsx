import type { Metadata } from "next";
import DenialView from "@/components/denial-view";

export const metadata: Metadata = {
  title: "Page not available",
  robots: { index: false, follow: false },
};

/**
 * Middleware rewrite target. The Edge middleware rewrites (not redirects)
 * non-admin requests to `/admin/*` here with HTTP 403 preserved, so the
 * browser sees a real "Forbidden" response and address-bar URL stays put.
 */
export default function ForbiddenRoute() {
  return <DenialView />;
}
