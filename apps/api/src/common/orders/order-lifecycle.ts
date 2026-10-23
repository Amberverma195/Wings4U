import { ConflictException } from "@nestjs/common";
import type { OrderStatus } from "@prisma/client";

/** Fulfillment closes independently of the payment ledger and its summary. */
export const TERMINAL_ORDER_STATUSES = [
  "PICKED_UP", "DELIVERED", "NO_SHOW_PICKUP", "NO_SHOW_DELIVERY", "NO_PIN_DELIVERY", "CANCELLED",
] as const satisfies readonly OrderStatus[];

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(TERMINAL_ORDER_STATUSES);

/** A guarded write lost to another status/assignment change. Roll back its effects. */
export function rethrowOrderWriteConflict(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
    throw new ConflictException("Order changed while this action was processing. Refresh the order and try again.");
  }
  throw error;
}
