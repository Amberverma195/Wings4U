import { SupportClient } from "./support-client";
import { RequireAuthModal } from "@/components/require-auth-modal";

export default function AccountSupportPage() {
  return (
    <main>
      <RequireAuthModal ariaLabel="Sign in to view your support tickets">
        <SupportClient />
      </RequireAuthModal>
    </main>
  );
}
