# YTCash - Digital Wallet App

A GCash-style digital wallet app for Filipinos with AI-powered multi-currency cash scanning. Built with React Native + Expo, Supabase, Stripe, and Roboflow.

## Features

- **Digital Wallet** — Balance management in PHP with real-time updates
- **P2P Transfers** — Send/receive money via email or phone number
- **Cash Scanner** — AI-powered banknote detection (PHP, USD, EUR, AED) with auto PHP conversion
- **QR Payments** — Scan and generate QR codes for payments
- **Multi-Currency** — Live exchange rates and automatic PHP conversion
- **Secure Auth** — Email/password and phone OTP authentication via Supabase
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
