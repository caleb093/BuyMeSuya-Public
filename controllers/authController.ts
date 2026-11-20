import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { pool } from "../config/db";
import {hashPassword, verifyPassword} from "../utils/password";
import { sendPasswordResetEmail } from "../utils/send_email";

export const hashToken = (token: string, salt: string) => scryptSync(token, salt, 64).toString("hex");

export const login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
        res.status(400).json({ success: false, message: "Email and password required" });
        return;
    }

    const result = await pool.query("SELECT id, password_hash, username, email FROM users WHERE email = $1", [email]);
    if ((result.rowCount ?? 0) === 0) {
        res.status(401).json({ success: false });
        return;
    }

    const user = result.rows[0];
    
    if (!verifyPassword(password, user.password_hash)) {
        res.status(401).json({ message: "passwords don't match", success: false });
        return;
    }

    const accessToken = jwt.sign({ userId: user.id }, process.env.ACCESS_SECRET as string, { expiresIn: "15m" });

    // rid lets each device hold its own refresh token
    const refreshToken = jwt.sign({ userId: user.id, rid: randomBytes(8).toString("hex") }, process.env.REFRESH_SECRET as string, { expiresIn: "30d" });

    const salt = randomBytes(16).toString("hex");
    const tokenHash = hashToken(refreshToken, salt);

    await pool.query(
        "INSERT INTO refresh_tokens (user_id, token_hash, salt) VALUES ($1, $2, $3)",
        [user.id, tokenHash, salt]
    );

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 2 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true });
    
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = (req as any).cookies?.refreshToken as string | undefined;

    if (refreshToken) {
        // Revoke this session's refresh token
        try {
            const payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as { userId: number };

            const sessions = await pool.query(
                "SELECT id, token_hash, salt FROM refresh_tokens WHERE user_id = $1",
                [payload.userId]
            );

            for (const row of sessions.rows) {
                const candidate = hashToken(refreshToken, row.salt);
                if (candidate === row.token_hash) {
                    await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [row.id]);
                    break;
                }
            }
        } catch (err) {
            // Invalid or expired: nothing to revoke
        }
    }

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.json({ success: true });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = (req as any).cookies?.refreshToken as string | undefined;

    if (!refreshToken) {
        res.sendStatus(401);
        return;
    }

    let payload: any;
    try {
        payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as any;
    } catch (err) {
        res.sendStatus(401);
        return;
    }

    const sessions = await pool.query("SELECT id, token_hash, salt FROM refresh_tokens WHERE user_id = $1", [payload.userId]);

    let valid = false;

    for (const row of sessions.rows) {
        const candidate = hashToken(refreshToken, row.salt);
        if (candidate === row.token_hash) {
            valid = true;
            break;
        }
    }

    if (!valid) {
        res.sendStatus(401);
        return;
    }

    const newAccessToken = jwt.sign({ userId: payload.userId }, process.env.ACCESS_SECRET as string, { expiresIn: "15m" });

    res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
    });

    res.sendStatus(200);
});

export const requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ success: false, message: "Email is required." });
    return;
  }

  const userResult = await pool.query("SELECT id, username, email FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);

  // Same response whether or not the email exists (prevents enumeration)
  if ((userResult.rowCount ?? 0) === 0) {
    res.json({
      success: true,
      message: "If an account exists with that email, a reset link has been sent.",
    });
    return;
  }

  const user = userResult.rows[0];

  const rawToken = randomBytes(32).toString("hex"); // sent to the user, never stored raw
  const salt = randomBytes(16).toString("hex");
  const tokenHash = hashToken(rawToken, salt);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  // Invalidate any older reset requests
  await pool.query("DELETE FROM password_resets WHERE user_id = $1", [user.id]);

  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, salt, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, tokenHash, salt, expiresAt]
  );

  const resetLink = `${process.env.APP_BASE_URL}/reset-password?token=${rawToken}&uid=${user.id}`;

  try {
    await sendPasswordResetEmail(user.email, user.username, resetLink);
  } catch (err) {
    console.error("Failed to send password reset email:", err);
  }

  res.json({
    success: true,
    message: "If an account exists with that email, a reset link has been sent.",
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { uid, token, newPassword } = req.body as {
    uid?: string;
    token?: string;
    newPassword?: string;
  };

  if (!uid || !token || !newPassword) {
    res.status(400).json({ success: false, message: "Missing required fields." });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    return;
  }

  const userId = Number(uid);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "Invalid reset link." });
    return;
  }

  const resetResult = await pool.query(
    `SELECT id, token_hash, salt, expires_at, used
     FROM password_resets WHERE user_id = $1`,
    [userId]
  );

  if ((resetResult.rowCount ?? 0) === 0) {
    res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    return;
  }

  const resetRow = resetResult.rows[0];

  if (resetRow.used) {
    res.status(400).json({ success: false, message: "This reset link has already been used." });
    return;
  }

  if (new Date(resetRow.expires_at) < new Date()) {
    res.status(400).json({ success: false, message: "This reset link has expired." });
    return;
  }

  const candidateHash = hashToken(token, resetRow.salt);
  if (candidateHash !== resetRow.token_hash) {
    res.status(400).json({ success: false, message: "Invalid or expired reset link." });
    return;
  }

  const newPasswordHash = hashPassword(newPassword);

  await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
    newPasswordHash,
    userId,
  ]);

  // Single-use token
  await pool.query("UPDATE password_resets SET used = true WHERE id = $1", [resetRow.id]);

  // Revoke all sessions
  await pool.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);

  res.json({ success: true, message: "Password reset successfully. Please log in again." });
});