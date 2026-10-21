/** API-owned lifecycle. Clients display these results without duplicating eligibility rules. */
export type AccountDeletionBlocker = { code: string; message: string };
export type AccountDeletionStatus = {
  enabled: boolean;
  policy_version: string;
  status: "unavailable" | "ready" | "resolution_required";
  blockers: AccountDeletionBlocker[];
  available_stamps: number;
  request_id?: string | null;
};
export type AccountDeletionVerification = { authorization: string; expires_at: string; request_id: string };
export type AccountDeletionResult = {
  status: "completed" | "resolution_required";
  request_id: string;
  blockers: AccountDeletionBlocker[];
};
