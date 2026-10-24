import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { createPageMetadata } from "@/lib/seo/metadata";
export const metadata: Metadata = createPageMetadata({ title: "Terms of Service", description: "Website and mobile ordering terms, in-person payments, delivery, cancellations, refunds and Wings Rewards.", path: "/terms" });

const sections: LegalSection[] = [
  { id: "service", title: "Our restaurant and these terms", content: <>
    <p>These terms describe the Wings 4 U website/mobile app for menu browsing, accounts, ordering, pickup/delivery, support and rewards. Wings 4 U operates at 1544 Dundas St, London, ON N5W 3C1, Canada. Call <a href="tel:+15194880800">(519) 488-0800</a> or use <Link href="/account/support">account support</Link>.</p>
    <p>Review these terms before ordering. The <Link href="/privacy">Privacy Policy</Link> covers order/account information, Google Maps, cookies and local storage. These terms do not exclude rights or remedies that cannot lawfully be excluded.</p>
  </> },
  { id: "accounts", title: "Accounts and your responsibilities", content: <>
    <p>Browse and start a cart as a guest; customer website/app checkout requires sign-in. Provide accurate information, secure your credentials and use an account you are authorized to use. Review orders and promptly report suspected unauthorized use.</p>
    <p>Keep contact and delivery details current and reachable. Do not send passwords or verification codes in support messages. <Link href="/account/delete">Account deletion</Link> is available on the website and mobile profile, subject to the status and unresolved obligations explained there.</p>
  </> },
  { id: "ordering", title: "Placing and accepting orders", content: <>
    <p>Review items, quantities, customizations, fulfillment method, schedule, contact/address details and final total before submitting. A cart, menu preview or quote is not an accepted restaurant order. Submission sends an order request; follow its order number and status for restaurant acceptance and fulfillment.</p>
    <p>Stock, hours or other operational restrictions can prevent fulfillment. Contact us if status is unclear; repeatedly submitting an uncertain request can create separate orders. Historical orders and saved configurations may need changes when menu options change.</p>
  </> },
  { id: "prices", title: "Menu prices, taxes and fees", content: <>
    <p>Prices are in Canadian dollars. Current menu prices, customization charges, discounts, applicable taxes, delivery fees and selected tips are shown in checkout totals. The server rechecks items and eligibility; review a revised total when asked before submission.</p>
    <p>Availability, portion choices, schedules and specials can differ by item or order type. Menu images and descriptions explain products but do not establish an ingredient or allergy guarantee.</p>
  </> },
  { id: "fulfillment", title: "Pickup, delivery and scheduling", content: <>
    <p>Choose an available pickup/delivery time. Preparation and travel estimates are not guaranteed arrival times. Hours, capacity, traffic, weather and safety can affect fulfillment. Delivery is limited by supported addresses, distance/postal zones and order eligibility.</p>
    <p>Provide the correct street/unit, postal code, access instructions and reachable phone number. Cooperate with delivery verification when requested. Contact staff promptly about mistakes, delays or missed delivery instead of assuming cancellation. Pickup does not require an address for delivery-route calculation.</p>
  </> },
  { id: "maps", title: "Google Maps and delivery quotes", content: <>
    <p>Distance-based delivery pricing uses Google Maps Platform Routes API through our backend to check a driving route and calculate the fee. Quotes last until their stated expiry and can be revalidated at placement. Address/route changes, order circumstances and restrictions can change pricing or availability.</p>
    <p>Map-supported features are subject to applicable <a href="https://policies.google.com/terms">Google Terms of Service</a>. See the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>, <a href="https://cloud.google.com/maps-platform/terms">Google Maps Platform Terms</a> and <Link href="/privacy#google-maps">our delivery-data explanation</Link>. Google&apos;s terms do not replace your rights concerning the restaurant order.</p>
  </> },
  { id: "payment", title: "Payment is collected in person", content: <>
    <p><strong>Wings 4 U does not currently collect online customer payments through website/app checkout.</strong> Selecting a collection preference is not proof of payment, a card authorization or a paid-order receipt.</p>
    <ul><li><strong>Pickup:</strong> Pay at Store with cash or an in-person physical card terminal.</li><li><strong>Delivery:</strong> Cash on Delivery, or Card on Delivery using the driver&apos;s physical payment terminal.</li></ul>
    <p>Be ready to pay the amount due with the agreed method. Card details are processed by the terminal provider, not entered into online checkout. If eligible wallet credit is applied, review the remaining amount. Never put card details in notes or support messages.</p>
  </> },
  { id: "cancellations", title: "Order changes and cancellations", content: <>
    <p>Eligible orders offer self-cancellation in Order History within the displayed cancellation window and before preparation prevents it. Availability depends on status. Afterwards, use order chat/help or call staff to request a change/cancellation; a request does not itself cancel the order.</p>
    <p>Changes/cancellations may be unavailable once preparation or delivery is underway. Follow the final status and staff response. Cancelling an unpaid order does not create an online payment reversal; deleting an account does not cancel an order.</p>
  </> },
  { id: "refunds", title: "Problems, refunds and disputes", content: <>
    <p>For incorrect, missing or unsatisfactory food, contact staff by phone or order help/support with the order number and details. Staff review complaints, cancellation, refund and credit requests against the order and recorded collection. Applicable consumer rights remain; these terms impose no blanket no-refunds rule.</p>
    <p>If a cash or physical-terminal transaction is eligible for refund, staff arrange the appropriate cash or original-terminal payment process. The website/app does not automatically refund a card or reverse a terminal payment. Where applicable and agreed, staff can issue recorded store credit to an eligible account. Ask which remedy/method applies; we do not promise automatic approval, an eligibility deadline or processing time.</p>
  </> },
  { id: "promotions", title: "Coupons, first-order offers and specials", content: <>
    <p>Offers depend on live configuration and checkout eligibility: items/categories, order type, dates/times, minimum spend, usage limits, prior order history and caps can apply. First-order offers require server-confirmed eligibility and depend on the current offer. A banner or remembered code does not guarantee a fixed discount forever.</p>
    <p>Party Specials are excluded from coupon-eligible merchandise under current rules. Lunch specials have their own availability windows and configured eligibility; do not assume a coupon covers every special or addon. The checkout quote identifies the actual discount. Other eligible items in a mixed cart may still receive a discount.</p>
    <p>Choose one coupon/deal or Wings reward; coupons cannot be combined with Wings reward redemption. A configured first-order deal can contain multiple benefits as one offer, as shown in its quote. Offers are not cash, permanent prices or unlimited-use guarantees. Report apparent errors instead of bypassing eligibility checks.</p>
  </> },
  { id: "rewards", title: "Wings stamps and rewards", content: <>
    <p>Wings Rewards is account-based. Eligible orders earn one stamp per whole qualifying pound when their status becomes Picked Up or Delivered, including delivery completed without a PIN. Stamp earning depends on completed order status, not a separate staff record of payment collection. Qualifying regular wings, wing combos and configured party packs can earn stamps; lunch specials and Wings 4 U Special do not. Free reward wings are excluded from qualifying weight, and the remaining fractional pounds are rounded down. The available stamp balance is capped at 16, saving up to two rewards; stamps above that cap do not carry over. Stamps previously skipped at the old cap are not restored.</p>
    <p>The current rule requires eight available stamps to redeem one eligible individual 1 lb wings unit, with one reward per order. That item must be in the cart; larger sizes, packs and combos do not substitute for it. Redeeming at 16 leaves eight stamps and one reward available. Other items, extras, taxes and delivery charges may remain payable as shown in the live quote. Balance and eligibility are rechecked when ordering, and coupons cannot be stacked with redemption.</p>
    <p>Check the profile balance and ledger. Stamps are distinct from wallet money and are not a cash balance. Program terms/offers may change prospectively; raise errors or disputes with support. Deletion requires explicit confirmation before available rewards are lost and does not silently forfeit a nonzero wallet balance.</p>
  </> },
  { id: "reviews", title: "Reviews, messages and other content", content: <>
    <p>Reviews are tied to eligible completed orders. Submit honest, relevant content you are authorized to share. Do not include other people&apos;s private information, threats, unlawful material or payment credentials. Staff can reply, moderate and approve public reviews. Approved public reviews use neutral attribution rather than publishing private contact details; your own text may still identify you.</p>
    <p>Support tickets/order chat are service channels, not public forums. Submitted content can be used to address your request and, for approved reviews, display the review and reply. You retain rights you hold in your own content; we do not claim ownership of everything you submit.</p>
  </> },
  { id: "allergies", title: "Allergies and food information", content: <>
    <p>For allergies, intolerances or dietary requirements, speak directly with staff before ordering. Menu labels and customization notes do not guarantee accommodation or freedom from cross-contact. Ingredients/preparations can change; we do not promise an allergen-free kitchen.</p>
    <p>Do not rely on an unconfirmed free-text note for a serious allergy. If staff cannot confirm a suitable option, do not assume safety. Follow food-handling guidance provided with the order. This does not remove applicable food-safety or consumer obligations.</p>
  </> },
  { id: "use", title: "Acceptable use and service limitations", content: <>
    <p>Do not submit fraudulent orders/reviews, abuse staff/customers, scrape or disrupt the service, attempt unauthorized access or bypass security, pricing, payment or eligibility controls. Reasonable rate limits and restrictions may protect the platform and affected people.</p>
    <p>We cannot guarantee uninterrupted access, error-free software, connectivity or third-party availability. Contact us about uncertain orders before retrying. Saved carts expire after seven days for guests or thirty days for signed-in customers without a meaningful update; carts are not order reservations.</p>
  </> },
  { id: "content-links", title: "Our content and external services", content: <>
    <p>Branding, menu presentation, photos and software belong to their respective rights holders. Use the website/app for intended browsing, ordering and account functions. These terms do not license unrelated commercial reproduction of protected content or branding.</p>
    <p>External sites, hosting, email, mapping and physical card terminals have their own terms/practices. We do not control those services. Their inclusion does not waive rights against Wings 4 U concerning an order.</p>
  </> },
  { id: "rights-updates", title: "Your legal rights, updates and contact", content: <>
    <p>Applicable Ontario and Canadian law, including non-waivable consumer/privacy protections, continues to apply. These terms do not require giving up statutory rights, a blanket exclusion of liability, or accepting store credit where the law requires another remedy.</p>
    <p>Revisions appear at this URL with a revised date. Material changes receive additional notice/consent where required; publishing an update does not mean previously accepted order terms can be changed retroactively. Call <a href="tel:+15194880800">(519) 488-0800</a> or use <Link href="/account/support">account support</Link> for questions, complaints or an accessible explanation.</p>
  </> },
];
export default function TermsPage() {
  return <LegalPage title="Terms of Service" summary="What to expect when browsing, ordering, paying in person and using your Wings 4 U account." sections={sections} />;
}
