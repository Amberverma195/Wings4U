# API Spec

**Canonical API contract:** [`Wings4U_API_Contract_v1_0.md`](./Wings4U_API_Contract_v1_0.md) (frozen for launch)

This folder is now the canonical home of the API contract.

If you arrived from the older path at `Docs/Wings4U_API_Contract_v1_0.md`, that file now exists only as a redirect note so older links do not break.

The contract covers:

- endpoint inventory (auth, menu, cart/checkout, orders, chat, support, POS, KDS/manager ops, admin, drivers, timeclock)
- browser auth (Secure HTTP-only cookies, CSRF) and device auth (X-Device-Token)
- location-scope rules (X-Location-Id header)
- request and response shapes with examples
- error patterns (standard error codes + business errors per endpoint)
- idempotency rules (checkout, payment capture, refund issuance, credit issuance)
- realtime payload contracts (WebSocket channels + polling fallback)
- cross-cutting rules (payment lifecycle, cancellation contract, tax contract, refund contract, unread contract)
