import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { PrivateImplementationError } from "../utils/privateImplementation";

// Public version: admin handlers are not included

// GET /api/admin/users?page=&search=
export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("getAllUsers");
});

// GET /api/admin/users/:id
export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("getUserDetail");
});

// GET /api/admin/stats
export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("getAdminStats");
});

// GET /api/admin/supports?page=&limit=&status=&creator_id=&search=
export const getAllSupports = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("getAllSupports");
});

// GET /api/admin/flutterwave/transaction?support_id= | tx_ref= | transaction_id= (read-only)
export const getFlutterwaveTransaction = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("getFlutterwaveTransaction");
});

// DELETE /api/admin/supports/clear-pending — checks each with Flutterwave before expiring it
export const clearPendingSupports = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("clearPendingSupports");
});

// PATCH /api/admin/supports/:id/status — manual fix for a stuck support, verified with Flutterwave and audited
export const updateSupportStatus = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("updateSupportStatus");
});
