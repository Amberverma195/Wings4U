import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/shells/surface-placeholder";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Terms of Service",
  description: "Terms and conditions for using the Wings 4 U website and ordering services.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <SurfacePlaceholder
      title="Terms of Service"
      summary="The PRD calls for public terms links in the footer, so this placeholder route is part of the initial scaffold."
    />
  );
}
