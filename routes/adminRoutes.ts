import express, { Router } from "express";
import { adminAuth } from "../middlewares/adminAuth";
import {
  clearPendingSupports,
  getAdminStats,
  getAllSupports,
  getAllUsers,
  getFlutterwaveTransaction,
  getUserDetail,
  updateSupportStatus,
} from "../controllers/adminController";

const adminRoutes = Router();

// adminRoutes.use(auth, requireAdmin); // every route below requires both
adminRoutes.use(express.json())
adminRoutes.use(adminAuth);

adminRoutes.get("/users", getAllUsers);
adminRoutes.get("/users/:id", getUserDetail);
adminRoutes.get("/stats", getAdminStats);
adminRoutes.get("/supports", getAllSupports);
adminRoutes.get("/flutterwave/transaction", getFlutterwaveTransaction);
// adminRoutes.delete("/supports/clear-pending", clearPendingSupports);
adminRoutes.patch("/supports/:id/status", updateSupportStatus);

export default adminRoutes;