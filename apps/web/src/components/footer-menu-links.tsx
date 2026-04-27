"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiJson } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import type { MenuResponse } from "@/lib/types";
import { buildDisplayMenuCategories } from "@/Wings4u/menu-display";

export function FooterMenuLinks() {
  const [categories, setCategories] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({
      location_id: DEFAULT_LOCATION_ID,
      fulfillment_type: "PICKUP",
    });

    let cancelled = false;

    void (async () => {
      try {
        const env = await apiJson<MenuResponse>(`/api/v1/menu?${query.toString()}`, {
          locationId: DEFAULT_LOCATION_ID,
        });
        if (cancelled || !env.data?.categories?.length) return;
        const rows = buildDisplayMenuCategories(env.data.categories);
        setCategories(rows.map((c) => ({ id: c.id, name: c.name })));
      } catch {
        if (!cancelled) setCategories([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (categories === null) {
    return (
      <>
        <div className="footer-menu-head-row">
          <h4>Menu</h4>
          <details className="footer-menu-disclosure footer-menu-disclosure--mobile">
            <summary className="footer-hours-toggle footer-menu-mobile-summary">Categories</summary>
            <div className="footer-menu-mobile-panel">
              <span className="footer-menu-loading">Loading...</span>
            </div>
          </details>
        </div>
        <div className="footer-menu-grid footer-menu-grid--desktop">
          <span className="footer-menu-loading">Loading...</span>
        </div>
      </>
    );
  }

  if (categories.length === 0) {
    return (
      <>
        <div className="footer-menu-head-row">
          <h4>Menu</h4>
          <details className="footer-menu-disclosure footer-menu-disclosure--mobile">
            <summary className="footer-hours-toggle footer-menu-mobile-summary">Categories</summary>
            <nav className="footer-menu-mobile-panel" aria-label="Menu categories">
              <Link href="/order">Order online</Link>
            </nav>
          </details>
        </div>
        <div className="footer-menu-grid footer-menu-grid--desktop">
          <Link href="/order">Order online</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="footer-menu-head-row">
        <h4>Menu</h4>
        <details className="footer-menu-disclosure footer-menu-disclosure--mobile">
          <summary className="footer-hours-toggle footer-menu-mobile-summary">Categories</summary>
          <nav className="footer-menu-mobile-panel" aria-label="Menu categories">
            {categories.map((c) => (
              <Link key={`m-${c.id}`} href={`/order#cat-${c.id}`}>
                {c.name}
              </Link>
            ))}
          </nav>
        </details>
      </div>
      <div className="footer-menu-grid footer-menu-grid--desktop">
        {categories.map((c) => (
          <Link key={c.id} href={`/order#cat-${c.id}`}>
            {c.name}
          </Link>
        ))}
      </div>
    </>
  );
}
