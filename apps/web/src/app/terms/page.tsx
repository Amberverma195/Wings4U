import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Terms of Service",
  description: "Terms and conditions for using the Wings 4 U website and ordering services.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <main className="surface-page" style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1rem 4rem" }}>
      <h1>Terms of Service</h1>
      <p className="surface-muted">Effective July 22, 2026</p>

      <section>
        <h2>Ordering</h2>
        <p>
          By placing an order, you confirm that the order details, fulfillment
          method, contact information, and delivery address are accurate. Menu
          availability, operating hours, minimum order amounts, promotions, taxes,
          and estimated preparation times may change before an order is accepted.
        </p>
      </section>

      <section>
        <h2>Delivery pricing and availability</h2>
        <p>
          Delivery fees are calculated at checkout from the driving route to the
          submitted address. A displayed quote is valid only until its stated
          expiry and may be revalidated when the order is placed. Delivery may be
          unavailable because of distance, postal zone, operating hours, account
          eligibility, or other safety and operational limits. Pickup remains
          available when the restaurant is accepting pickup orders.
        </p>
        <p>
          Route confirmation uses Google Maps Platform. Your use of map-supported
          features is also subject to the{" "}
          <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer">
            Google Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Payments, changes, and cancellations</h2>
        <p>
          You authorize the selected payment method for the final total shown at
          checkout. Order changes and cancellations are not guaranteed after food
          preparation begins. Refunds, when approved, are returned through the
          applicable payment method or another method permitted by law.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not misuse the website, attempt to bypass pricing or eligibility
          checks, interfere with service operation, or submit fraudulent orders.
          We may limit or suspend access when reasonably necessary to protect
          customers, staff, and the service.
        </p>
      </section>

      <section>
        <h2>Service and policy changes</h2>
        <p>
          The service is provided on an as-available basis to the extent permitted
          by law. We may update these terms when our services or legal obligations
          change. The effective date above identifies the current version. Contact
          us through customer support with questions about these terms.
        </p>
      </section>
    </main>
  );
}
