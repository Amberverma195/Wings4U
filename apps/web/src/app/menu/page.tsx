import { Suspense } from "react";
import { MenuRouteContent } from "./menu-route-content";

export default function MenuRoutePage() {
  return (
    <Suspense fallback={null}>
      <MenuRouteContent routeKey="menu" />
    </Suspense>
  );
}
