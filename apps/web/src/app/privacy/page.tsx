import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Privacy Policy",
  description: "How Wings 4 U collects, uses, and protects your personal information.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <main className="surface-page" style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1rem 4rem" }}>
      <h1>Privacy Policy</h1>
      <p className="surface-muted">Effective July 22, 2026</p>

      <section>
        <h2>Information we collect</h2>
        <p>
          We collect information needed to provide ordering and customer-account
          services, including your name, contact details, order history, payment
          status, delivery instructions, and delivery address. Payment card details
          are handled by our payment provider and are not stored by Wings 4 U.
        </p>
      </section>

      <section>
        <h2>How we use information</h2>
        <p>
          We use personal information to prepare and deliver orders, communicate
          order updates, support customer accounts, prevent fraud and abuse, meet
          legal obligations, and improve our services.
        </p>
      </section>

      <section>
        <h2>Delivery addresses and Google Maps</h2>
        <p>
          When you request delivery pricing at checkout, we send the delivery
          address to Google Maps Platform to confirm that a driving route is
          available and calculate the delivery fee. We do not place your name,
          account identifier, or payment information in that request, and we do not
          retain Google&apos;s route distance in our order records.
        </p>
        <p>
          Google processes this information under the{" "}
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
        <h2>Sharing and retention</h2>
        <p>
          We share information only with service providers that help operate
          ordering, payments, communications, delivery, hosting, and security, or
          when required by law. We retain order and account records only as long as
          reasonably needed for those purposes and applicable legal obligations.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You may review saved addresses and account information from your account.
          You can choose pickup instead of sending a delivery address for route
          confirmation. Contact us through customer support to ask about access,
          correction, or deletion of personal information, subject to records we
          must retain by law.
        </p>
      </section>
    </main>
  );
}
