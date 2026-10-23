import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalTable, type LegalSection } from "@/components/legal-page";
import { CUSTOMER_COOKIES, LOCAL_STORAGE, STAFF_COOKIES } from "@/lib/legal-disclosures";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({ title: "Privacy Policy", description: "How Wings 4 U handles account, order and delivery information, cookies, device storage and privacy requests.", path: "/privacy" });

const sections: LegalSection[] = [
  { id: "about", title: "Who we are and how to contact us", content: <>
    <p>This policy covers the Wings 4 U restaurant ordering website and mobile application serving London, Ontario. It explains what information we use, why we use it and your choices.</p>
    <address>Wings 4 U<br />1544 Dundas St, London, ON N5W 3C1, Canada<br />Telephone: <a href="tel:+15194880800">(519) 488-0800</a></address>
    <p>For privacy questions, access or correction requests, call and ask for the person responsible for privacy requests. Signed-in customers can also use <Link href="/account/support">account support</Link>. Do not include passwords or full payment-card details in a message.</p>
  </> },
  { id: "information", title: "Information we collect", content: <>
    <ul>
      <li><strong>Accounts:</strong> name, email, phone number, password verification data, verification codes and session records. Passwords are stored as hashes, not readable passwords.</li>
      <li><strong>Orders and delivery:</strong> items, quantities, customizations, order history, pickup/delivery choice, schedule, address, instructions, contact details, notes, payment/refund status and delivery verification. Verification records can include location evidence when the delivery workflow uses it.</li>
      <li><strong>Support and feedback:</strong> order chat, support tickets, complaints, cancellation/refund requests, ratings, reviews and staff replies. Catering inquiries contain the details you submit.</li>
      <li><strong>Rewards and credit:</strong> stamp balances, grants, redemptions and ledger history, and recorded wallet credits or refunds.</li>
      <li><strong>Security:</strong> IP addresses, user-agent information, request/session identifiers, random sign-up device identifiers and security/rate-limit records.</li>
    </ul>
    <p>You can browse menus and start a guest cart without an account. A guest cart is not a completed order. Customer website/app checkout requires sign-in and the information needed to fulfill your order. Avoid unnecessary sensitive information in free-text fields.</p>
    <p>Current checkout does not collect online card details. Cash or a physical card terminal at pickup/delivery is a collection preference, not an online charge. The physical terminal provider processes card details under its own practices.</p>
  </> },
  { id: "purposes", title: "How we use information", content: <>
    <p>We use information to create and secure accounts, prepare orders, calculate totals and delivery quotes, arrange pickup or delivery, send service updates, resolve complaints, manage stamps and credit, prevent abuse and maintain operational records. Relevant records also support disputes and applicable accounting, tax, legal and security obligations.</p>
    <p>We use the information needed for the feature you request. You can choose pickup without an address for route calculation, and use a new delivery address for an order without saving it to your address book.</p>
  </> },
  { id: "google-maps", title: "Google Maps and Delivery Pricing", content: <>
    <p>When you request delivery, you provide a delivery address. For distance-based delivery pricing, our backend sends that address to the <strong>Google Maps Platform Routes API</strong> to determine whether a driving route is available from the restaurant and calculate a distance-based delivery fee. Pickup does not require an address for this calculation.</p>
    <p>The route request includes the restaurant origin, destination address and driving-route settings. We do not intentionally add your name, phone number, email address, account identifier or payment information to it. Google processes the submitted address and request-related technical information under its own applicable terms and privacy practices.</p>
    <p>Read the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>, <a href="https://policies.google.com/terms">Google Terms of Service</a> and <a href="https://cloud.google.com/maps-platform/terms">Google Maps Platform Terms</a>. We do not control Google&apos;s retention and do not promise Google immediately deletes an address.</p>
    <p>The submitted address and route result are different records. Your selected address may remain in local ordering state, an order snapshot and, if you explicitly save it, your account address book. We use exact route distance to calculate a quote, but do not store Google&apos;s exact distance in the order record. Derived fee/availability results and signed quotes can be cached for up to one hour without storing exact distance in that cache.</p>
    <p>Quotes expire and can be rechecked. Fees and availability can change with the address, route, restrictions, schedule or other order circumstances. Review the current checkout quote before ordering.</p>
  </> },
  { id: "sharing", title: "Service providers and sharing", content: <>
    <p>Authorized restaurant staff and delivery personnel receive information needed to prepare, deliver and support orders. Providers support specific tasks:</p>
    <ul>
      <li><strong>Vercel:</strong> website hosting and website requests.</li>
      <li><strong>Railway:</strong> application API hosting and server processing.</li>
      <li><strong>Supabase:</strong> PostgreSQL database hosting for account, order and operational records.</li>
      <li><strong>Resend:</strong> email verification and service emails, including supported order-status and rewards-account updates. Relevant recipient and message details are provided for delivery.</li>
      <li><strong>Google Maps Platform:</strong> delivery-route processing described above.</li>
    </ul>
    <p>Providers and their subprocessors may process information outside Ontario or Canada, where other laws and lawful-access requirements can apply. We do not promise Canadian-only storage. Relevant records may also be disclosed when legally required or to address fraud, safety incidents or legal claims. External sites have their own privacy practices.</p>
  </> },
  { id: "cookies", title: "Cookies and Similar Technologies", content: <>
    <p><strong>HTTP cookies</strong> are browser records sent with matching website/API requests. <strong>localStorage</strong> remains until you clear it or the website removes it. <strong>sessionStorage</strong> is specific to a browser tab/session and can survive reloads or browser session restoration. The native app uses <strong>Expo SecureStore</strong> for authentication/device identifiers where available, and <strong>AsyncStorage</strong> for ordering preferences and recovery drafts.</p>
    <p>The cookies below support authentication, security and requested cart features. A lifetime describes an issued cookie, not the physical deletion of related server records. Cookies can end sooner on sign-out, clearing or session revocation.</p>
    <LegalTable caption="Customer cookies" columns={["Cookie", "Purpose", "Lifetime and cleanup"]} rows={CUSTOMER_COOKIES} />
    <p>Restaurant station cookies are for authorized staff devices, not ordinary customer browsing.</p>
    <LegalTable caption="Staff-only station cookies" columns={["Cookie", "Purpose", "Lifetime and cleanup"]} rows={STAFF_COOKIES} />
    <p>We do not currently use advertising or behavioural analytics cookies on this website. The listed browser features support ordering, authentication or abuse prevention. Outside sites you choose to visit have their own cookie practices.</p>
    <p>Browser settings let you block or clear cookies and site storage. Blocking authentication/security cookies can prevent sign-in or checkout; clearing storage can remove a cart or preference. We do not require consent to optional advertising processing as a condition of ordering.</p>
  </> },
  { id: "device-storage", title: "Browser and mobile storage", content: <>
    <p>Local information is not the same as a server record. Removing a browser cart draft does not remove an order already submitted; clearing the app does not delete your account.</p>
    <LegalTable caption="Local storage and recovery inventory" columns={["Storage category", "Purpose and data", "Retention or validity"]} rows={LOCAL_STORAGE} />
    <p>Application expiry generally means data stops being accepted and is cleaned up when the site/app next checks it. Storage does not erase itself while closed. Native sign-up identifiers deliberately survive ordinary sign-out and account deletion for abuse prevention and currently have no automatic time expiry.</p>
  </> },
  { id: "retention", title: "How long information is kept", content: <>
    <p>Guest saved carts become unusable after <strong>7 days</strong> without a meaningful cart update; signed-in saved carts after <strong>30 days</strong>. Viewing a cart does not extend its deadline. Legacy carts without an explicit deadline use the last saved-update time. Expiry is not a scheduled database purge: expired carts can remain stored until replaced by a new save or handled under a separate records process.</p>
    <p>Order-address snapshots support delivery and customer service even if you do not save an address to your account. Address-book entries remain until changed/removed or eligible account-deletion cleanup occurs.</p>
    <p>Other account, order, support, reward, financial, tax, dispute and security records are retained according to their purpose and applicable obligations. There is no single fixed retention period for every record or promise of immediate destruction of every copy. Minimized transaction/audit records can remain after account deletion; providers, exports and backups can follow separate retention processes.</p>
  </> },
  { id: "security", title: "Keeping information secure", content: <>
    <p>Safeguards include password hashing, authenticated sessions, access/ownership checks, request-security controls and rate limits. Native tokens use secure device storage where available, and roles restrict customer/staff features. These measures reduce risk but cannot guarantee absolute security of any service, storage or transmission.</p>
    <p>Protect credentials and devices, sign out on shared devices and tell the restaurant about suspected unauthorized use. We will not ask you to send a password in a support message.</p>
  </> },
  { id: "communications", title: "Service messages and marketing choices", content: <>
    <p>Verification, password recovery, order updates, support replies and rewards-account notifications relate to service use. Creating an account does not subscribe you to a separate marketing newsletter.</p>
    <p>For questions about promotional messages or to withdraw a marketing preference previously given to the restaurant, call or use account support. Necessary account/order messages may still be needed for requested services.</p>
  </> },
  { id: "rights", title: "Access, correction and account deletion", content: <>
    <p>Review and edit supported profile fields and saved addresses in your account. For access to other personal information, corrections or privacy concerns, call or use account support. We may verify identity before disclosing/changing information and explain restrictions affecting a request.</p>
    <p>Use <Link href="/account/delete">Delete your account</Link> or the mobile profile deletion control to review status, verify your password and confirm. A successful eligible deletion removes login access and eligible personal information and signs out your sessions. Some records are minimized and retained rather than deleted.</p>
    <p>Active/scheduled orders, pending payments/refunds, nonzero wallet balances, unresolved support/disputes, staff-history records or legal/business holds can require resolution first. Deletion does not cancel orders, refund payments or transfer credit. Available rewards require explicit loss-of-rewards confirmation. Follow the current status/completion message: starting or closing the form does not mean deletion completed.</p>
    <p>You may raise concerns with the <a href="https://www.priv.gc.ca/en/">Office of the Privacy Commissioner of Canada</a>. Nothing here removes privacy rights available under applicable law.</p>
  </> },
  { id: "children", title: "Children and young customers", content: <>
    <p>The service is for restaurant ordering and is not specifically directed to children. We do not operate a dedicated age-verification or parental-consent flow. Parents/guardians concerned that a child submitted personal information should contact the restaurant so the circumstances and an appropriate response can be reviewed.</p>
  </> },
  { id: "updates", title: "Policy updates", content: <>
    <p>Revised versions will be published at this URL with an updated date. Where applicable requirements call for additional notice or consent for a material change, we will provide that notice or seek consent before affected processing. Review the <Link href="/terms">Terms of Service</Link> for ordering conditions and contact us with questions.</p>
  </> },
];
export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" summary="How we handle your information, the services involved, and your choices when ordering with Wings 4 U." sections={sections} />;
}
