export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CART_ITEM_CONFIGURATION_INVALID"
  | "CART_ITEM_UNAVAILABLE"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
  field?: string;
  detail?: Record<string, unknown>;
  /** Present on RATE_LIMITED errors; mirrors the Retry-After header. */
  retry_after_seconds?: number;
};

export type ApiEnvelope<T> = {
  data: T | null;
  meta: { request_id: string };
  errors: ApiErrorBody[] | null;
};
