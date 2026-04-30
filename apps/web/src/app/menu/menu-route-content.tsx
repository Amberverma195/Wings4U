"use client";

import { useSearchParams } from "next/navigation";
import { MenuPage } from "@/Wings4u/components/menu-page";
import type { FulfillmentType } from "@/lib/types";

export function MenuRouteContent({ routeKey }: { routeKey: "menu" | "order" }) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("fulfillment_type");
  const requestedFulfillmentType: FulfillmentType | null =
    raw === "DELIVERY" || raw === "PICKUP" ? raw : null;

  return (
    <MenuPage
      key={`${routeKey}-${requestedFulfillmentType ?? "session"}`}
      requestedFulfillmentType={requestedFulfillmentType}
    />
  );
}
