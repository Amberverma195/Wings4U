"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Landing } from "@/Wings4u/components/landing";
import { OrderMethodModal } from "@/Wings4u/components/order-method-modal";
import { useCart } from "@/lib/cart";
import type { FulfillmentType } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const cart = useCart();
  const [methodOpen, setMethodOpen] = useState(false);
  const [defaultMethod, setDefaultMethod] = useState<FulfillmentType>("DELIVERY");

  useEffect(() => {
    router.prefetch("/sauces");
  }, [router]);

  return (
    <>
      <Landing
        onOrderNow={() => {
          setDefaultMethod("DELIVERY");
          setMethodOpen(true);
        }}
        onSauces={() => {
          router.push("/sauces");
        }}
      />
      <OrderMethodModal
        open={methodOpen}
        defaultMethod={defaultMethod}
        initialScheduledFor={cart.scheduledFor}
        onClose={() => setMethodOpen(false)}
        onContinue={({ fulfillment_type, scheduled_for }) => {
          cart.commitOrderContext({
            fulfillmentType: fulfillment_type,
            scheduledFor: scheduled_for,
          });
          setMethodOpen(false);
          router.push(`/order?fulfillment_type=${fulfillment_type}`);
        }}
      />
    </>
  );
}
