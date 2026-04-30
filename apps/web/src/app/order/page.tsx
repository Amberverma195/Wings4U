import { Suspense } from "react";
import { MenuRouteContent } from "../menu/menu-route-content";

export default function OrderPage() {
  return (
    <Suspense fallback={null}>
      <MenuRouteContent routeKey="order" />
    </Suspense>
  );
}
