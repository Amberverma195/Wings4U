# Customer account deletion — implementation and activation review

Status: development only. Production activation is blocked pending the approvals below.
No database connection, mutation, migration, deployment, or real account deletion is authorized for this work.
Policy version: `2026-10-20-review-2` (environments acknowledging `review-1` are automatically disabled).

## Payment model this policy assumes

Wings4U collects payment **in store only**: cash, or a physical card terminal, at pickup or on delivery.
Customers choose a collection preference (`PAY_AT_STORE`, `CASH_ON_DELIVERY`, `CARD_ON_DELIVERY`); that is not a payment.
Payments, refunds and tax evidence are the staff-recorded `order_payments` rows, `refund_requests`, and the wallet ledger.

Verified in code (2026-10-20):

- Backend checkout rejects `ONLINE_CARD` unless `ONLINE_PAYMENTS_ENABLED=true` (`checkout.service.ts`, before any other work).
- Creating a Stripe PaymentIntent requires that flag **and** real Stripe keys (`stripe-payments.service.ts` `createCheckoutPaymentIntent`).
- The Stripe webhook verifies signatures but performs no writes.
- The website checkout always sends `PAY_AT_STORE` and contains no Stripe code.
- The mobile app bundles the Stripe SDK but only offers card payment when the API reports `online_payments_enabled && configured`.

Consequence: with `ONLINE_PAYMENTS_ENABLED` unset or false (the default), no customer card can be charged online,
so there is no processor-side charge that can exist without an order row. Deletion therefore needs no Stripe reconciliation.
To keep that assumption true, `accountDeletionEnabled()` returns false whenever `ONLINE_PAYMENTS_ENABLED=true`.
Enabling online payments in the future requires a new deletion policy review (pending-charge tracking, dispute intake,
processor data inventory) and a new policy version.

The dormant Stripe integration (public config/webhook routes, the customer PaymentIntent route, the mobile SDK) is a
separate security and maintenance item, not an account-deletion concern while the flag is off.

## Reviewed relationship and retention matrix (before schema changes)

The schema was reviewed on 2026-10-20. `User` cannot safely be cascade-deleted:
financial ledgers and operational actors have required foreign keys and mixed Cascade/NoAction rules.
Keep a locked, inactive tombstone with a random existing UUID and no credentials or contact details.
Retained financial links are pseudonymous, not claimed to be anonymous: processor references can still identify a transaction.
The proposed retention purposes below require business/legal approval; this document does not establish a legal retention period.

| Model / relationship | Action | Scope and reason |
| --- | --- | --- |
| User | Irreversibly remove personal fields; retain tombstone | Fixed display label, null first/last name/password/profile-change timestamp; inactive, archived, accountDeletedAt; immutable after completion. Required financial/actor FKs remain valid. |
| UserIdentity | Delete | All providers, provider subjects, verified contact identifiers. Frees uniqueness for a completely new account. |
| AuthOtpCode | Delete | All identity-owned verification/reset/contact-change records, including pending new contacts. |
| AuthSession | Delete | All sessions, refresh hashes, device descriptions and IPs. Other users' revokedBy pointers are not deleted. |
| CustomerProfile | Delete | Preferences, marketing flag, preferred name and customer behavioral counters. |
| CustomerAddress | Delete | All saved addresses, labels and canonical keys. |
| SavedCart / SavedCartItem | Delete | All owned carts in every state; item cascade is limited to these carts. |
| CheckoutIdempotencyKey | Delete | Owned checkout request fingerprints/keys. Order itself remains. |
| Order | Retain financial record; erase identity snapshots | Name becomes `Deleted customer`; required phone becomes empty text (no nonempty/phone CHECK found in migrations); email/delivery phone/address/notes/cancellation reason removed. Keep UUID customer link to tombstone for guarding late operations and financial reconciliation. |
| Order.pricingSnapshotJson | Minimize | Numeric price/tax totals and recognized collection preference only; no arbitrary strings, promo codes, or unrecognized JSON. Normalized financial columns remain intact. |
| Order.revalidationDiffJson | Delete value | Arbitrary copied client/free text is not necessary accounting evidence. |
| OrderItem | Retain item accounting; erase free text / builder JSON | Keep product/category/quantity/price snapshots, normalized modifiers/flavours/wing configuration. Special instructions and arbitrary builder payload removed. |
| OrderItemModifier / OrderItemFlavour / OrderItemWingConfig | Retain | Normalized catalogue options and quantity/price/portion evidence, no customer identity fields. |
| OrderDiscount | Retain amount/type/promo linkage; erase description/reason | Discounts and tax reconciliation survive. appliedByUserId has no declared User FK; no new customer name is retained. |
| OrderPayment | Retain | Cash and card-terminal captures, refunds, adjustments: tender, signed amounts, currency, outcome, collector and time for payment/refund/tax evidence. Processor payload (in-store records carry only collection fields) is strictly minimized; notes and failure text removed. No processor API call is made. |
| RefundRequest | Require resolution when PENDING/APPROVED; otherwise retain minimized | Keep amounts/status/method/reference/timestamps and financial links; replace free-text reason. No refund promise or obligation is erased. Later refunds on a deleted customer's order are allowed by cash or original payment only (see workflow below). |
| CustomerWallet | Require resolution if balance is nonzero; delete zero balance | Never confiscate credit or silently settle a debit. No new wallet or credit can ever be created for a deleted account (API check plus database trigger). |
| CustomerCreditLedger | Retain pseudonymous financial evidence | Preserve all entries, amounts, balances and refund/order links; replace free-text reasons. Retained rows stay updatable; the reason text is re-erased by trigger. |
| CustomerWingsRewards | Delete after explicit rewards-loss consent | Backend requires consent when available stamps > 0. No implicit reward forfeiture. |
| CustomerWingsStampLedger | Retain minimized reconciliation record | Preserve order/entry uniqueness so repeated finalization cannot award twice; replace free-text reason, tombstone prevents use. |
| WingsStampGrantEmail | Delete | Owned grant email payload, recipient/name copies/provider email IDs/errors. Active lease blocks deletion until delivery attempt finishes/expires. |
| PromoRedemption | Retain minimized financial discount evidence | Keep amount/order/promo links and required customer FK; clear metadata. |
| SupportTicket | Require resolution when not RESOLVED/CLOSED; otherwise minimize | Replace subject/description and free text; retain refund/replacement links/status/type/timestamps. Account-owned and owned-order tickets included. Staff can still reopen, message, resolve or link orders on retained tickets; the trigger re-applies the erased subject/description on every update. |
| SupportTicketMessage / Event / Resolution | Minimize | Remove message bodies, notes, event values/payloads in owned tickets, plus customer's authored messages/events elsewhere. Keep resolution money/refund/replacement references. |
| OrderConversation | Retain | Thread identifiers/close times only; messages minimized, cancellation thread FKs stay valid. |
| OrderMessage | Erase body | All messages in owned orders plus customer's messages elsewhere; preserve IDs for cancellation/read pointers. |
| ChatReadState | Delete | Customer's state plus state for owned orders. |
| ChatSideReadState | Delete | Owned-order read cursors; no independent identity field. |
| ItemReview | Delete | Customer-authored reviews and reviews of owned orders. |
| DriverDeliveryReview / DriverDeliveryReviewTag | Delete | Customer-authored reviews; dependent tags cascade only with these reviews. |
| CateringInquiry | Require resolution unless CLOSED/CANCELLED/COMPLETED; delete resolved | Delete customer-linked inquiry contact/event/message records; do not match unrelated guest inquiries by email. |
| DeliveryPinVerification | Delete | Terminal owned orders only; PIN plaintext/hash, attempts and bypass free text removed. Approval must cover loss of delivery verification evidence. |
| OrderStatusEvent / OrderEtaEvent / OrderDriverEvent | Retain minimized operational evidence | Keep statuses/times/actor/driver links; erase free-text reasons/notes/payloads for owned orders or customer actor. |
| CancellationRequest | Require resolution if still pending; retain minimized | Keep decision/status/timing and thread links, erase reason/decision text. |
| OrderFinalizationEvent | Retain | Fixed prompt version, terminal status/time and actor link; no direct contact fields. |
| DriverPayoutOrderLink / DriverPayout / DailyTaxSummary | Retain unchanged | Order-level payout amounts and aggregate tax records; no customer identity field. |
| AdminAuditLog | Retain minimized | Match customer actor/entity and related record IDs; preserve action/type/role/time/actor columns. Payload keeps numbers, booleans, record UUIDs, enum codes (e.g. `CASH`, `ORIGINAL_PAYMENT`, `APPROVE`), numeric order numbers and ISO timestamps; drops free text and any key naming contact, note, reason, message, device or metadata. Reason text is cleared. Refund/credit approvals remain reconstructable. |
| EmployeeProfile / DriverProfile / AdminLocationAssignment | Require business resolution | Customer endpoint refuses mixed staff histories; customer self-service must not erase staff payroll/driver records. |
| CashDrawerEvent / RegisterSession / EmployeeShift / EmployeeBreak / InventoryAdjustment / RestockList / BusyModeEvent / PromoCode creator and other staff actor relations | Retain; mixed role review | These are staff operational records. Mixed staff history blocks activation for that account rather than blindly removing their records. Tombstone prevents dangling FKs. |
| PosLoginAttempt / KdsStationSession / PosStationSession / Device | Retain unchanged | Station/device security records do not identify a customer by FK; unknown external correlations require inventory review. |
| AccountDeletionAuthorization (new) | Consume once; delete on completion | Random bearer secret stored hashed, user/session/credential-bound, five-minute expiry. Unused grants removed on next verification. |
| AccountDeletionRequest (new) | Retain minimal audit | Request UUID, account tombstone FK, authorization digest, fixed blocker codes/status and timestamps; no contact information or free-text logs. |
| Email provider / print spool / card-terminal provider / exported records / application logs / backups | Activation blocker: retention inventory approval | These are outside Prisma. Do not claim application SQL erases them. Approve backup expiry/restore erasure procedure and any external eligible-data cleanup before enabling. Stripe holds no customer data while online payments have never been enabled; confirm this from the Stripe dashboard before activation. |

## Refunds after a customer deletes their account

Store credit is unusable after deletion (no login, no wallet), so it is refused:

- `WalletsService.creditInTransaction` rejects any credit to a deleted account with a 422 explaining the alternative.
  This covers refund approval and manual admin credits. The database trigger is the backstop.
- Approving a refund without choosing a method no longer defaults to store credit for a deleted customer; staff must pick one.
- The admin approvals screen hides "Store credit" for these orders, defaults to "Original payment", and shows why.

Staff workflow for a deleted customer's refund (customer identifies the order by receipt/order number at the store):

1. Confirm the order and amount in the admin order view (the order and its payments are retained).
2. Refund in person: cash from the drawer, or a refund to the original card on the physical terminal.
3. Approve the refund request with `CASH` or `ORIGINAL_PAYMENT`. This writes a `REFUND` payment row (`CASH` or `CARD`),
   which feeds the existing collected/refundable totals and tax reports. The API refuses to refund more than was collected.
4. The approval is audit-logged with amount, method and decision; those fields survive any later minimization.

Wallet balances and unresolved refunds are still protected before deletion: a nonzero wallet, a PENDING/APPROVED refund,
an unpaid or partially paid order, or a pending payment blocks deletion until staff resolve it.

## Planned lifecycle and activation boundaries

Use the existing password verifier, HTTP auth/role guards, rate limiter, CSRF middleware, cookie clearing, native secure storage and realtime authorization. No account ID is accepted from clients.
The public deletion page will remain readable when signed out or activation is disabled.
An authenticated customer re-enters their password, receives a short-lived authorization, then deliberately confirms deletion.
The final request rechecks everything inside a serializable transaction while locking the User row.
If obligations exist, return `resolution_required` with specific fixed messages, consume that authorization and keep the account usable so the customer can handle orders/wallet/support. This is **not** an accepted pending deletion or a promise of automatic completion.
When eligible, erase/minimize data and invalidate all sessions atomically. Commit is the only completed state. No asynchronous erasure queue is needed.
Transient transaction conflicts are retried a bounded number of times. Other transaction failures roll back the authorization, request, data cleanup and tombstone together, permitting a deliberate retry while authorization is valid.

## Order-status emails

Each order-status email re-reads the customer's deletion state immediately before sending and skips deleted accounts.
No transaction or row lock is held during the email provider call, so the API's small connection pool (5) is never
tied up waiting on email. Accepted residual window: deletion requires every order to be finished, so the only possible
overlap is a final-status email (for example Delivered) whose provider call is already in flight, at most 10 seconds,
when deletion commits. That sends one email about the customer's own order to the address on that order.

## Release order (required)

This API build reads `users.account_deleted_at` on every authenticated request (Prisma loads all User columns).
At startup it runs a read-only catalog check and **refuses to start** if migration
`20261020120000_customer_account_deletion` is missing, so a wrong order fails the deploy instead of breaking logins.

1. Validate the migration on a disposable, non-production Postgres (trigger behaviour, FKs, RLS with the API's role).
2. Apply the migration to production (`npm run prisma:deploy --workspace @wings4u/database`) with explicit approval.
   It is additive and inert for the currently deployed API: no account is deleted, so no trigger changes any row.
3. Deploy the API, then the website and mobile app. Deletion stays disabled until step 4.
4. Activate only after every item below is approved.

## Decisions required before production activation

- Approve the matrix, including deletion of delivery verification/free-text evidence and minimization of payment and audit JSON; document retention periods, lawful purposes, access controls and eventual purge for pseudonymous financial/audit records.
- Approve how customers resolve a positive wallet balance before deletion (in-store cash-out or spend), since deletion never forfeits or transfers credit.
- Approve a staff procedure for recording an `account_deletion_holds` row (code `LEGAL_HOLD`, `REFUND_RECONCILIATION` or `BUSINESS_REVIEW`) when a dispute, legal request or card-terminal chargeback notice exists. No code writes holds today; it is a manual record. Card-terminal chargebacks arrive from the terminal provider, not from the app.
- Decide policy for orders stuck in `UNPAID`/`FAILED` (for example no-show pickups): today they block deletion indefinitely and the customer cannot resolve them.
- Approve reward forfeiture consent and mixed staff-history handling.
- Inventory email provider data, printer queues, exports, logs and backups; approve erasure/expiry and restoration procedures. Do not invent provider cleanup capabilities.
- Load-test deletion on a staging copy with a large order history (thousands of orders); the transaction has a 30-second limit.
- Confirm `ONLINE_PAYMENTS_ENABLED` is unset/false in production. Deletion refuses to enable otherwise.
- Keep `ACCOUNT_DELETION_ENABLED` absent/false and the policy-version acknowledgment unset until all prerequisites are approved. No environment file will be changed here.

## Store guidance reviewed

Apple requires a discoverable in-app initiation path and deletion beyond deactivation; Google Play requires in-app and web request paths. Neither has reviewed this implementation.
Primary sources: [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111) (reviewed 2026-10-20).
