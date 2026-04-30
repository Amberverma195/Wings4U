"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AdminSection = {
  href: string;
  label: string;
  description?: string;
};

const SECTIONS: AdminSection[] = [
  { href: "/admin", label: "Dashboard", description: "Live operations widgets" },
  { href: "/admin/menu", label: "Menu", description: "Manage items & categories" },
  { href: "/admin/promos", label: "Promos", description: "Manage promo codes" },
  { href: "/admin/approvals", label: "Approvals", description: "Cancellation & refund queues" },
  { href: "/admin/staff", label: "Staff", description: "Add staff & drivers" },
  { href: "/admin/order-changes", label: "Order changes", description: "Add-items requests" },
  { href: "/admin/orders", label: "Orders", description: "Search & order tools" },
  { href: "/admin/support", label: "Support", description: "Ticket queue" },
  { href: "/admin/reviews", label: "Reviews", description: "Reply & publish" },
  { href: "/admin/reports/sales", label: "Sales report" },
  { href: "/admin/reports/products", label: "Product performance" },
  { href: "/admin/reports/tax", label: "Daily tax" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/search", label: "Global search" },
  { href: "/admin/settings", label: "Store settings", description: "Admin only" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="surface-shell admin-shell">
      <div className="admin-shell-grid">
        <aside className="admin-sidebar surface-card">
          <p className="surface-eyebrow" style={{ margin: 0 }}>
            Admin
          </p>

          <nav aria-label="Admin sections">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <li style={{ marginBottom: "0.75rem" }}>
                <Link
                  href="/account/profile"
                  className={`admin-nav-link${isActive(pathname, "/account/profile") ? " admin-nav-link--active" : ""}`}
                >
                  <span className="admin-nav-link-label">My profile</span>
                  <span className="admin-nav-link-desc surface-muted">
                    Customer account & rewards
                  </span>
                </Link>
              </li>
              {SECTIONS.map((s) => {
                const active = isActive(pathname, s.href);
                return (
                  <li key={s.href} style={{ marginBottom: "0.3rem" }}>
                    <Link
                      href={s.href}
                      aria-current={active ? "page" : undefined}
                      className={`admin-nav-link${active ? " admin-nav-link--active" : ""}`}
                    >
                      <span className="admin-nav-link-label">{s.label}</span>
                      {s.description && (
                        <span className="admin-nav-link-desc surface-muted">
                          {s.description}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <section className="admin-content">{children}</section>
      </div>
    </main>
  );
}
