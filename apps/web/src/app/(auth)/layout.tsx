import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Sign In",
  description: "Sign in to your Wings 4 U account to track orders, save addresses, and reorder favorites.",
  path: "/login",
  noIndex: true,
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
