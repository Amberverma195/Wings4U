import type { Metadata } from "next";
import { SaucesPage } from "@/Wings4u/components/sauces-page";

export const metadata: Metadata = {
  title: "Sauces | Wings 4 U",
  description: "70+ house sauces and dry rubs, from mellow crowd-pleasers to full-send heat.",
};

export default function SaucesRoutePage() {
  return <SaucesPage />;
}
