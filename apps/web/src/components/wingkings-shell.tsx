"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FireEmbers } from "@/Wings4u/components/fire-embers";
import { WingKingsGlobalStyle } from "@/Wings4u/components/global-style";
import { OrderCtaSection } from "@/Wings4u/components/order-cta-section";
// import { SpotlightSection } from "@/Wings4u/components/spotlight-section";
import { TestimonialsSection } from "@/Wings4u/components/testimonials-section";
import { GuestCartExpiryBanner } from "@/components/guest-cart-expiry-banner";
import { AuthHandoffErrorToast } from "@/components/auth-handoff-error-toast";
import { SiteFooter } from "@/components/site-footer";
import { Navbar } from "@/Wings4u/components/navbar";
import { styles } from "@/Wings4u/styles";
import { rememberAppRoute } from "@/lib/client-route-history";

/** Routes whose page component already renders its own `<main>`. */
function routeProvidesMain(pathname: string | null): boolean {
  if (!pathname) return false;

  return (
    pathname === "/sauces" ||
    pathname === "/menu" ||
    pathname === "/order" ||
    pathname === "/catering" ||
    pathname === "/privacy" ||
    pathname === "/terms"
  );
}

export function WingKingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showMarketingSections = pathname === "/";
  const isSaucesRoute = pathname === "/sauces";
  const isKdsRoute = pathname === "/kds" || pathname?.startsWith("/kds/");
  const isPosRoute = pathname === "/pos" || pathname?.startsWith("/pos/");
  const isAdminRoute = pathname === "/admin" || pathname?.startsWith("/admin/");
  const isAuthRoute = /^\/(login|signup)\/?$/.test(pathname ?? "");
  const pageHasOwnMain = routeProvidesMain(pathname);
  /** Login/signup use a neutral background; global embers sit above main (z-index 996) and add an orange wash. */
  const hideFireEmbers = isAuthRoute;
  /** Only scroll to top on real route changes — not on mount/remount while staying on the same path (fixes scroll jumping while reading the page). */
  const prevPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const previous = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    rememberAppRoute(pathname);

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

  const contentShellProps = {
    style: styles.appMain,
    className: "wk-shell-main",
  };

  const ContentShell = pageHasOwnMain ? "div" : "main";

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

  if (isPosRoute) {
    return (
      <div style={styles.app}>
        <WingKingsGlobalStyle />
        {children}
      </div>
    );
  }

  if (isAdminRoute) {
    return (
      <div style={styles.app}>
        <WingKingsGlobalStyle />
        {children}
      </div>
    );
  }

  if (isAuthRoute) {
    return (
      <div style={styles.app}>
        <WingKingsGlobalStyle />
        <main id="main-content" {...contentShellProps}>
          {children}
        </main>
        <AuthHandoffErrorToast />
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <WingKingsGlobalStyle />
      <Navbar />
      {hideFireEmbers ? null : <FireEmbers />}
      <ContentShell id={pageHasOwnMain ? undefined : "main-content"} {...contentShellProps}>
        {children}
        {/* {showMarketingSections ? <SpotlightSection /> : null} */}
        {showMarketingSections ? <TestimonialsSection /> : null}
        {showMarketingSections ? <OrderCtaSection /> : null}
      </ContentShell>
      <SiteFooter />
      <GuestCartExpiryBanner />
      <AuthHandoffErrorToast />
    </div>
  );
}
