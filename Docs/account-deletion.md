# Customer account deletion — implementation and activation review

Status: development only. Production activation is blocked pending the approvals below.
No database connection, mutation, migration, deployment, or real account deletion is authorized for this work.

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
| OrderPayment | Retain | Provider transaction/reference, tender, signed amounts, currency, outcome and time needed for payment/refund/tax evidence. Processor payload is strictly minimized; arbitrary metadata, notes, billing details and failure text removed. No Stripe API deletion/refund is performed. |
| RefundRequest | Require resolution when PENDING/APPROVED; otherwise retain minimized | Keep amounts/status/method/reference/timestamps and financial links; replace free-text reason. No refund promise or obligation is erased. |
| CustomerWallet | Require resolution if balance is nonzero; delete zero balance | Never confiscate credit or silently settle a debit. Settlement mechanism and service deadline require approval. |
| CustomerCreditLedger | Retain pseudonymous financial evidence | Preserve all entries, amounts, balances and refund/order links; replace free-text reasons. |
| CustomerWingsRewards | Delete after explicit rewards-loss consent | Backend requires consent when available stamps > 0. No implicit reward forfeiture. |
| CustomerWingsStampLedger | Retain minimized reconciliation record | Preserve order/entry uniqueness so repeated finalization cannot award twice; replace free-text reason, tombstone prevents use. |
| WingsStampGrantEmail | Delete | Owned grant email payload, recipient/name copies/provider email IDs/errors. Active lease blocks deletion until delivery attempt finishes/expires. |
| PromoRedemption | Retain minimized financial discount evidence | Keep amount/order/promo links and required customer FK; clear metadata. |
| SupportTicket | Require resolution when not RESOLVED/CLOSED; otherwise minimize | Replace subject/description and free text; retain refund/replacement links/status/type/timestamps. Account-owned and owned-order tickets included. |
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
| AdminAuditLog | Retain minimized | Match customer actor/entity and related record IDs; preserve action/type/role/time, erase arbitrary reasons/payloads. No contact or authorization data in new deletion audit. |
| EmployeeProfile / DriverProfile / AdminLocationAssignment | Require business resolution | Customer endpoint refuses mixed staff histories; customer self-service must not erase staff payroll/driver records. |
| CashDrawerEvent / RegisterSession / EmployeeShift / EmployeeBreak / InventoryAdjustment / RestockList / BusyModeEvent / PromoCode creator and other staff actor relations | Retain; mixed role review | These are staff operational records. Mixed staff history blocks activation for that account rather than blindly removing their records. Tombstone prevents dangling FKs. |
| PosLoginAttempt / KdsStationSession / PosStationSession / Device | Retain unchanged | Station/device security records do not identify a customer by FK; unknown external correlations require inventory review. |
| AccountDeletionAuthorization (new) | Consume once; delete on completion | Random bearer secret stored hashed, user/session/credential-bound, five-minute expiry. Unused grants removed on next verification. |
| AccountDeletionRequest (new) | Retain minimal audit | Request UUID, account tombstone FK, authorization digest, fixed blocker codes/status and timestamps; no contact information or free-text logs. |
| Email provider / Stripe / print spool / exported records / application logs / backups | Activation blocker: retention inventory approval | These are outside Prisma. Do not claim application SQL erases them. Approve necessary processor evidence, backup expiry/restore erasure procedure, and any external eligible-data cleanup before enabling. |

## Planned lifecycle and activation boundaries

Use the existing password verifier, HTTP auth/role guards, rate limiter, CSRF middleware, cookie clearing, native secure storage and realtime authorization. No account ID is accepted from clients.
The public deletion page will remain readable when signed out or activation is disabled.
An authenticated customer re-enters their password, receives a short-lived authorization, then deliberately confirms deletion.
The final request rechecks everything inside a serializable transaction while locking the User row.
If obligations exist, return `resolution_required` with specific fixed messages, consume that authorization and keep the account usable so the customer can handle orders/wallet/support. This is **not** an accepted pending deletion or a promise of automatic completion.
When eligible, erase/minimize data and invalidate all sessions atomically. Commit is the only completed state. No asynchronous erasure queue is needed.
Transient transaction conflicts are retried a bounded number of times. Other transaction failures roll back the authorization, request, data cleanup and tombstone together, permitting a deliberate retry while authorization is valid.

## Decisions required before production activation

- Approve the matrix, including deletion of delivery verification/free-text evidence and minimization of payment JSON; document retention periods, lawful purposes, access controls and eventual purge for pseudonymous financial/audit records.
- Approve a self-service way to resolve positive wallet credit and refund/dispute obligations without forfeiture, and a real time-bounded process for unresolved requests. The current application has no automatic cash-out workflow. The feature must remain disabled until this gap has an approved implementation/policy.
- Verify Stripe chargeback/legal-hold intake; the current schema has no comprehensive chargeback register. Do not infer that a paid order has no legal hold.
- Approve reward forfeiture consent and mixed staff-history handling.
- Inventory provider data, printer queues, exports, logs and backups; approve erasure/expiry and restoration procedures. Do not invent provider cleanup capabilities.
- Approve and execute the additive migration separately, validate triggers/FKs on an explicitly authorized non-production target, then coordinate backend/web/mobile release. No target is created or changed by this task.
- Keep `ACCOUNT_DELETION_ENABLED` absent/false and the policy-version acknowledgment unset until all prerequisites are approved. No environment file will be changed here.

## Store guidance reviewed

Apple requires a discoverable in-app initiation path and deletion beyond deactivation; Google Play requires in-app and web request paths. Neither has reviewed this implementation.
Primary sources: [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111) (reviewed 2026-10-20).
