import { PrivateImplementationError } from "../utils/privateImplementation";

// Public version: the Flutterwave API calls are not included

export const SUPPORT_CURRENCY = "NGN";

// -------------------- Subaccount creation --------------------

export interface CreateSubaccountParams {
  accountBank: string; // bank code, e.g. "044"
  accountNumber: string;
  businessName: string; // the resolved account name, not user input
  businessMobile: string;
  businessEmail: string;
  country?: string; // defaults to "NG"
  splitType?: "percentage" | "flat";
  splitValue?: number;
}

export interface FlutterwaveSubaccountResult {
  subaccountId: string; // stored as subaccount_code
  accountNumber: string;
  bankCode: string;
  raw: any;
}

// Creates a subaccount so payments split straight to the creator's bank
export async function createFlutterwaveSubaccount(
  params: CreateSubaccountParams
): Promise<FlutterwaveSubaccountResult> {
  throw new PrivateImplementationError("createFlutterwaveSubaccount");
}

export async function updateFlutterwaveSubaccount(
  subaccountId: string,
  params: Omit<CreateSubaccountParams, "splitType" | "splitValue">
): Promise<FlutterwaveSubaccountResult> {
  throw new PrivateImplementationError("updateFlutterwaveSubaccount");
}

// -------------------- Payment initiation --------------------

export interface InitiatePaymentParams {
  txRef: string;
  amount: number;
  currency?: string; // defaults to "NGN"
  redirectUrl: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  subaccountId: string; // creator's subaccount_code
  narration?: string;
}

export interface FlutterwaveInitiateResult {
  paymentLink: string;
  raw: any;
}

// Starts a checkout split to the creator's subaccount
export async function initiateFlutterwavePayment(
  params: InitiatePaymentParams
): Promise<FlutterwaveInitiateResult> {
  throw new PrivateImplementationError("initiateFlutterwavePayment");
}

// -------------------- Transaction verification --------------------

export interface VerifyTransactionResult {
  transactionId: number; // Flutterwave's own id for this transaction
  status: "successful" | "failed" | "pending" | string;
  amount: number;
  currency: string;
  txRef: string;
  flwRef: string;
  raw: any;
}

export async function verifyFlutterwaveTransactionById(
  transactionId: string | number
): Promise<VerifyTransactionResult> {
  throw new PrivateImplementationError("verifyFlutterwaveTransactionById");
}

// Returns null only if Flutterwave has no such transaction; any other failure throws
export async function verifyFlutterwaveTransactionByReference(
  txRef: string
): Promise<VerifyTransactionResult | null> {
  throw new PrivateImplementationError("verifyFlutterwaveTransactionByReference");
}
