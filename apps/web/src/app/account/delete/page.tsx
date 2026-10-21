import type { Metadata } from "next";
import { AccountDeletionFlow } from "./deletion-flow";
import styles from "../profile/profile.module.css";

export const metadata: Metadata = {
  title: "Delete your Wings4U account",
  description: "Securely request deletion of your Wings4U customer account and eligible personal data.",
};

export default function DeleteAccountPage() {
  return (
    <main className={styles.deletionPage}>
      <section className={styles.settingsCard}>
        <span className={styles.eyebrow}>Wings4U · Account privacy</span>
        <h1>Delete your Wings4U account?</h1>
        <p>Deleting your account is permanent. Your profile, saved addresses, login credentials,
          saved carts, reviews, and other eligible personal data will be deleted. Personal details
          copied into completed orders and messages will be removed.</p>
        <p>Certain transaction, payment, tax, refund, and security records may be retained for legal
          and financial obligations. These records are minimized and cannot be used to sign in.</p>
        <p>You will lose access to saved information and rewards. Deletion will not cancel active
          orders or automatically refund or transfer wallet balances. Pending payments, refunds,
          disputes, and nonzero wallet balances must be resolved first.</p>
        <p>Sign in, review your account status, re-enter your password, and confirm deletion.
          Eligible deletion completes when the confirmation succeeds. If something prevents
          completion, you will see the reason and can try again after it is resolved.
          Closing this page or cancelling does not delete your account.</p>
        <AccountDeletionFlow />
      </section>
    </main>
  );
}
