import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../config/db";
import { QueryResult } from "pg";

import { parsePagination, buildPaginationMeta } from "../utils/helpers";

const trimString = (value?: string) => (typeof value === "string" ? value.trim() : undefined);

// Public: latest successful supporters (fan emails excluded)
export const getUserSupporters = asyncHandler(async (req: Request, res: Response) => {
 const rawUsername = req.params.username;
  const username = trimString(Array.isArray(rawUsername) ? rawUsername[0] : rawUsername);

  if (!username) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }

  const userResult: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    [username]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const creatorId = userResult.rows[0].id;

  const supportersResult: QueryResult = await pool.query(
    `SELECT id, fan_name, notes, amount, created_at
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'
     ORDER BY created_at DESC
     LIMIT 10`,
    [creatorId]
  );

  res.status(200).json({
    success: true,
    supporters: supportersResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
  });
});

// Private: the logged-in creator's own supports
export const getMySupports = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = (req as any).user.userId;

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  // Only allow known statuses
  const allowedStatuses = ["successful", "failed"];
  const statusFilter =
    typeof req.query.status === "string" && allowedStatuses.includes(req.query.status)
      ? req.query.status
      : undefined;

  const whereClause = statusFilter
    ? "WHERE creator_id = $1 AND status = $2"
    : "WHERE creator_id = $1 AND status IN ('successful', 'failed')";
  const queryParams = statusFilter ? [creatorId, statusFilter] : [creatorId];

  const countResult: QueryResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM supports ${whereClause}`,
    queryParams
  );
  const total = countResult.rows[0].total;

  const supportsResult: QueryResult = await pool.query(
    `SELECT id, tx_ref, fan_name, fan_email, notes, amount, status, created_at, updated_at
     FROM supports
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${statusFilter ? "$3" : "$2"} OFFSET ${statusFilter ? "$4" : "$3"}`,
    [...queryParams, limit, offset]
  );

  res.status(200).json({
    success: true,
    supports: supportsResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});
 
// Supporters ranked by total amount given (fan emails excluded)
export const getTopSupporters = asyncHandler(async (req: Request, res: Response) => {
  const rawUsername = req.params.username;
  const username = trimString(Array.isArray(rawUsername) ? rawUsername[0] : rawUsername);
 
  if (!username) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }
 
  const userResult: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    [username]
  );
 
  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }
 
  const creatorId = userResult.rows[0].id;
  const { page, limit, offset } = parsePagination(req.query);
 
  const countResult: QueryResult = await pool.query(
    `SELECT COUNT(DISTINCT fan_email)::int AS total
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'`,
    [creatorId]
  );
  const total = countResult.rows[0].total;
 
  const topResult: QueryResult = await pool.query(
    `SELECT
       MAX(fan_name) AS fan_name,
       SUM(amount)::numeric AS total_amount,
       COUNT(*)::int AS support_count,
       MAX(created_at) AS last_supported_at
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'
     GROUP BY fan_email
     ORDER BY total_amount DESC
     LIMIT $2 OFFSET $3`,
    [creatorId, limit, offset]
  );
 
  res.status(200).json({
    success: true,
    top_supporters: topResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
    pagination: buildPaginationMeta(page, limit, total),
  });
});


// Polled by the fan after checkout; the webhook sets the status
export const getSupportStatus = asyncHandler(async (req: Request, res: Response) => {
  const { txRef } = req.params;

  if (!txRef) {
    res.status(400).json({ success: false, message: "Transaction reference is required." });
    return;
  }

  const result: QueryResult = await pool.query(
    `SELECT tx_ref, status, amount, fan_name, created_at
     FROM supports WHERE tx_ref = $1`,
    [txRef]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "Transaction not found." });
    return;
  }

  res.status(200).json({ success: true, support: result.rows[0] });
});