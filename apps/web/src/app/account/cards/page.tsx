import { redirect } from "next/navigation";

export default function CardsPage() {
  // Saved cards / online payment methods are paused until the payment provider
  // integration is ready. Keep direct visits away from the inactive surface.
  redirect("/account");
}
