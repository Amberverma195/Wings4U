import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/shells/surface-placeholder";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Privacy Policy",
  description: "How Wings 4 U collects, uses, and protects your personal information.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <SurfacePlaceholder
      title="Privacy Policy"
      summary="The public footer requires a privacy policy route, so the scaffold includes it now."
    />
  );
}
