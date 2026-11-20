import { SUPPORT_CURRENCY, VerifyTransactionResult } from "./flutterwave";
import { PrivateImplementationError } from "../utils/privateImplementation";

// Payment checks shared by the webhook and admin endpoints (database writes not included)

export const SUPPORT_COLUMNS = "id, tx_ref, status, amount, creator_id, fan_name, notes, created_at";

export interface SupportRecord {
  id: number;
  tx_ref: string;
  status: string;
  amount: string; // NUMERIC comes back from pg as a string
  creator_id: number | null;
  fan_name: string | null;
  notes: string | null;
  created_at: Date;
}

export type PaymentCheck =
  | { outcome: "paid"; verified: VerifyTransactionResult }
  | { outcome: "pending"; verified: VerifyTransactionResult }
  | { outcome: "not_paid"; verified: VerifyTransactionResult; problems: string[] }
  | { outcome: "not_found" };

// Paid only if status is 'successful' and tx_ref, currency and amount all match
export function checkPayment(
  support: SupportRecord,
  verified: VerifyTransactionResult | null
): PaymentCheck {
  if (!verified) return { outcome: "not_found" };

  const problems: string[] = [];
  if (verified.txRef !== support.tx_ref) {
    problems.push(`tx_ref doesn't match (Flutterwave has '${verified.txRef}')`);
  }
  if (verified.currency !== SUPPORT_CURRENCY) {
    problems.push(`currency doesn't match (expected ${SUPPORT_CURRENCY}, Flutterwave has ${verified.currency})`);
  }
  if (Number(verified.amount) !== Number(support.amount)) {
    problems.push(`amount doesn't match (expected ${support.amount}, Flutterwave has ${verified.amount})`);
  }

  if (problems.length === 0 && verified.status === "successful") return { outcome: "paid", verified };
  if (problems.length === 0 && verified.status === "pending") return { outcome: "pending", verified };

  if (verified.status !== "successful") {
    problems.unshift(`Flutterwave status is '${verified.status}'`);
  }
  return { outcome: "not_paid", verified, problems };
}

export function describePaymentCheck(check: PaymentCheck): string {
  switch (check.outcome) {
    case "paid":
      return `Flutterwave shows a successful payment of ₦${Number(check.verified.amount).toLocaleString()} (ref ${check.verified.flwRef}).`;
    case "pending":
      return "Flutterwave still shows this payment as in progress.";
    case "not_found":
      return "Flutterwave has no transaction for this support (the fan most likely never completed checkout).";
    case "not_paid":
      return `Flutterwave doesn't show a valid payment: ${check.problems.join("; ")}.`;
  }
}

export interface StatusAuditEntry {
  fromStatus: string;
  reason: string;
  flutterwaveCheck: unknown; // stored as JSON
}

// Only updates if the status is still in fromStatuses; returns null if it already moved on
export async function markSupportPaid(
  support: SupportRecord,
  verified: VerifyTransactionResult,
  fromStatuses: string[],
  audit?: StatusAuditEntry
): Promise<Record<string, unknown> | null> {
  throw new PrivateImplementationError("markSupportPaid");
}

export async function markSupportUnpaid(
  supportId: number,
  status: "failed" | "expired",
  fromStatuses: string[],
  audit?: StatusAuditEntry
): Promise<Record<string, unknown> | null> {
  throw new PrivateImplementationError("markSupportUnpaid");
}
