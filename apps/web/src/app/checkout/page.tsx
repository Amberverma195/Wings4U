"use client";

import dynamic from "next/dynamic";
import "@heroui/styles/css";

import { CheckoutSkeleton } from "./checkout-skeleton";

const CheckoutClient = dynamic(
  () => import("./checkout-client").then((mod) => mod.CheckoutClient),
  {
    loading: () => <CheckoutSkeleton />,
    ssr: false,
  },
);

export default function CheckoutPage() {
  return (
    <main className="surface-shell checkout-page">
      <CheckoutClient />
    </main>
  );
}
