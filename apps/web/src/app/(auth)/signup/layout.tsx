import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Create Account",
  description: "Create your Wings 4 U account to save orders, addresses, and rewards.",
  path: "/signup",
  noIndex: true,
});

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
