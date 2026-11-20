# BuyMeSuya — Backend API

BuyMeSuya is a tipping platform for Nigerian creators. A creator connects their bank account, shares their profile link, and fans send them support in naira. Payments go through Flutterwave and are split straight to the creator's bank account through a Flutterwave subaccount.

This repository is the backend API: Node.js, Express 5, TypeScript and PostgreSQL.

> **About this public version**
> The source is shared so the code can be reviewed. It is not meant to be deployed. These parts are left out:
>
> - **The Flutterwave API calls** in [`services/flutterwave.ts`](services/flutterwave.ts), and the race-safe database writes in [`services/supportVerification.ts`](services/supportVerification.ts).
> - **The OTP and admin controllers:** [`controllers/otpController.ts`](controllers/otpController.ts) and [`controllers/adminController.ts`](controllers/adminController.ts).
> - **The database migrations.** The tables are summarised [below](#data-model).
>
> The omitted functions keep their signatures and throw a `PrivateImplementationError`. Everything else (the other controllers, routes, middleware, auth, validation, payment verification rules and tests) is the production code.

## Tech stack

| Area | Tools |
| --- | --- |
| Runtime and API | Node.js, Express 5, TypeScript |
| Database | PostgreSQL (`pg`, raw parameterised SQL), `node-pg-migrate` |
| Payments | Flutterwave: subaccounts, standard checkout, webhooks |
| Auth | JWT access and refresh tokens in httpOnly cookies, scrypt password hashing, email OTP |
| Email and media | Resend, Cloudinary |
| Testing | Vitest, Supertest |
| Local dev | Docker Compose (Postgres and pgAdmin) |

## Where to look

**The payment webhook:** `handleFlutterwaveWebhook` in [`controllers/flutterwaveController.ts`](controllers/flutterwaveController.ts)
- Rejects requests without a valid `verif-hash` signature.
- Never trusts the webhook body. It re-fetches the transaction from Flutterwave and checks status, amount, currency and `tx_ref` against our own record.
- It is idempotent and race-safe. Status changes are conditional `UPDATE`s, so a duplicate delivery or an admin acting at the same moment can't overwrite a result or send a second email.
- Returns a non-200 when verification fails, so Flutterwave retries instead of treating the event as delivered.

**One source of truth for "was this paid?":** `checkPayment` in [`services/supportVerification.ts`](services/supportVerification.ts)
- A pure function shared by the webhook, the admin override and the stale-pending cleanup, so their rules can't drift apart.

**Authentication:** [`controllers/authController.ts`](controllers/authController.ts) and [`utils/password.ts`](utils/password.ts)
- Short-lived access token, with a refresh token per device. Refresh tokens are stored salted and hashed, never raw.
- Password reset sends the same response whether or not the email exists (no account enumeration). Reset tokens are single-use and expire after 30 minutes, and a reset revokes every existing session.
- Passwords are hashed with scrypt and compared with `timingSafeEqual`.
- The OTP and forgot-password endpoints are rate-limited per email or IP, and `trust proxy` is set so the limiter sees the real client IP.

**Tests:** [`tests/`](tests/)
- Unit tests for pagination parsing (including edge cases such as arrays, decimals and `Infinity`), password hashing and the Cloudinary upload helper.
- A Supertest integration suite for the user endpoints, with the database and auth mocked.

## API overview

| Prefix | Endpoints |
| --- | --- |
| `/api/auth` | `POST /login` · `POST /logout` · `GET /refresh` · `POST /forgot-password` · `POST /reset-password` |
| `/api/otp` | `POST /send` |
| `/api/users` | `POST /` (sign up with OTP) · `GET /me` · `GET /check-username/:username` · `GET /:username` · `PUT /:id/profile` · `PUT /:id/avatar` |
| `/api/flutterwave` | `GET /banks/get` · `POST /banks/resolvename` · `PATCH /users/:id/bank/confirm` · `POST /support/initiate` · `POST /webhooks` |
| `/api/support` | `GET /me` · `GET /status/:txRef` · `GET /:username` |
| `/api/admin` | `GET /users` · `GET /users/:id` · `GET /stats` · `GET /supports` · `GET /flutterwave/transaction` · `PATCH /supports/:id/status` |

## Data model

| Table | Purpose |
| --- | --- |
| `users` | Creator accounts: profile, social links, payout bank details, Flutterwave `subaccount_code` |
| `refresh_tokens` | One salted hash per active session or device |
| `email_otps` | Hashed sign-up verification codes with an expiry |
| `password_resets` | Hashed, single-use reset tokens with an expiry |
| `supports` | One row per tip: `tx_ref`, amount, fan details, status, Flutterwave references |
| `support_status_audits` | Audit log of manual admin status changes, with the Flutterwave check stored as JSONB |

A support moves through these statuses: `pending` → `successful` · `failed` · `expired`. A payment that couldn't be started is marked `init_failed`.

## Project structure

```
app.ts            Express app: CORS, rate limiting, route mounting
config/           PostgreSQL connection pool
controllers/      Request handlers (auth, users, OTP, payments, supports, admin)
middlewares/      JWT cookie auth, admin API-key auth
routes/           Route definitions per feature
services/         Flutterwave client and shared payment-verification rules
utils/            Password hashing, pagination, email templates, uploads
tests/            Vitest unit and integration tests
```

## Running the tests

The unit tests don't need a database or API keys:

```bash
npm install
npx vitest run tests/unit
```
