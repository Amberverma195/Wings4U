import { MenuPage } from "@/Wings4u/components/menu-page";
import type { FulfillmentType } from "@/lib/types";

export default async function MenuRoutePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const rawFulfillment = params.fulfillment_type;
  const ft = Array.isArray(rawFulfillment) ? rawFulfillment[0] : rawFulfillment;
  const requestedFulfillmentType: FulfillmentType | null =
    ft === "DELIVERY" || ft === "PICKUP" ? ft : null;

  return (
    <MenuPage
      key={`menu-${requestedFulfillmentType ?? "session"}`}
      requestedFulfillmentType={requestedFulfillmentType}
    />
  );
}
