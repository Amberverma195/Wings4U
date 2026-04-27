export type ApiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT" | "IDEMPOTENCY_CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR";
export type ApiErrorBody = {
    code: ApiErrorCode;
    message: string;
    field?: string;
    detail?: Record<string, unknown>;
};
export type ApiEnvelope<T> = {
    data: T | null;
    meta: {
        request_id: string;
    };
    errors: ApiErrorBody[] | null;
};
