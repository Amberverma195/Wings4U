import { Suspense } from "react";
import { MenuSkeleton } from "@/Wings4u/components/menu-skeleton";
import { MenuRouteContent } from "./menu-route-content";

export default function MenuRoutePage() {
  return (
    <Suspense fallback={<MenuSkeleton statusLabel="Loading menu" />}>
      <MenuRouteContent routeKey="menu" />
    </Suspense>
  );
}
