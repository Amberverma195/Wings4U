import { redirect } from "next/navigation";

/**
 * `/orders` (no order id) — bare endpoint reached when the URL is trimmed on
 * the order-confirmed screen. Send the user to their order history; that page
 * pops up the sign-in modal if they aren't authenticated.
 */
export default function OrdersIndexPage() {
  redirect("/account/orders");
}
