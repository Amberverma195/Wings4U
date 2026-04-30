"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { DEFAULT_LOCATION_ID } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { useSession, withSilentRefresh } from "@/lib/session";
import type { ApiEnvelope } from "@wings4u/contracts";
import { AccountSkeleton } from "@/components/account-skeleton";

import styles from "../support.module.css";

type Message = {
  id: string;
  author_user_id: string;
  message_body: string;
  is_internal_note: boolean;
  created_at: string;
};

type Event = {
  id: string;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

type TicketDetail = {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  ticket_type: string;
  order_id: string | null;
  customer_user_id: string;
  resolution_type: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  messages: Message[];
  events: Event[];
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

function priorityClass(priority: string): string {
  const map: Record<string, string> = {
    LOW: styles.priorityLow,
    NORMAL: styles.priorityNormal,
    HIGH: styles.priorityHigh,
    URGENT: styles.priorityUrgent,
  };
  return map[priority] ?? styles.priorityNormal;
}

function eventIcon(eventType: string): { label: string; className: string } {
  switch (eventType) {
    case "CREATED":
      return { label: "✦", className: styles.timelineDotCreated };
    case "STATUS_CHANGED":
      return { label: "↔", className: styles.timelineDotStatus };
    case "MESSAGE_ADDED":
      return { label: "💬", className: styles.timelineDotMessage };
    case "RESOLVED":
      return { label: "✓", className: styles.timelineDotResolved };
    default:
      return { label: "•", className: styles.timelineDotStatus };
  }
}

function eventLabel(e: Event): string {
  switch (e.event_type) {
    case "CREATED":
      return "Ticket created";
    case "STATUS_CHANGED":
      return `Status changed${e.from_value && e.to_value ? `: ${statusLabel(e.from_value)} → ${statusLabel(e.to_value)}` : ""}`;
    case "MESSAGE_ADDED":
      return "New message added";
    case "RESOLVED":
      return `Resolved${e.to_value ? ` — ${e.to_value.replace(/_/g, " ")}` : ""}`;
    default:
      return e.event_type.replace(/_/g, " ");
  }
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export function TicketDetailClient({ ticketId }: { ticketId: string }) {
  const session = useSession();

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);




  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/support/tickets/${ticketId}`, {
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      const body = (await res.json()) as ApiEnvelope<TicketDetail>;
      if (!res.ok) {
        throw new Error(getApiErrorMessage(body, `Load failed (${res.status})`));
      }
      setTicket(body.data!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [ticketId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await withSilentRefresh(
        () =>
          apiFetch(`/api/v1/support/tickets/${ticketId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message_body: reply.trim() }),
            locationId: DEFAULT_LOCATION_ID,
          }),
        session.refresh,
        session.clear,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body?.errors?.[0]?.message ?? `Send failed (${res.status})`,
        );
      }
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (!session.loaded) {
    return <AccountSkeleton />;
  }

  if (loading && !ticket) {
    return (
      <div className={styles.pageShell}>
        <main className={styles.hub}>
          <div className={styles.mainContainer}>
            <aside className={styles.sidebar}>
              <div className={styles.identityCard}>
                <h1 className={styles.name}>{session.user?.displayName ?? "Customer"}</h1>
                <div className={styles.phone}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  <span>{formatPhoneNumber(session.user?.phone) || "No phone"}</span>
                </div>
                <nav className={styles.supportNavLinks}>
                  <Link href="/account/support" className={styles.navLink}>
                    <span>Tickets</span>
                    <span className={styles.navLinkArrow}>→</span>
                  </Link>
                  <Link href="/account" className={`${styles.navLink} ${styles.navLinkBack}`}>
                    <span className={styles.navLinkArrowLeft}>←</span>
                    <span>Back to Account</span>
                  </Link>
                </nav>
              </div>
            </aside>
            <div className={styles.contentStack}>
              <div className={styles.loadingState}>
                {[0, 1].map((i) => (
                  <div key={i} className={styles.skeletonCard}>
                    <div className={`${styles.skeletonRow} ${styles.skeletonRowShort}`} />
                    <div className={styles.skeletonRow} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className={styles.pageShell}>
        <main className={styles.hub}>
          <div className={styles.alert}>{error ?? "Ticket not found."}</div>
          <Link href="/account/support" className={styles.backLink}>← Back to tickets</Link>
        </main>
      </div>
    );
  }

  const isCustomerMessage = (msg: Message) =>
    msg.author_user_id === ticket.customer_user_id;

  const canReply = ticket.status !== "CLOSED" && ticket.status !== "RESOLVED";

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

              <nav className={styles.supportNavLinks}>
                <Link href="/account/support" className={styles.navLink}>
                  <span>Tickets</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account/support/help" className={styles.navLink}>
                  <span>Help</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <Link href="/account" className={`${styles.navLink} ${styles.navLinkBack}`}>
                  <span className={styles.navLinkArrowLeft}>←</span>
                  <span>Back to Account</span>
                </Link>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <div className={styles.contentStack}>
            <Link href="/account/support" className={styles.backLink}>
              ← Back to all tickets
            </Link>

            {error && <div className={styles.alert} role="alert">{error}</div>}

            {/* Ticket Header */}
            <section className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <p className={styles.eyebrow}>
                      {ticket.ticket_type.replace(/_/g, " ")}
                    </p>
                    <h1 className={styles.detailSubject}>{ticket.subject}</h1>
                  </div>
                  <span className={`${styles.statusBadge} ${statusClass(ticket.status)}`}>
                    {statusLabel(ticket.status)}
                  </span>
                </div>

                <div className={styles.detailMeta}>
                  <span className={styles.detailMetaItem}>
                    Created {formatDateTime(ticket.created_at)}
                  </span>
                  <span className={styles.detailMetaItem}>·</span>
                  <span className={styles.detailMetaItem}>
                    Updated {relativeTime(ticket.updated_at)}
                  </span>
                  <span className={styles.detailMetaItem}>·</span>
                  <span className={`${styles.priorityBadge} ${priorityClass(ticket.priority)}`}>
                    {ticket.priority}
                  </span>
                </div>
              </div>

              <div className={styles.detailDescription}>
                {ticket.description}
              </div>
            </section>

            {/* Conversation */}
            <section className={styles.conversationCard}>
              <h2 className={styles.sectionTitle}>Conversation</h2>

              {ticket.messages.length === 0 ? (
                <p style={{ color: "#9ca3af", fontStyle: "italic" }}>
                  No messages yet. Add a reply below.
                </p>
              ) : (
                <div className={styles.messagesList}>
                  {ticket.messages.map((msg) => {
                    const isMine = isCustomerMessage(msg);
                    return (
                      <div
                        key={msg.id}
                        className={`${styles.messageBubble} ${
                          isMine ? styles.messageBubbleCustomer : styles.messageBubbleAdmin
                        }`}
                      >
                        <div className={styles.messageMeta}>
                          {isMine ? "You" : "Support Team"} · {formatDateTime(msg.created_at)}
                        </div>
                        <div className={styles.messageBody}>{msg.message_body}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {canReply && (
                <div className={styles.replyBox}>
                  <textarea
                    className={styles.replyTextarea}
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Write a reply…"
                  />
                  <div className={styles.replyActions}>
                    <button
                      type="button"
                      className={styles.sendBtn}
                      disabled={sending || !reply.trim()}
                      onClick={() => void sendReply()}
                    >
                      {sending ? "Sending…" : "Send Reply"}
                    </button>
                  </div>
                </div>
              )}

              {!canReply && (
                <p style={{ color: "#9ca3af", marginTop: "0.75rem", fontWeight: 600, fontSize: "0.88rem" }}>
                  This ticket has been {ticket.status.toLowerCase().replace(/_/g, " ")}. No further replies are possible.
                </p>
              )}
            </section>

            {/* Audit Timeline */}
            <section className={styles.timelineCard}>
              <h2 className={styles.sectionTitle}>Activity Timeline</h2>
              {ticket.events.length === 0 ? (
                <p style={{ color: "#9ca3af" }}>No events recorded.</p>
              ) : (
                <ul className={styles.timelineList}>
                  {ticket.events.map((e) => {
                    const icon = eventIcon(e.event_type);
                    return (
                      <li key={e.id} className={styles.timelineItem}>
                        <div className={`${styles.timelineDot} ${icon.className}`}>
                          {icon.label}
                        </div>
                        <div className={styles.timelineContent}>
                          <span className={styles.timelineLabel}>{eventLabel(e)}</span>
                          <span className={styles.timelineDate}>{formatDateTime(e.created_at)}</span>
                          {e.note && <span className={styles.timelineDetail}>{e.note}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
