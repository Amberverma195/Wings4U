"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FaCartShopping } from "react-icons/fa6";
import { WingsBrandLockup } from "@/components/wings-brand-lockup";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { styles } from "../styles";

export function Navbar() {
  const router = useRouter();
  const session = useSession();
  const { itemCount, cartAddNonce, isCartHydrating } = useCart();
  const [cartPulse, setCartPulse] = useState(false);
  const isCustomerSession = session.authenticated && session.user?.role === "CUSTOMER";
  const staffSurfaceHref =
    session.authenticated && session.user?.role === "ADMIN"
      ? "/admin"
      : session.authenticated && session.user?.role === "STAFF"
        ? "/kds"
        : null;

  useEffect(() => {
    if (cartAddNonce === 0) return;
    setCartPulse(true);
    const t = window.setTimeout(() => setCartPulse(false), 550);
    return () => window.clearTimeout(t);
  }, [cartAddNonce]);

  const handleStationLogout = useCallback(async () => {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // best-effort; local clear still removes the station session from UI
    }
    session.clear();
    router.refresh();
  }, [router, session]);

  return (
    <nav style={styles.nav} className="wk-nav-bar">
      <div style={styles.navStart}>
        <WingsBrandLockup priority />
      </div>
      <div style={styles.navActions}>
        {isCustomerSession ? (
          <>
            <button style={styles.navBtn} onClick={() => router.push("/account/profile")}>
              {session.user?.displayName ?? "Account"}
            </button>
          </>
        ) : staffSurfaceHref ? (
          <>
            <button style={styles.navBtn} onClick={() => router.push(staffSurfaceHref)}>
              {session.user?.role === "ADMIN" ? "Admin" : "KDS"}
            </button>
            <button type="button" style={styles.navBtn} onClick={() => void handleStationLogout()}>
              Logout
            </button>
          </>
        ) : (
          <button style={styles.navBtn} onClick={() => router.push("/auth/login")}>
            Login
          </button>
        )}
        <button
          type="button"
          className={`fire-btn fire-btn--nav-cart${cartPulse ? " cart-btn--pulse" : ""}`}
          onClick={() => router.push("/cart")}
          aria-label={
            isCartHydrating && itemCount === 0
              ? "Shopping cart, loading"
              : `Shopping cart, ${itemCount} items`
          }
        >
          <span className="btn-label wk-nav-cart-inner">
            <FaCartShopping
              aria-hidden
              className="wk-nav-cart-icon"
            />
            <span key={cartAddNonce} className="cart-nav-badge">
              {isCartHydrating && itemCount === 0 ? "…" : itemCount}
            </span>
          </span>
        </button>
      </div>
    </nav>
  );
}
