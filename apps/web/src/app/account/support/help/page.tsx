"use client";

import { useSession } from "@/lib/session";
import { AccountSkeleton } from "@/components/account-skeleton";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import styles from "../support.module.css";

export default function HelpPage() {
  const session = useSession();
  const [assistModalOpen, setAssistModalOpen] = useState(false);
  const [assistView, setAssistView] = useState<"main" | "orders">("main");
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (assistModalOpen && assistView === "orders" && session.loaded) {
      setLoadingOrders(true);
      apiFetch("/api/v1/orders/customer?limit=1")
        .then((res) => setOrders(res.orders || []))
        .catch(() => {})
        .finally(() => setLoadingOrders(false));
    }
  }, [assistModalOpen, assistView, session.loaded]);

  const closeAssist = () => {
    setAssistModalOpen(false);
    setAssistView("main");
  };

  if (!session.loaded) {
    return <AccountSkeleton />;
  }

  const faqs = [
    {
      question: "How do I track my order?",
      answer: "You can track your active orders in real-time on the 'Order History' page. We'll show you when your wings are being prepared and when they're ready for pickup or delivery."
    },
    {
      question: "Can I cancel my order?",
      answer: "Orders can be cancelled through the 'Order History' page within 2 minutes of placement. After that, please contact the store directly as we may have already started preparing your food."
    },
    {
      question: "How do stamps work?",
      answer: "For every pound of wings you order, you earn 1 stamp. Collect 8 stamps to unlock 1lb of wings for free! You can track your progress in your Profile."
    },
    {
      question: "Issue with your delivery?",
      answer: "If there's any problem with your delivery, you can use the live chat on the order tracking page or open a support ticket here. We'll make it right."
    }
  ];

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
                <span>{session.user?.phone || "No phone"}</span>
              </div>

              <nav className={styles.navLinks}>
                <Link href="/account/support" className={styles.navLink}>
                  <span>Tickets</span>
                  <span className={styles.navLinkArrow}>→</span>
                </Link>
                <div className={`${styles.navLink} ${styles.navLinkActive}`}>
                  <span>Help</span>
                  <span className={styles.navLinkArrow}>→</span>
                </div>
                <Link href="/account" className={`${styles.navLink} ${styles.navLinkBack}`}>
                  <span className={styles.navLinkArrowLeft}>←</span>
                  <span>Back to Account</span>
                </Link>
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <div className={styles.contentStack}>
            <header className={styles.hero}>
              <div className={styles.titleArea}>
                <p className={styles.eyebrow}>Support Center</p>
                <h1 className={styles.title}>How can we help?</h1>
                <p className={styles.subtitle}>
                  Browse our frequently asked questions or reach out to our team for assistance.
                </p>

                <div className={styles.helpHeaderCards}>
                  <div className={styles.contactCard}>
                    <h3>Need more help?</h3>
                    <p>Our support team is available daily from 11 AM to 10 PM.</p>
                    <button 
                      type="button" 
                      className={styles.supportBtn}
                      onClick={() => setAssistModalOpen(true)}
                    >
                      HELP
                    </button>
                  </div>

                  <div className={styles.contactCardSecondary}>
                    <h4>Store Contact</h4>
                    <p>For immediate order issues, please call the store directly.</p>
                    <a href="tel:5551234567" style={{ color: '#f97316', textDecoration: 'none', fontWeight: 800 }}>
                    (555) 123-4567
                  </a>
                  </div>
                </div>
              </div>
            </header>

            <div className={styles.helpGrid}>
              <section className={styles.faqSection}>
                <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
                <div className={styles.faqList}>
                  {faqs.map((faq, i) => (
                    <div key={i} className={styles.faqItem}>
                      <h3 className={styles.faqQuestion}>{faq.question}</h3>
                      <p className={styles.faqAnswer}>{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>

      {assistModalOpen && (
        <div className={styles.assistModalOverlay} onMouseDown={closeAssist}>
          <div className={styles.assistModalCard} onMouseDown={(e) => e.stopPropagation()}>
            <header className={styles.assistModalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {assistView !== "main" && (
                  <button className={styles.assistBackBtn} onClick={() => setAssistView("main")}>←</button>
                )}
                <h2>{assistView === "main" ? "How can we Assist You?" : "Select an Order"}</h2>
              </div>
              <button className={styles.assistModalClose} onClick={closeAssist}>✕</button>
            </header>

            <div className={styles.assistContent}>
              {assistView === "main" ? (
                <div className={styles.assistOptions}>
                  <button 
                    type="button" 
                    className={styles.assistOption} 
                    onClick={() => setAssistView("orders")}
                    style={{ width: '100%', textAlign: 'left', border: '1px solid #f3f4f6' }}
                  >
                    <span className={styles.assistOptionLabel}>Orders</span>
                  </button>
                  {/* More options can go here */}
                </div>
              ) : (
                <div className={styles.assistOrdersView}>
                  {loadingOrders ? (
                    <div className={styles.assistLoading}>Loading orders...</div>
                  ) : orders.length === 0 ? (
                    <div className={styles.assistEmpty}>No recent orders</div>
                  ) : (
                    <div className={styles.assistOrderList}>
                      {orders.map((order) => (
                        <Link 
                          key={order.id} 
                          href={`/account/support?new=true&topic=orders&orderId=${order.id}`}
                          className={styles.assistOrderCard}
                        >
                          <div className={styles.assistOrderTop}>
                            <span className={styles.assistOrderNumber}>#{order.id.slice(-6).toUpperCase()}</span>
                            <span className={styles.assistOrderDate}>
                              {new Date(order.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className={styles.assistOrderMeta}>
                            <span>{order.items?.length || 0} items</span>
                            <span className={styles.assistOrderTotal}>${(order.total_price / 100).toFixed(2)}</span>
                          </div>
                          <div className={styles.assistOrderAction}>Get help with this order →</div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
