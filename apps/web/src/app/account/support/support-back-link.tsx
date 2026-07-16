"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_ACCOUNT_RETURN_ROUTE,
  getSupportReturnRoute,
} from "@/lib/client-route-history";

import styles from "./support.module.css";

export function SupportBackLink() {
  const [href, setHref] = useState(DEFAULT_ACCOUNT_RETURN_ROUTE);

  useEffect(() => {
    setHref(getSupportReturnRoute());
  }, []);

  return (
    <Link href={href} className={`${styles.navLink} ${styles.navLinkBack}`}>
      <span className={styles.navLinkArrowLeft}>{"\u2190"}</span>
      <span>Back</span>
    </Link>
  );
}
