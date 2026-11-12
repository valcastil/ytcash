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
- **Send from Abroad** — Pay in AED, USD or EUR at a rate and fee held for 10 minutes
- **Withdrawals** — Cash out wallet balance to GCash, Maya or a bank, paid out by a reviewer
- **Direct Pay** — Find the nearest partner on a map and pay them yourself by GCash, GoTyme, Maya or e& money after an OTP hand-over
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
  withdraw/            Withdrawal request and payout review
  direct/              Direct Pay (hub, partner map, order with chat)
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

## Direct Pay (GCash, GoTyme, Maya, e& money)

A separate way to send cash where **no money passes through YTCash**. Open it from the **Direct Pay** card on the Wallet screen.

1. The sender chooses where the cash is delivered, **Philippines** (pesos; GCash, GoTyme, Maya) or **UAE** (dirhams; e& money), then enters the amount and their friend's address. The app shows the friend and up to 5 available partners within 30 km on a map, nearest first.
2. The sender picks a partner and one of the payment apps that partner accepts, and sends a request. Both can chat in the app.
3. The partner accepts and brings their own cash to the friend. The sender passes a 6-digit OTP to the friend, who gives it to the partner after counting the cash.
4. Entering the OTP reveals the partner's account number to the sender, who pays from their own GCash, GoTyme, Maya or e& money app and enters the reference number.
5. The partner checks their app and confirms. If no payment arrives, they can report it after 30 minutes.

The cash and the payment are always in the same currency (PHP 100 to 50,000, or AED 10 to 3,500 per delivery), so Direct Pay never converts money. Only partners who accept an app in that currency are shown.

There is **no integration with GCash, GoTyme, Maya or e& money**: YTCash cannot see or verify the transfer. Both sides confirm by hand.

**The partner carries the risk.** They hand over cash before being paid. What the app does about it: the account to pay is fixed when the partner accepts; a sender with a delivery awaiting payment cannot start another; a reported sender is blocked until they pay and the partner confirms; a reviewer can settle a report with `select public.direct_resolve_dispute('<order id>', 'completed' | 'unpaid', 'note');`. Requiring KYC for P2P (`kyc_settings.required_for`) also applies here.

**Becoming a Direct Pay partner:** turn on "Deliver cash near me" in P2P Cash Delivery, then add a GCash, GoTyme, Maya or e& money account under Direct Pay → Deliver cash. Listed partners' first name and area (rounded to about 1 km) are visible to senders searching nearby; account numbers are not, until a delivery is confirmed.

**Map:** set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps JavaScript API) to use Google Maps. Without a key, or if Google rejects it, the same map is drawn with OpenStreetMap. Partners get an "Open in Google Maps" button for directions either way.

## Sending from Abroad (quotes)

On **P2P Cash Delivery → New cash delivery**, choose what to pay in: AED, USD, EUR, or the PHP wallet. For a foreign currency, type either what you pay or what the receiver should get; the other side, the exchange rate and the fee are worked out on the server and held for 10 minutes.

- **Rate:** the market rate less a margin (default 1%).
- **Fee:** 1.5% of the amount converted, minimum ₱50, included in "You pay".
- **Change pricing:** edit the single row in `fx_settings` (`margin`, `fee_pct`, `min_fee_php`, `quote_ttl_seconds`).
- **Market rates:** deploy `supabase functions deploy fx-rates`. The app calls it before quoting and it refreshes the stored rates at most every 10 minutes. Without it, quotes use the rates stored in `wallet_fx_reference` and stop after 7 days without an update.

**The foreign-currency payment is simulated.** No card is charged: confirming a quote credits the converted pesos and puts them straight into escrow, under the same switch (`wallet_settings.demo_deposits_enabled`) and daily limit as Add Money. `p2p_create_order_from_quote` is the function that must wait for a real payment confirmation once a payment provider is connected. Refunds of a cancelled order go to the sender's PHP wallet.

## Withdrawals

**Account → Withdraw to Bank or GCash** (also linked from the P2P Deliver tab). The user enters an amount (₱100 to ₱50,000) and a GCash, Maya or bank account. The amount leaves the wallet immediately and is held.

Reviewers (the people in `kyc_admins`) see **Pay out withdrawals** on the same screen. Send the money yourself, then tap **Mark paid** and enter the transfer reference, which the user sees as proof. **Reject** needs a reason and returns the money to the wallet. A user can cancel while the request is still waiting.

- Withdrawals require a verified identity by default (`wallet_settings.withdrawals_require_kyc`).
- Limits and fee: `withdraw_min`, `withdraw_max`, `withdraw_daily_limit`, `withdraw_fee` (flat, default 0) in `wallet_settings`; `withdrawals_enabled` switches the feature off.
- **Do not pay out real money while deposits are simulated.** Wallet balances can still be created by Add Money, Scan Cash and quote payments without any real funds, so a payout would be real money for an invented balance.

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
