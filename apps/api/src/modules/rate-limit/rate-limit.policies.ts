export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Every policy can be overridden without a code change through
 * `RATE_LIMIT_<NAME>` where NAME is the policy name upper-cased with dots
 * replaced by underscores, e.g. `RATE_LIMIT_AUTH_LOGIN_IP=80/300` (80 hits per
 * 300 seconds) or `RATE_LIMIT_AUTH_LOGIN_IP=80` (limit only).
 */
function policy(name: string, limit: number, windowMs: number): RateLimitPolicy {
  const raw = process.env[`RATE_LIMIT_${name.toUpperCase().replace(/[.-]/g, "_")}`]?.trim();
  const match = raw ? /^(\d+)(?:\/(\d+))?$/.exec(raw) : null;
  const overrideLimit = match ? Number(match[1]) : NaN;
  const overrideWindowMs = match?.[2] ? Number(match[2]) * 1000 : NaN;
  return Object.freeze({
    name,
    limit: overrideLimit > 0 ? overrideLimit : limit,
    windowMs: overrideWindowMs > 0 ? overrideWindowMs : windowMs,
  });
}

export const RATE_LIMITS = {
  // POST /auth/login
  loginIp: policy("auth.login.ip", 50, 5 * MINUTE),
  loginIdentity: policy("auth.login.identity", 20, 15 * MINUTE),
  loginIdentityFailures: policy("auth.login.identity_failures", 5, 15 * MINUTE),

  // POST /auth/password-reset/{request,confirm}
  passwordResetRequestIp: policy("auth.password_reset.request.ip", 20, 15 * MINUTE),
  passwordResetRequestIdentity: policy("auth.password_reset.request.identity", 3, 15 * MINUTE),
  passwordResetConfirmIp: policy("auth.password_reset.confirm.ip", 30, 15 * MINUTE),
  passwordResetConfirmIdentity: policy("auth.password_reset.confirm.identity", 10, 15 * MINUTE),

  // POST /auth/refresh
  refreshIp: policy("auth.refresh.ip", 300, 5 * MINUTE),
  refreshToken: policy("auth.refresh.token", 20, 5 * MINUTE),
  refreshInvalidIp: policy("auth.refresh.invalid_ip", 60, 15 * MINUTE),

  // POST /auth/signup
  signupDevice: policy("auth.signup.device", 3, 7 * DAY),
  signupIpHourly: policy("auth.signup.ip_hourly", 10, HOUR),
  signupIpDaily: policy("auth.signup.ip_daily", 30, DAY),
  signupEmail: policy("auth.signup.email", 5, DAY),

  // POST /cart/quote. The website refreshes a quote about 300ms after each
  // edit and the apps autosave about every 400ms, so a 30/minute cap would
  // interrupt ordinary flavour and add-on changes. 120/minute allows two
  // quotes per second for a full minute.
  cartQuoteIdentity: policy("cart.quote.identity", 120, MINUTE),
  cartQuoteIp: policy("cart.quote.ip", 600, MINUTE),

  // GET|PUT|DELETE /cart/me, POST /cart/merge
  savedCartReadIdentity: policy("saved_cart.read.identity", 120, MINUTE),
  savedCartReadIp: policy("saved_cart.read.ip", 600, MINUTE),
  savedCartWriteIdentity: policy("saved_cart.write.identity", 120, MINUTE),
  savedCartWriteIp: policy("saved_cart.write.ip", 600, MINUTE),
  savedCartMergeIdentity: policy("saved_cart.merge.identity", 10, 15 * MINUTE),
  savedCartMergeIp: policy("saved_cart.merge.ip", 60, 15 * MINUTE),

  // POST /support/tickets, POST /support/tickets/:id/messages
  supportGeneralTicketCustomer: policy("support.ticket.general.customer", 3, DAY),
  supportOrderTicketCustomer: policy("support.ticket.order.customer", 5, HOUR),
  supportMessageCustomerTicket: policy("support.message.customer.ticket", 5, MINUTE),
  supportMessageCustomerHourly: policy("support.message.customer.hourly", 60, HOUR),
  supportMessageStaffTicket: policy("support.message.staff.ticket", 30, MINUTE),
  supportMessageStaffHourly: policy("support.message.staff.hourly", 600, HOUR),

  // POST /checkout. The order-count policies are enforced against committed
  // orders in PostgreSQL, not Redis, so retries and races cannot bypass them.
  checkoutAttemptCustomer: policy("checkout.attempt.customer", 10, 5 * MINUTE),
  checkoutOrdersCustomer: policy("checkout.orders.customer", 3, 30 * MINUTE),
  checkoutOrdersCustomerDaily: policy("checkout.orders.customer_daily", 20, DAY),

  // POST /orders/:orderId/order-items/:orderItemId/reviews
  reviewCustomer: policy("review.customer", 10, 5 * MINUTE),
  reviewCustomerHourly: policy("review.customer_hourly", 30, HOUR),

  // GET /menu, GET /menu/wing-flavours
  menuIp: policy("menu.ip", 120, MINUTE),
  menuTrustedServer: policy("menu.trusted_server", 1200, MINUTE),

  // Socket.IO /ws
  realtimeHandshakeIp: policy("realtime.handshake.ip", 20, MINUTE),
  realtimeHandshakeStoreIp: policy("realtime.handshake.store_ip", 300, MINUTE),
  realtimeAuthFailureIp: policy("realtime.auth_failure.ip", 20, 5 * MINUTE),
  realtimeAuthFailureStoreIp: policy("realtime.auth_failure.store_ip", 120, 5 * MINUTE),
  realtimeSubscribeCustomer: policy("realtime.subscribe.customer", 30, MINUTE),
  realtimeSubscribeStaff: policy("realtime.subscribe.staff", 120, MINUTE),
  /** `limit` is the concurrent socket cap; `windowMs` is the slot lease TTL. */
  realtimeCustomerConnections: policy("realtime.customer.connections", 5, 3 * MINUTE),
} as const;
