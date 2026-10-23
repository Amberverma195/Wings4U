/** CancellationRequest.status is historical free text. DENIED is KDS's legacy
 * alias for REJECTED; unknown statuses remain unresolved (fail closed). */
export const RESOLVED_CANCELLATION_STATUSES = [
  "APPROVED", "REJECTED", "DENIED", "CANCELLED", "WITHDRAWN",
] as const;

export const REJECTED_CANCELLATION_STATUS = "REJECTED";
