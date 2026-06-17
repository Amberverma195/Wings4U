import type { Metadata } from "next";
import { SaucesPage } from "@/Wings4u/components/sauces-page";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Sauces & Dry Rubs",
  description: "70+ house sauces and dry rubs, from mellow crowd-pleasers to full-send heat.",
  path: "/sauces",
});

export default function SaucesRoutePage() {
  return <SaucesPage />;
}
