import Link from "next/link";
import styles from "./profile/profile.module.css";

export function AccountDeletionButton() {
  return (
    <div className={styles.accountDeletion}>
      <Link href="/account/delete" className={styles.deleteAccountBtn}>Delete Account</Link>
      <p className={styles.deleteAccountStatus}>Review permanent account deletion and data retention.</p>
    </div>
  );
}
