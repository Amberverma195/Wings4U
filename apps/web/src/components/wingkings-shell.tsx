"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FireEmbers } from "@/Wings4u/components/fire-embers";
import { WingKingsGlobalStyle } from "@/Wings4u/components/global-style";
import { NewsletterSection } from "@/Wings4u/components/newsletter-section";
import { OrderCtaSection } from "@/Wings4u/components/order-cta-section";
import { SpotlightSection } from "@/Wings4u/components/spotlight-section";
import { TestimonialsSection } from "@/Wings4u/components/testimonials-section";
import { GuestCartExpiryBanner } from "@/components/guest-cart-expiry-banner";
import { AuthHandoffErrorToast } from "@/components/auth-handoff-error-toast";
import { SiteFooter } from "@/components/site-footer";
import { Navbar } from "@/Wings4u/components/navbar";
import { styles } from "@/Wings4u/styles";

export function WingKingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showMarketingSections = pathname === "/";
  const isSaucesRoute = pathname === "/sauces";
  const isKdsRoute = pathname === "/kds" || pathname?.startsWith("/kds/");
  /** Login/signup use a neutral background; global embers sit above main (z-index 996) and add an orange wash. */
  const hideFireEmbers = /^\/auth\/(login|signup)\/?$/.test(pathname ?? "");
  /** Only scroll to top on real route changes — not on mount/remount while staying on the same path (fixes scroll jumping while reading the page). */
  const prevPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const previous = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    const { history } = window;
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";

    if (previous !== null && previous !== pathname) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }

    return () => {
      history.scrollRestoration = previousScrollRestoration;
    };
  }, [pathname]);

  if (isSaucesRoute) {
    return (
      <div style={styles.app}>
        <WingKingsGlobalStyle />
        <FireEmbers />
        {children}
      </div>
    );
  }

  if (isKdsRoute) {
    return (
      <div style={styles.app}>
        <WingKingsGlobalStyle />
        {children}
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <WingKingsGlobalStyle />
      <Navbar />
      {hideFireEmbers ? null : <FireEmbers />}
      <div style={styles.appMain} className="wk-shell-main">
        {children}
        {showMarketingSections ? <SpotlightSection /> : null}
        {showMarketingSections ? <TestimonialsSection /> : null}
        {showMarketingSections ? <NewsletterSection /> : null}
        {showMarketingSections ? <OrderCtaSection /> : null}
      </div>
      <SiteFooter />
      <GuestCartExpiryBanner />
      <AuthHandoffErrorToast />
    </div>
  );
}
