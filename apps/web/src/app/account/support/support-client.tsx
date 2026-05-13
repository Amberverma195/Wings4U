"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AccountSkeleton } from "@/components/account-skeleton";

import styles from "./support.module.css";

type LatestPublicMessage = {
  message_body: string;
  author_user_id: string;
  created_at: string;
};

type TicketSummary = {
  id: string;
  subject: string;
  ticket_type: string;
  status: string;
  priority: string;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  latest_public_message: LatestPublicMessage | null;
};

type TicketsPage = {
  tickets: TicketSummary[];
  next_cursor: string | null;
};

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    OPEN: "Open",
    IN_REVIEW: "In Review",
    WAITING_ON_CUSTOMER: "Waiting on You",
    RESOLVED: "Resolved",
    CLOSED: "Closed",
  };
  return map[status] ?? status;
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    OPEN: styles.statusOpen,
    IN_REVIEW: styles.statusInReview,
    WAITING_ON_CUSTOMER: styles.statusWaiting,
    RESOLVED: styles.statusResolved,
    CLOSED: styles.statusClosed,
  };
  return map[status] ?? styles.statusOpen;
}

function ticketTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPhoneNumber(phone?: string | null) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length > 10) {
    const countryLength = digits.length - 10;
    const countryCode = digits.slice(0, countryLength);
    const main = digits.slice(countryLength);
    return `+${countryCode} (${main.slice(0, 3)})-${main.slice(3, 6)}-${main.slice(6)}`;
  }
  return phone;
}

export function SupportClient() {
  const session = useSession();


  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const router = useRouter();

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    session.clear();
    router.replace("/");
  }, [session, router]);







  const fetchTickets = useCallback(
    async (nextCursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (nextCursor) params.set("cursor", nextCursor);
        const res = await withSilentRefresh(
          () =>
            apiFetch(`/api/v1/support/tickets?${params}`, {
              locationId: DEFAULT_LOCATION_ID,
            }),
          session.refresh,
          session.clear,
        );
        const body = (await res.json()) as ApiEnvelope<TicketsPage>;
        if (!res.ok) {
          throw new Error(getApiErrorMessage(body, res.statusText));
        }
        const page = body.data!;
        if (nextCursor) {
          setTickets((prev) => [...prev, ...page.tickets]);
        } else {
          setTickets(page.tickets);
        }
        setCursor(page.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const isInitialLoading = loading && tickets.length === 0;

  if (!session.loaded || isLoggingOut) {
    return <AccountSkeleton isLoggingOut={isLoggingOut} />;
  }

  return (
    <div className={styles.pageShell}>
      <main className={styles.hub}>
        <div className={styles.mainContainer}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.identityCard}>
              <h1 className={styles.name}>{session.user?.displayName ?? "Customer"}</h1>
              <div className={styles.phone}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
              </div>

              <div className={styles.navLinksWrapper}>
                <nav className={styles.supportNavLinks}>
                  <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                    <span>Tickets</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </div>
                  <Link href="/account/support/help" className={styles.navLink}>
                    <span>Help</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <Link href="/account" className={`${styles.navLink} ${styles.navLinkBack}`}>
                    <span className={styles.navLinkArrowLeft}>←</span>
                    <span>Back to Account</span>
                  </Link>
                  <button onClick={handleLogout} className={`${styles.navLink} ${styles.navLinkLogout}`}>
                    <span>Logout</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </button>
                </nav>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className={styles.contentStack}>
            <header className={styles.hero}>
              <p className={styles.eyebrow}>Support</p>
              <h1 id="support-hub-title" className={styles.title}>My Tickets</h1>
              <p className={styles.subtitle}>
                View your support requests and track updates from our team.
              </p>
            </header>

            {error && <div className={styles.alert} role="alert">{error}</div>}

            {isInitialLoading ? (
              <div className={styles.loadingState}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={styles.skeletonCard}>
                    <div className={`${styles.skeletonRow} ${styles.skeletonRowShort}`} />
                    <div className={styles.skeletonRow} />
                    <div className={`${styles.skeletonRow} ${styles.skeletonRowMid}`} />
                  </div>
                ))}
              </div>
            ) : !loading && tickets.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🎫</div>
                <h2 className={styles.emptyTitle}>No tickets yet</h2>
                <p className={styles.emptyBody}>
                  If you have an issue with an order, you can create a support ticket from
                  your order details page and we&apos;ll get back to you quickly.
                </p>
              </div>
            ) : (
              <div className={styles.grid}>
                {tickets.map((t) => (
                  <Link
                    key={t.id}
                    href={`/account/support/${t.id}`}
                    className={styles.ticketCard}
                  >
                    <div className={styles.ticketCardTop}>
                      <div>
                        <div className={styles.ticketSubject}>{t.subject}</div>
                        <div className={styles.ticketType}>{ticketTypeLabel(t.ticket_type)}</div>
                      </div>
                      <span className={`${styles.statusBadge} ${statusClass(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </div>

                    {t.latest_public_message && (
                      <p className={styles.ticketPreview}>
                        {t.latest_public_message.message_body}
                      </p>
                    )}

                    <div className={styles.ticketMeta}>
                      <span>Created {relativeTime(t.created_at)}</span>
                      <span>Updated {relativeTime(t.updated_at)}</span>
                      {t.priority !== "NORMAL" && (
                        <span className={`${styles.priorityBadge} ${
                          t.priority === "LOW" ? styles.priorityLow :
                          t.priority === "HIGH" ? styles.priorityHigh :
                          t.priority === "URGENT" ? styles.priorityUrgent :
                          styles.priorityNormal
                        }`}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {cursor && !isInitialLoading && (
              <button
                type="button"
                className={styles.loadMoreBtn}
                disabled={loading}
                onClick={() => void fetchTickets(cursor)}
              >
                {loading ? "Loading…" : "Load more tickets"}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
