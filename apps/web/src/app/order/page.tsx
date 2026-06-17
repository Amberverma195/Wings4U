import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuSkeleton } from "@/Wings4u/components/menu-skeleton";
import { createPageMetadata } from "@/lib/seo/metadata";
import { MenuRouteContent } from "../menu/menu-route-content";

export const metadata: Metadata = createPageMetadata({
  title: "Order Online",
  description:
    "Order Wings 4 U online for pickup or delivery. Build your wing order with 70+ sauces and dry rubs.",
  path: "/order",
});

export default function OrderPage() {
  return (
    <Suspense fallback={<MenuSkeleton statusLabel="Loading menu" />}>
      <MenuRouteContent routeKey="order" />
    </Suspense>
  );
}
