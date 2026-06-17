import type { Metadata } from "next";
import { SurfacePlaceholder } from "@/components/shells/surface-placeholder";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Catering",
  description:
    "Plan your next event with Wings 4 U catering. Wings, sauces, and sides for groups of any size.",
  path: "/catering",
});

export default function CateringPage() {
  return (
    <SurfacePlaceholder
      title="Catering Inquiry"
      summary="Structured catering lead capture lives here, with database persistence and admin notification flow behind it."
      bullets={[
        "Inquiry form and validation.",
        "Submission confirmation state.",
        "Future link into admin inquiry management."
      ]}
    />
  );
}
