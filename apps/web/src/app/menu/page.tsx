import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuSkeleton } from "@/Wings4u/components/menu-skeleton";
import { createPageMetadata } from "@/lib/seo/metadata";
import { MenuRouteContent } from "./menu-route-content";

export const metadata: Metadata = createPageMetadata({
  title: "Menu",
  description:
    "Browse the full Wings 4 U menu — wings, combos, sides, and more. Order pickup or delivery.",
  path: "/menu",
});

export default function MenuRoutePage() {
  return (
    <Suspense fallback={<MenuSkeleton statusLabel="Loading menu" />}>
      <MenuRouteContent routeKey="menu" />
    </Suspense>
  );
}
