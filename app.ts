import express, { Request, Response } from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import connectDB from "./config/db";
import rateLimit from "express-rate-limit";
import cors from "cors";
// import waitlistRoutes from "./routes/waitlistRoutes";
import userRoutes from "./routes/userRoutes";
import authRoutes from "./routes/authRoutes";
import flutterwaveRoutes from "./routes/flutterwaveRoutes";
import cookieParser from "cookie-parser";
import otpRoutes from "./routes/otpRoutes";
import { v2 as cloudinary } from 'cloudinary';
import supportRoutes from "./routes/supportRoutes";
import adminRoutes from "./routes/adminRoutes";

dotenv.config();

const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [process.env.APP_BASE_URL, process.env.ADMIN_BASE_URL]
    : ["http://localhost:3000", "http://localhost:5173"];

export const app = express();
const PORT = 3000;

// So the rate limiter sees the real client IP behind the proxy
app.set("trust proxy", 1);

cloudinary.config({
  cloud_name: process.env.cloudinary_cloud_Name,
  api_key: process.env.cloudinary_api_key,
  api_secret: process.env.cloudinary_api_secret
});

(async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('Error starting the server:', error);
    process.exit(1);
  }
})();

app.use(morgan("dev"));

// Before the rate limiter, so 429 responses still get CORS headers
app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser tools like Postman
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}))

app.use(express.json());
app.use(cookieParser());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// app.use("/api/waitlist", waitlistRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/flutterwave", flutterwaveRoutes);
app.use("/api/support", supportRoutes)
app.use("/api/admin", adminRoutes);

app.get('/healthz', async (req, res) => {
  return res.sendStatus(200);
});


