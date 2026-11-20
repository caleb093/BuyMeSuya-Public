import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { PrivateImplementationError } from "../utils/privateImplementation";

// Public version: OTP generation and verification are not included

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  throw new PrivateImplementationError("sendOtp");
});

// True if the code matches and hasn't expired; each code works once
export const verifyOtp = async (email: string, code: string): Promise<boolean> => {
  throw new PrivateImplementationError("verifyOtp");
};

export default sendOtp;
