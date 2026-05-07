import { Suspense } from "react";
import { MenuSkeleton } from "@/Wings4u/components/menu-skeleton";
import { MenuRouteContent } from "../menu/menu-route-content";

export default function OrderPage() {
  return (
    <Suspense fallback={<MenuSkeleton statusLabel="Loading menu" />}>
      <MenuRouteContent routeKey="order" />
    </Suspense>
  );
}
