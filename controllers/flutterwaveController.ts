import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../config/db";
import { QueryResult } from "pg";
import {
  createFlutterwaveSubaccount,
  initiateFlutterwavePayment,
  updateFlutterwaveSubaccount,
  verifyFlutterwaveTransactionById,
} from "../services/flutterwave";
import { sendBankDetailsUpdatedEmail } from "../utils/send_email";
import {
  SUPPORT_COLUMNS,
  SupportRecord,
  checkPayment,
  markSupportPaid,
  markSupportUnpaid,
} from "../services/supportVerification";

// A verified payment overrides 'failed'/'expired'; only 'successful' is final
const WEBHOOK_CAN_MARK_PAID_FROM = ["pending", "failed", "expired"];
const WEBHOOK_CAN_MARK_FAILED_FROM = ["pending", "expired"];

export const fetchBanks = asyncHandler(async (req: Request, res: Response) => {
  try {
    const response = await fetch(
    'https://api.flutterwave.com/v3/banks/NG?include_provider_type=1',
    {
        headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
        },
    }
    );
    const json = await response.json();
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
})

export const resolveBankName = asyncHandler(async (req: Request, res: Response) => {
  const { bank_code, account_number } = req.body as {
    bank_code?: string;
    account_number?: string;
  };

  if (!bank_code || !account_number) {
    res.status(400).json({
      status: 'error',
      message: 'bank_code and account_number are required',
    });
    return;
  }

  const url = 'https://api.flutterwave.com/v3/accounts/resolve';
  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      account_number,
      account_bank: bank_code,
    }),
  };

  const flwResponse = await fetch(url, options);
  const json = await flwResponse.json();

  if (!flwResponse.ok || json.status !== 'success') {
    res.status(422).json({
      status: 'error',
      message: json.message ?? 'Could not resolve account details',
    });
    return;
  }

  res.status(200).json({
    status: 'success',
    data: {
      accountNumber: json.data.account_number,
      accountName: json.data.account_name,
    },
  });
  return;
});


// Saves confirmed bank details and creates or updates the creator's subaccount
export const confirmBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }
 
  const { bank_code, account_number, business_mobile, bank_name } = req.body as {
    bank_name?: string;
    bank_code?: string;
    account_number?: string;
    business_mobile?: string;
  };
 
  if (!bank_code || !account_number || !business_mobile || !bank_name) {
    res.status(400).json({
      success: false,
      message: "bank_code, account_number, bank_name and business_mobile are required.",
    });
    return;
  }
 
  // Re-resolve server-side — never trust a client-supplied account_name
  const resolveResponse = await fetch("https://api.flutterwave.com/v3/accounts/resolve", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ account_number, account_bank: bank_code }),
  });
  const resolveJson = await resolveResponse.json();
 
  if (!resolveResponse.ok || resolveJson.status !== "success") {
    res.status(422).json({
      success: false,
      message: resolveJson.message ?? "Could not verify account details.",
    });
    return;
  }

  const userResult: QueryResult = await pool.query(
    `SELECT id, username, email, display_name, bio, avatar_url, is_verified, subaccount_code, created_at
      FROM users WHERE id = $1`,
    [userId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const user = userResult.rows[0];
  const verifiedAccountName: string = resolveJson.data.account_name;
  const existingSubaccountCode = userResult.rows[0]?.subaccount_code;
 
  let subaccount;
  try {
     if (existingSubaccountCode) {
      subaccount = await updateFlutterwaveSubaccount(existingSubaccountCode, {
        accountBank: bank_code,
        accountNumber: account_number,
        businessName: verifiedAccountName,
        businessMobile: business_mobile,
        businessEmail: user.email
      });
    } else {
      subaccount = await createFlutterwaveSubaccount({
        accountBank: bank_code,
        accountNumber: account_number,
        businessName: verifiedAccountName,
        businessMobile: business_mobile,
        businessEmail: user.email,
      });
    }
  } catch (err) {
    console.error(err)
    res.status(502).json({
      success: false,
      message: "Failed to set up payout account with Flutterwave.",
    });
    return;
  }
 
  const result = await pool.query(
    `UPDATE users SET
      bank_name = $1,
      bank_code = $2,
      bank_account_number = $3,
      bank_account_name = $4,
      subaccount_code = $5,
      updated_at = NOW()
    WHERE id = $6
    RETURNING id, username, email, display_name, bio, avatar_url,
      bank_name, bank_code, bank_account_number, bank_account_name, subaccount_code,
      is_verified, created_at, updated_at`,
    [bank_name, bank_code, account_number, verifiedAccountName, subaccount.subaccountId, userId]
  );
 
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const updatedUser = result.rows[0];

  // An email failure shouldn't fail the request
  try {
    await sendBankDetailsUpdatedEmail(
      updatedUser.email,
      updatedUser.display_name || updatedUser.username,
      verifiedAccountName,
      bank_code
    );
  } catch (err) {
    console.error("Failed to send bank details update notification:", err);
  }
 
  res.status(200).json({ success: true, user: result.rows[0] });
});


// Creates a pending support and returns a checkout link; only the webhook marks it paid
export const initiateSupport = asyncHandler(async (req: Request, res: Response) => {
  const { creator_id, amount, fan_email, fan_name, fan_phone, notes } = req.body as {
    creator_id?: number;
    amount?: number;
    fan_email?: string;
    fan_name?: string;
    fan_phone?: string;
    notes?: string;
  };

  if (!creator_id || !amount || amount <= 0) {
    res.status(400).json({
      success: false,
      message: "creator_id and a positive amount are required.",
    });
    return;
  }

  if (!fan_email) {
    res.status(400).json({ success: false, message: "fan_email is required." });
    return;
  }

  const creatorResult = await pool.query(
    "SELECT id, username, subaccount_code FROM users WHERE id = $1",
    [creator_id]
  );

  if ((creatorResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "Creator not found." });
    return;
  }

  const creator = creatorResult.rows[0];

  if (!creator.subaccount_code) {
    res.status(422).json({
      success: false,
      message: "This creator hasn't finished setting up payouts yet.",
    });
    return;
  }

  const txRef = `support_${creator_id}_${randomUUID()}`;

  // Save as pending first so the tx_ref is always traceable
  const insertResult = await pool.query(
    `INSERT INTO supports (tx_ref, creator_id, fan_email, fan_name, notes, amount, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
     RETURNING id`,
    [txRef, creator_id, fan_email, fan_name, notes, amount]
  );

  let payment;
  try {
    payment = await initiateFlutterwavePayment({
      txRef,
      amount,
      redirectUrl: `${process.env.APP_BASE_URL}/${creator.username}`,
      customerEmail: fan_email,
      customerName: fan_name,
      customerPhone: fan_phone,
      subaccountId: creator.subaccount_code,
      narration: `Support for ${creator.username}`,
    });
  } catch (err) {
    await pool.query(`UPDATE supports SET status = 'init_failed' WHERE id = $1`, [
      insertResult.rows[0].id,
    ]);

    res.status(502).json({
      success: false,
      message: "Failed to initiate payment with Flutterwave.",
    });
    return;
  }

  res.status(200).json({
    success: true,
    payment_link: payment.paymentLink,
    tx_ref: txRef,
  });
});


// Checks the signature, re-verifies with Flutterwave, then updates the support
export const handleFlutterwaveWebhook = asyncHandler(async (req: Request, res: Response) => {
  console.log("[webhook] Incoming request received");

  const signature = req.headers["verif-hash"];

  if (!signature || signature !== process.env.FLW_WEBHOOK_SECRET_HASH) {
    console.error("[webhook] Signature mismatch — rejecting. Received:", signature);
    res.status(401).end();
    return;
  }

  console.log("[webhook] Signature verified OK");

  const event = req.body;
  const transactionId = event?.data?.id;
  const txRef = event?.data?.tx_ref;
  console.log("[webhook] Payload parsed — transactionId:", transactionId, "txRef:", txRef);

  if (!transactionId || !txRef) {
    console.error("[webhook] Malformed payload — missing transactionId or txRef. Raw body:", JSON.stringify(event));
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const supportResult = await pool.query(
    `SELECT ${SUPPORT_COLUMNS} FROM supports WHERE tx_ref = $1`,
    [txRef]
  );

  if ((supportResult.rowCount ?? 0) === 0) {
    console.error("[webhook] No matching support record found for txRef:", txRef);
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const supportRecord: SupportRecord = supportResult.rows[0];
  console.log("[webhook] Matched support record:", {
    id: supportRecord.id,
    currentStatus: supportRecord.status,
    amount: supportRecord.amount,
    creatorId: supportRecord.creator_id,
  });

  if (supportRecord.status === "successful") {
    console.log("[webhook] Already successful — skipping. Likely a duplicate/retried webhook delivery.");
    res.status(200).json({ received: true, processed: false, reason: "already processed" });
    return;
  }

  console.log("[webhook] Calling verifyFlutterwaveTransaction for transactionId:", transactionId);

  let verified;
  try {
    verified = await verifyFlutterwaveTransactionById(transactionId);
    console.log("[webhook] Verification succeeded:", {
      status: verified.status,
      amount: verified.amount,
      txRef: verified.txRef,
      flwRef: verified.flwRef,
    });
  } catch (err) {
    console.error("[webhook] verifyFlutterwaveTransaction threw an error for transactionId:", transactionId, "— error:", err);
    // Non-200 so Flutterwave retries
    res.status(502).json({ received: true, processed: false, reason: "verification failed" });
    return;
  }

  const check = checkPayment(supportRecord, verified);
  console.log("[webhook] Payment check:", check.outcome, check.outcome === "not_paid" ? check.problems : "");

  if (check.outcome === "paid") {
    const updated = await markSupportPaid(supportRecord, check.verified, WEBHOOK_CAN_MARK_PAID_FROM);

    if (!updated) {
      console.log("[webhook] Support", supportRecord.id, "was already finalized by another request — skipping.");
      res.status(200).json({ received: true, processed: false, reason: "already processed" });
      return;
    }

    console.log("[webhook] Support", supportRecord.id, "marked successful.");
    res.status(200).json({ received: true, processed: true, result: "successful" });
    return;
  }

  if (check.outcome === "pending") {
    // Still in progress at Flutterwave (e.g. a slow bank transfer)
    console.log("[webhook] Flutterwave still shows support", supportRecord.id, "as pending — leaving it.");
    res.status(200).json({ received: true, processed: false, reason: "still pending at Flutterwave" });
    return;
  }

  // A later successful retry can still override this
  console.error("[webhook] Support", supportRecord.id, "did not check out — marking failed:", check.outcome === "not_paid" ? check.problems : check.outcome);
  await markSupportUnpaid(supportRecord.id, "failed", WEBHOOK_CAN_MARK_FAILED_FROM);
  res.status(200).json({ received: true, processed: true, result: "failed" });
});
