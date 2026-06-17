import type { Metadata } from "next";
import DenialView from "@/components/denial-view";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Page not available",
  description: "This page is not available.",
  noIndex: true,
});

/**
 * Renders whenever a server component calls `forbidden()` from
 * `next/navigation`. The authoritative admin layout uses this boundary so
 * that authenticated but non-admin users get a real HTTP 403 response
 * instead of a plain page-redirect that the client could otherwise replay
 * or scrape for role information.
 */
export default function Forbidden() {
  return <DenialView />;
}
