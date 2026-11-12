# YTCash - Digital Wallet App

A GCash-style digital wallet app for Filipinos with AI-powered multi-currency cash scanning. Built with React Native + Expo, Supabase, Stripe, and Roboflow.

## Features

- **Digital Wallet** — Balance management in PHP with real-time updates
- **P2P Transfers** — Send/receive money via email or phone number
- **Cash Scanner** — AI-powered banknote detection (PHP, USD, EUR, AED) with auto PHP conversion
- **QR Payments** — Scan and generate QR codes for payments
- **Multi-Currency** — Live exchange rates and automatic PHP conversion
- **Secure Auth** — Email/password and phone OTP authentication via Supabase
- **Identity Verification (KYC)** — ID scan, face match and liveness through Didit, with manual review as a fallback
- **Fingerprint / Face ID Lock** — Unlocks the app and confirms sending or receiving money
- **P2P Cash Delivery** — Send cash to anyone in the Philippines through the closest cash partner, with escrow
- **Users Online Map** — Live map of signed-in users, with opt-in approximate location

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React Native + Expo SDK 54 (TypeScript) |
| Routing | expo-router (file-based) |
| Backend | Supabase (Auth, Database, Realtime) |
| Payments | Stripe SDK |
| Cash Detection | Roboflow API (currency-note-detection model) |
| Exchange Rates | ExchangeRate-API |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

Required keys:
- `EXPO_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anon/public key
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (pk_test_...)
- `EXPO_PUBLIC_ROBOFLOW_API_KEY` — Roboflow API key for cash detection
- `EXPO_PUBLIC_EXCHANGE_RATE_API_KEY` — ExchangeRate-API key

### 3. Set up Supabase database

Run the SQL in `supabase/migration.sql` in your Supabase SQL Editor to create tables, RLS policies, and functions.

### 4. Start the app

```bash
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) or press `a` for Android / `i` for iOS simulator.

## Project Structure

```
app/
  _layout.tsx          Root layout (auth provider, route protection)
  (auth)/              Auth screens (login, register)
  (tabs)/              Main tab screens (home, send, scan, history)
  profile.tsx          User profile
  qr-scanner.tsx       QR code scanner
  add-money.tsx        Add funds via Stripe
  online-map.tsx       Live map of users online
  p2p/                 P2P cash delivery (hub, new order, order detail)
  kyc/                 Identity verification, manual submission, admin review
contexts/
  auth.tsx             Authentication context & provider
  presence.tsx         Who is online + location sharing choice
services/
  supabase.ts          Database client & helpers
  currency-api.ts      Exchange rate fetching & conversion
  cash-scanner.ts      Roboflow ML integration
constants/
  theme.ts             Colors & branding
  currencies.ts        Currency definitions & formatting
supabase/
  migration.sql        Database schema & RLS policies
```

## Identity Verification (KYC)

Open it from **Account → Identity Verification**. A user becomes verified in one of two ways, and only the server can set the verified flag:

- **Didit (automatic):** government ID scan, face match against the ID, and a liveness check, run by [Didit](https://didit.me)'s SDK inside the app.
- **Manual review (fallback):** the user photographs their ID (front and back) and takes a selfie; you approve or reject it under **Review submissions**.

The app always asks the server which one to use. The server picks Didit when it is set up and working, and answers "manual" when Didit is not configured yet, has run out of checks, rate-limits, or is unreachable. So the app works today with manual review only, and starts using Didit as soon as the secrets below are set.

### Setup

1. Re-run `supabase/migration.sql` (section 11).
2. Make yourself a reviewer, in the Supabase SQL editor:
   ```sql
   insert into public.kyc_admins (user_id)
   select id from public.users where email = 'you@example.com';
   ```
3. Deploy the two Edge Functions:
   ```bash
   supabase functions deploy kyc
   supabase functions deploy kyc-webhook --no-verify-jwt
   ```
   `kyc-webhook` is called by Didit, which cannot send a Supabase login, so it checks Didit's signature on every request instead.

### Connecting Didit (test mode)

1. In the Didit console, create an application in **sandbox / test mode** and a KYC workflow with ID Verification, Face Match and Liveness.
2. Set the webhook URL to `https://<your-project>.supabase.co/functions/v1/kyc-webhook`.
3. Store the keys as Edge Function secrets. They stay on the server and are never in the app:
   ```bash
   supabase secrets set DIDIT_API_KEY=... DIDIT_WORKFLOW_ID=... DIDIT_WEBHOOK_SECRET=... DIDIT_MODE=test
   ```
   Optional in test mode: `DIDIT_SANDBOX_SCENARIO=approve` (or another scenario from Didit's sandbox catalog) forces a known result.

Test-mode results are simulated. They are stored with `is_test = true` and shown with a "TEST MODE" label, and they do mark the user verified so the whole flow can be tried.

### Going live

1. Create a live application in Didit and replace the three secrets with its values, plus `DIDIT_MODE=live`.
2. Run `select public.kyc_clear_test_verifications();` so nobody stays verified from a simulated result.

### Settings

Edit the single row in `kyc_settings`:

| Column | Meaning |
|--------|---------|
| `provider_mode` | `auto` (Didit, falling back to manual), `manual` (manual only, e.g. when the free Didit checks are used up), `didit` (no fallback) |
| `didit_sessions_per_day` | Didit sessions one user may start per 24 hours (default 3), to protect your quota |
| `required_for` | Features that need a verified identity: any of `p2p`, `send`. Empty by default, so KYC is optional until you turn it on, e.g. `update kyc_settings set required_for = '{p2p,send}';` |

To withdraw a verification later: `select public.kyc_revoke('<user id>', 'reason');` as a reviewer.

### Fingerprint / Face ID lock

Phones never give an app the fingerprint itself; the operating system checks it and answers yes or no. YTCash uses that check to:

- unlock the app when it is opened, or reopened after 30 seconds in the background
- confirm sending money (Send, P2P delivery, releasing escrow)
- confirm receiving money (Add Money, Scan Cash, a P2P partner collecting a payout)

It is on by default when the phone has a fingerprint or face set up, falls back to the phone passcode, and can be turned off under Identity Verification. Money sent to a user by someone else arrives without any action, so there is nothing to confirm for that.

### Stored documents

ID photos and selfies for manual review go to the private `kyc-documents` storage bucket. Users can add files to their own folder only and cannot read them back; only reviewers can view them, through links that expire after 5 minutes. Decide how long you keep them and delete older files from the Supabase dashboard.

Server tests: `deno test supabase/functions/_tests`.

## Wallet Security

Balances and the transaction ledger are read-only to the app. Every balance change goes through a database function that acts on the signed-in user only (section 10 of `supabase/migration.sql`):

| Action | Function | Server-side checks |
|--------|----------|--------------------|
| Send | `wallet_send` | Positive amount, sufficient balance, debit and credit in one transaction |
| Deposit | `wallet_deposit` | Per-deposit cap and 24-hour limit; can be switched off |
| Cash scan | `wallet_add_scanned_cash` | Real denominations only, exchange rate near the reference rate, 24-hour limit |
| P2P | `p2p_*` | Escrow, nearest-partner matching, release code |

Limits live in the `wallet_settings` table and reference exchange rates in `wallet_fx_reference`; edit them in the Supabase table editor.

**Deposits and cash scans are still simulated.** No card is charged and a scanned banknote is not collected, so both add balance without real money behind it, up to the limits above. Before handling real money, set `wallet_settings.demo_deposits_enabled` to `false` and credit deposits from a verified payment (for example a Stripe webhook using the service role).

Apply the migration together with this app version: older builds that wrote balances directly stop working once section 10 is in place.

## P2P Cash Delivery

Open it from the **P2P Cash Delivery** card on the Wallet screen. It works like an escrowed P2P trade:

1. **Sender** enters an amount (₱100 to ₱50,000) and the receiver's name, mobile number and address. The address is looked up to get its location.
2. The amount leaves the sender's wallet into **escrow**, and the server assigns the **available cash partner closest to the receiver** (within 30 km). If nobody is in range, nothing is charged.
3. The **partner** accepts, or declines so the order passes to the next closest partner. If no one is left, the sender is refunded.
4. The sender gets a **6-digit release code** and passes it to the receiver. The receiver gives it to the partner after counting the cash; entering it pays the partner from escrow. The sender can also release the payment directly.
5. The sender can cancel for a full refund until a partner accepts, or after 24 hours if an accepted order was never delivered.

Any user can become a partner with **Deliver cash near me** on the Deliver tab. Their area (rounded to about 1 km) is stored so they can be matched while offline; other users never see it.

- **Setup:** re-run `supabase/migration.sql` (section 9). All balance changes for P2P happen inside database functions; the app cannot write to the P2P tables directly.
- **Address lookup:** OpenStreetMap Nominatim by default, limited to light use. For production set `EXPO_PUBLIC_GEOCODER_URL` to a hosted Nominatim-compatible service.
- **Not included yet:** partner fees, ratings, in-app chat and dispute handling.

## Users Online Map

Open it from the **Users Online** card on the Wallet screen.

- **Who appears:** everyone signed in with the app open. Presence uses a private Supabase Realtime channel (`online-users`), so nothing is stored in the database and users drop off when they close the app or sign out.
- **Location is opt-in:** a user gets a pin only after turning on "Show me on the map". Others are still counted as online, without a pin.
- **What is shared:** first name and a location rounded to about 1 km. Email, phone and balance are never sent.
- **Setup:** re-run `supabase/migration.sql` (section 8 adds the channel's access policies). The feature adds `expo-location` and `react-native-webview`, so rebuild dev builds with `npx expo run:android` / `npx expo run:ios`.
- **Map tiles:** OpenStreetMap by default, no API key. For production traffic set `EXPO_PUBLIC_MAP_TILE_URL` to a hosted tile provider.

## Supported Currencies

| Currency | Detection | Conversion |
|----------|-----------|------------|
| PHP (Philippine Peso) | Yes | Base currency |
| USD (US Dollar) | Yes | Auto-convert to PHP |
| EUR (Euro) | Yes | Auto-convert to PHP |
| AED (UAE Dirham) | Yes | Auto-convert to PHP |
