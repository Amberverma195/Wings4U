import type { Metadata } from "next";
import DenialView from "@/components/denial-view";

export const metadata: Metadata = {
  title: "Page not available",
  robots: { index: false, follow: false },
};

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
