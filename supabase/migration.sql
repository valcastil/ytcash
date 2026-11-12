-- ============================================================
-- YTCash Supabase Database Schema
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/agsxwjunxrtubpjnfkri/sql/new
-- ============================================================

-- 1. Users table (extends Supabase auth.users)
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  phone text unique,
  email text unique,
  full_name text,
  avatar_url text,
  balance numeric(12,2) not null default 0.00,
  kyc_verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.users enable row level security;

-- Drop existing policies if any to allow safe re-runs
drop policy if exists "Users can view own profile" on public.users;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can insert own profile" on public.users;

-- Users can read their own profile
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- Allow insert from authenticated user matching id
create policy "Users can insert own profile"
  on public.users for insert
  with check (auth.uid() = id);

-- 2. Transactions table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  from_user uuid references public.users(id),
  to_user uuid references public.users(id),
  amount numeric(12,2) not null,
  currency text not null default 'PHP',
  converted_amount numeric(12,2) not null,
  converted_currency text not null default 'PHP',
  type text not null check (type in ('send', 'receive', 'scan', 'add', 'withdraw')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  note text,
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

drop policy if exists "Users can view own transactions" on public.transactions;
drop policy if exists "Users can create transactions" on public.transactions;

-- Users can see transactions they're involved in
create policy "Users can view own transactions"
  on public.transactions for select
  using (auth.uid() = from_user or auth.uid() = to_user);

-- Users can create transactions
create policy "Users can create transactions"
  on public.transactions for insert
  with check (auth.uid() = from_user or auth.uid() = to_user);

-- 3. Scanned cash table (for anti-dupe serial tracking)
create table if not exists public.scanned_cash (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  currency text not null,
  denomination numeric(10,2) not null,
  serial_number text,
  php_equivalent numeric(12,2) not null,
  exchange_rate numeric(10,6) not null default 1.0,
  created_at timestamptz not null default now()
);

alter table public.scanned_cash enable row level security;

drop policy if exists "Users can view own scanned cash" on public.scanned_cash;
drop policy if exists "Users can insert scanned cash" on public.scanned_cash;

create policy "Users can view own scanned cash"
  on public.scanned_cash for select
  using (auth.uid() = user_id);

create policy "Users can insert scanned cash"
  on public.scanned_cash for insert
  with check (auth.uid() = user_id);

-- Index for duplicate serial number lookups
create index if not exists idx_scanned_cash_serial
  on public.scanned_cash(serial_number)
  where serial_number is not null;

-- 4. RPC: Atomic balance update (internal/admin only; revoked from app roles in 10a)
create or replace function public.update_balance(user_id uuid, delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set balance = balance + delta
  where id = user_id;

  if not found then
    raise exception 'User not found: %', user_id;
  end if;

  -- Prevent negative balance
  if (select balance from public.users where id = user_id) < 0 then
    raise exception 'Insufficient balance';
  end if;
end;
$$;

-- 5. Trigger: auto-create user profile on signup (supports Google OAuth metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, phone, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(new.phone, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', null)
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), users.full_name),
    avatar_url = coalesce(excluded.avatar_url, users.avatar_url);
  return new;
end;
$$;

-- Drop trigger if exists, then create
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. Backfill existing users (for users who already signed up with Google before table creation)
insert into public.users (id, email, full_name, avatar_url)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', ''),
  coalesce(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture', null)
from auth.users
on conflict (id) do nothing;

-- 7. Enable realtime for live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table public.users;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end $$;

-- 8. Users Online map: private Realtime Presence channel
-- Presence is ephemeral (no table). These policies make the 'online-users'
-- channel private, so only signed-in users can see or announce who is online;
-- the public anon key on its own cannot join.
drop policy if exists "Signed-in users can see who is online" on realtime.messages;
drop policy if exists "Signed-in users can announce they are online" on realtime.messages;

create policy "Signed-in users can see who is online"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() = 'online-users'
    and realtime.messages.extension = 'presence'
  );

create policy "Signed-in users can announce they are online"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() = 'online-users'
    and realtime.messages.extension = 'presence'
  );

-- ============================================================
-- 9. P2P cash delivery
-- A sender locks PHP from their wallet in escrow. The app picks the
-- available cash partner closest to the receiver's address. The partner
-- hands the receiver cash and is paid from escrow once the hand-over is
-- confirmed (release code from the receiver, or the sender releasing it).
-- All money movement happens inside the functions below; the tables
-- cannot be written to directly from the app.
-- ============================================================

-- 9a. Cash partners: users who opted in to hand over cash near them
create table if not exists public.p2p_partners (
  user_id uuid references public.users(id) on delete cascade primary key,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  is_available boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.p2p_partners enable row level security;

drop policy if exists "Partners manage own partner profile" on public.p2p_partners;

-- A partner's location is only readable by that partner; matching runs server-side.
create policy "Partners manage own partner profile"
  on public.p2p_partners for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 9b. Orders
create table if not exists public.p2p_orders (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references public.users(id) not null,
  partner_id uuid references public.users(id),
  sender_name text not null default '',
  partner_name text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PHP',
  receiver_name text not null,
  receiver_phone text not null,
  receiver_address text not null,
  receiver_lat double precision not null,
  receiver_lng double precision not null,
  distance_km numeric(8,2),
  status text not null default 'matched'
    check (status in ('matched', 'accepted', 'completed', 'cancelled')),
  cancel_reason text,
  declined_by uuid[] not null default '{}',
  failed_code_attempts integer not null default 0,
  transaction_id uuid references public.transactions(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);

-- 'escrow': money is held in the YTCash wallet. 'direct': the sender pays the partner
-- themselves after delivery (section 13); no wallet money is involved.
alter table public.p2p_orders add column if not exists mode text not null default 'escrow'
  check (mode in ('escrow', 'direct'));

create index if not exists idx_p2p_orders_sender on public.p2p_orders(sender_id, created_at desc);
create index if not exists idx_p2p_orders_partner on public.p2p_orders(partner_id, created_at desc);

alter table public.p2p_orders enable row level security;

drop policy if exists "Sender and partner can view order" on public.p2p_orders;

-- Read-only for the two people involved. No insert/update/delete policies:
-- orders only change through the functions in 9d.
create policy "Sender and partner can view order"
  on public.p2p_orders for select
  using (auth.uid() = sender_id or auth.uid() = partner_id);

-- 9c. Release codes live in their own table so the partner can never read them
create table if not exists public.p2p_order_codes (
  order_id uuid references public.p2p_orders(id) on delete cascade primary key,
  code text not null
);

alter table public.p2p_order_codes enable row level security;

drop policy if exists "Sender can view release code" on public.p2p_order_codes;

create policy "Sender can view release code"
  on public.p2p_order_codes for select
  using (
    exists (
      select 1 from public.p2p_orders o
      where o.id = order_id and o.sender_id = auth.uid()
    )
  );

-- 9d. Functions

-- Great-circle distance in km
create or replace function public.p2p_distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371 * 2 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Internal: nearest available partner to a point, within 30 km
create or replace function public.p2p_find_partner(
  p_lat double precision, p_lng double precision, p_exclude uuid[]
)
returns table (partner_id uuid, partner_name text, distance_km double precision)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    coalesce(nullif(split_part(trim(u.full_name), ' ', 1), ''), 'YTCash partner'),
    public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) as km
  from public.p2p_partners p
  join public.users u on u.id = p.user_id
  where p.is_available
    and p.user_id <> all (p_exclude)
    and public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) <= 30
  order by km asc, p.updated_at desc
  limit 1;
$$;

-- Internal: return escrow to the sender and close the order
create or replace function public.p2p_refund(p_order public.p2p_orders, p_reason text)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  update public.users set balance = balance + p_order.amount where id = p_order.sender_id;
  update public.transactions set status = 'failed' where id = p_order.transaction_id;
  delete from public.p2p_order_codes where order_id = p_order.id;
  update public.p2p_orders
    set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
    where id = p_order.id
    returning * into v_order;
  return v_order;
end;
$$;

-- Internal: pay the partner from escrow and close the order
create or replace function public.p2p_pay_partner(p_order public.p2p_orders)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  update public.users set balance = balance + p_order.amount where id = p_order.partner_id;
  update public.transactions
    set status = 'completed', to_user = p_order.partner_id
    where id = p_order.transaction_id;
  delete from public.p2p_order_codes where order_id = p_order.id;
  update public.p2p_orders
    set status = 'completed', completed_at = now()
    where id = p_order.id
    returning * into v_order;
  return v_order;
end;
$$;

-- Sender: create an order. Locks the amount in escrow and assigns the nearest partner.
create or replace function public.p2p_create_order(
  p_amount numeric,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_lat double precision,
  p_lng double precision
)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_sender_name text;
  v_partner record;
  v_tx_id uuid;
  v_order public.p2p_orders;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  perform public.kyc_require('p2p');
  if v_amount is null or v_amount < 100 or v_amount > 50000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if length(trim(coalesce(p_receiver_name, ''))) < 2
     or length(trim(coalesce(p_receiver_phone, ''))) < 7
     or length(trim(coalesce(p_receiver_address, ''))) < 5
     or p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_RECEIVER';
  end if;

  select * into v_partner from public.p2p_find_partner(p_lat, p_lng, array[v_uid]);
  if v_partner.partner_id is null then
    raise exception 'NO_PARTNER_NEARBY';
  end if;

  -- Take the money out of the wallet; fails cleanly if the balance is short.
  update public.users set balance = balance - v_amount
    where id = v_uid and balance >= v_amount
    returning coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'YTCash user')
    into v_sender_name;
  if not found then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (v_uid, null, v_amount, 'PHP', v_amount, 'PHP', 'send', 'pending',
     'P2P cash delivery to ' || left(trim(p_receiver_name), 60))
  returning id into v_tx_id;

  insert into public.p2p_orders
    (sender_id, partner_id, sender_name, partner_name, amount,
     receiver_name, receiver_phone, receiver_address, receiver_lat, receiver_lng,
     distance_km, transaction_id)
  values
    (v_uid, v_partner.partner_id, v_sender_name, v_partner.partner_name, v_amount,
     left(trim(p_receiver_name), 80), left(trim(p_receiver_phone), 30),
     left(trim(p_receiver_address), 300), p_lat, p_lng,
     round(v_partner.distance_km::numeric, 2), v_tx_id)
  returning * into v_order;

  -- 6-digit release code, visible to the sender only
  insert into public.p2p_order_codes (order_id, code)
  values (
    v_order.id,
    lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::int) % 1000000)::text, 6, '0')
  );

  return v_order;
end;
$$;

-- Partner: accept the order assigned to them
create or replace function public.p2p_accept_order(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  perform public.kyc_require('p2p');
  update public.p2p_orders
    set status = 'accepted', accepted_at = now()
    where id = p_order_id and partner_id = auth.uid() and status = 'matched' and mode = 'escrow'
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: hand the order back. It goes to the next-nearest partner, or is refunded if there is none.
create or replace function public.p2p_decline_order(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.p2p_orders;
  v_declined uuid[];
  v_next record;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and partner_id = v_uid and status in ('matched', 'accepted') and mode = 'escrow'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  v_declined := v_order.declined_by || v_uid;
  select * into v_next
    from public.p2p_find_partner(v_order.receiver_lat, v_order.receiver_lng, v_declined || v_order.sender_id);

  if v_next.partner_id is null then
    update public.p2p_orders set declined_by = v_declined where id = v_order.id;
    return public.p2p_refund(v_order, 'no_partner');
  end if;

  update public.p2p_orders
    set partner_id = v_next.partner_id,
        partner_name = v_next.partner_name,
        distance_km = round(v_next.distance_km::numeric, 2),
        declined_by = v_declined,
        status = 'matched',
        accepted_at = null,
        failed_code_attempts = 0
    where id = v_order.id
    returning * into v_order;
  return v_order;
end;
$$;

-- Sender: cancel and refund. Allowed until a partner accepts, or after the order expires.
create or replace function public.p2p_cancel_order(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and sender_id = auth.uid() and status in ('matched', 'accepted') and mode = 'escrow'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if v_order.status = 'accepted' and now() < v_order.expires_at then
    raise exception 'ORDER_IN_PROGRESS';
  end if;
  return public.p2p_refund(v_order, 'sender_cancelled');
end;
$$;

-- Partner: confirm the hand-over with the receiver's release code.
-- Returns { ok, reason?, attempts_left? } so a wrong attempt is still counted.
create or replace function public.p2p_complete_order(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
  v_code text;
  v_attempts integer;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and partner_id = auth.uid() and status = 'accepted' and mode = 'escrow'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if v_order.failed_code_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'attempts_left', 0);
  end if;

  select code into v_code from public.p2p_order_codes where order_id = v_order.id;
  if v_code is null or v_code <> trim(coalesce(p_code, '')) then
    update public.p2p_orders
      set failed_code_attempts = failed_code_attempts + 1
      where id = v_order.id
      returning failed_code_attempts into v_attempts;
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_attempts >= 5 then 'locked' else 'wrong_code' end,
      'attempts_left', greatest(0, 5 - v_attempts)
    );
  end if;

  perform public.p2p_pay_partner(v_order);
  return jsonb_build_object('ok', true);
end;
$$;

-- Sender: release escrow themselves once the receiver confirms they got the cash
create or replace function public.p2p_release_order(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and sender_id = auth.uid() and status = 'accepted' and mode = 'escrow'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return public.p2p_pay_partner(v_order);
end;
$$;

-- Helpers are internal; the app can only call the order actions, and only when signed in.
revoke execute on function public.p2p_find_partner(double precision, double precision, uuid[]) from public, anon, authenticated;
revoke execute on function public.p2p_refund(public.p2p_orders, text) from public, anon, authenticated;
revoke execute on function public.p2p_pay_partner(public.p2p_orders) from public, anon, authenticated;

revoke execute on function public.p2p_create_order(numeric, text, text, text, double precision, double precision) from public, anon;
revoke execute on function public.p2p_accept_order(uuid) from public, anon;
revoke execute on function public.p2p_decline_order(uuid) from public, anon;
revoke execute on function public.p2p_cancel_order(uuid) from public, anon;
revoke execute on function public.p2p_complete_order(uuid, text) from public, anon;
revoke execute on function public.p2p_release_order(uuid) from public, anon;

grant execute on function public.p2p_create_order(numeric, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.p2p_accept_order(uuid) to authenticated;
grant execute on function public.p2p_decline_order(uuid) to authenticated;
grant execute on function public.p2p_cancel_order(uuid) to authenticated;
grant execute on function public.p2p_complete_order(uuid, text) to authenticated;
grant execute on function public.p2p_release_order(uuid) to authenticated;

-- 9e. Live order updates in the app
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'p2p_orders'
  ) then
    alter publication supabase_realtime add table public.p2p_orders;
  end if;
end $$;

-- ============================================================
-- 10. Wallet hardening
-- Balances and the ledger can no longer be written from the app. Every
-- balance change goes through a function below that acts only on the
-- signed-in user (auth.uid()) and validates what it is asked to do.
--
-- IMPORTANT: ship this together with the app version that calls these
-- functions. Older app builds that write balances directly stop working
-- once this section is applied.
-- ============================================================

-- 10a. Close direct writes
-- The old helper let any signed-in user add any amount to any account.
revoke execute on function public.update_balance(uuid, numeric) from public, anon, authenticated;

-- Profile rows: readable by their owner (RLS), but only the display name and
-- avatar are editable. Balance, KYC status, email and phone are server-managed.
revoke all on public.users from anon, authenticated;
grant select on public.users to authenticated;
grant update (full_name, avatar_url) on public.users to authenticated;

-- Ledger and scan records are read-only to the app.
revoke all on public.transactions from anon, authenticated;
grant select on public.transactions to authenticated;
revoke all on public.scanned_cash from anon, authenticated;
grant select on public.scanned_cash to authenticated;

-- 10b. Settings (server-side only; not readable from the app)
create table if not exists public.wallet_settings (
  id boolean primary key default true check (id),
  -- Deposits are simulated: no card is charged. Keep this on for testing and
  -- set it to false before real money is involved, until deposits are credited
  -- by a verified payment (e.g. a Stripe webhook using the service role).
  demo_deposits_enabled boolean not null default true,
  deposit_max numeric(12,2) not null default 50000,
  deposit_daily_limit numeric(12,2) not null default 100000,
  scan_daily_limit numeric(12,2) not null default 100000,
  send_max numeric(12,2) not null default 500000,
  -- How far an app-supplied exchange rate may differ from the reference rate.
  fx_tolerance numeric(4,2) not null default 0.25
);
insert into public.wallet_settings (id) values (true) on conflict (id) do nothing;
alter table public.wallet_settings enable row level security;
revoke all on public.wallet_settings from anon, authenticated;

-- Banknotes the scanner may credit, with a reference PHP rate per unit.
-- Update php_per_unit from time to time (or from a scheduled job).
create table if not exists public.wallet_fx_reference (
  currency text primary key,
  php_per_unit numeric(12,4) not null check (php_per_unit > 0),
  denominations numeric[] not null,
  updated_at timestamptz not null default now()
);
insert into public.wallet_fx_reference (currency, php_per_unit, denominations) values
  ('PHP', 1,     array[20, 50, 100, 200, 500, 1000]),
  ('USD', 58,    array[1, 2, 5, 10, 20, 50, 100]),
  ('EUR', 64,    array[5, 10, 20, 50, 100, 200, 500]),
  ('AED', 15.8,  array[5, 10, 20, 50, 100, 200, 500, 1000])
on conflict (currency) do nothing;
alter table public.wallet_fx_reference enable row level security;
revoke all on public.wallet_fx_reference from anon, authenticated;

-- 10c. Profile creation without client-supplied balance, email or phone
create or replace function public.ensure_profile()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.users;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  insert into public.users (id, email, phone, full_name, avatar_url)
  select
    a.id,
    a.email,
    nullif(a.phone, ''),
    coalesce(a.raw_user_meta_data->>'full_name', a.raw_user_meta_data->>'name', ''),
    coalesce(a.raw_user_meta_data->>'avatar_url', a.raw_user_meta_data->>'picture', null)
  from auth.users a
  where a.id = v_uid
  on conflict (id) do update
    set email = excluded.email,
        phone = coalesce(excluded.phone, users.phone);

  select * into v_profile from public.users where id = v_uid;
  return v_profile;
end;
$$;

-- Fill in phone numbers for people who signed up by phone before profiles stored them.
update public.users u
  set phone = nullif(a.phone, '')
  from auth.users a
  where a.id = u.id and u.phone is null and nullif(a.phone, '') is not null;

-- 10d. Send money
-- Looks up a recipient by exact email or phone. Returns only id and name.
create or replace function public.wallet_find_recipient(p_identifier text)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.full_name
  from public.users u
  where auth.uid() is not null
    and length(trim(coalesce(p_identifier, ''))) >= 5
    and (
      lower(u.email) = lower(trim(p_identifier))
      -- Phone numbers match on digits only, so "+63 917..." and "63917..." are the same.
      or (
        length(regexp_replace(p_identifier, '\D', '', 'g')) >= 7
        and regexp_replace(u.phone, '\D', '', 'g') = regexp_replace(p_identifier, '\D', '', 'g')
      )
    )
  limit 1;
$$;

-- Moves money from the signed-in user to another user, atomically.
create or replace function public.wallet_send(p_to uuid, p_amount numeric, p_note text default null)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_max numeric;
  v_tx public.transactions;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  perform public.kyc_require('send');
  select send_max into v_max from public.wallet_settings;
  if v_amount is null or v_amount <= 0 or v_amount > v_max then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_to is null or p_to = v_uid then
    raise exception 'INVALID_RECIPIENT';
  end if;

  -- Lock sender and recipient rows in deterministic UUID order to prevent deadlocks
  perform 1 from public.users where id in (v_uid, p_to) order by id for update;

  update public.users set balance = balance - v_amount
    where id = v_uid and balance >= v_amount;
  if not found then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  update public.users set balance = balance + v_amount where id = p_to;
  if not found then
    raise exception 'INVALID_RECIPIENT';
  end if;

  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (v_uid, p_to, v_amount, 'PHP', v_amount, 'PHP', 'send', 'completed',
     nullif(left(trim(coalesce(p_note, '')), 200), ''))
  returning * into v_tx;
  return v_tx;
end;
$$;

-- 10e. Deposit (simulated until a real payment confirmation credits the wallet)
create or replace function public.wallet_deposit(p_amount numeric, p_method text default 'card')
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_settings public.wallet_settings;
  v_today numeric;
  v_tx public.transactions;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_settings from public.wallet_settings;
  if not v_settings.demo_deposits_enabled then
    raise exception 'DEPOSITS_DISABLED';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > v_settings.deposit_max then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Lock the wallet row so two deposits at once cannot both slip under the limit.
  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;

  select coalesce(sum(amount), 0) into v_today from public.transactions
    where to_user = v_uid and type = 'add' and status = 'completed'
      and created_at > now() - interval '24 hours';
  if v_today + v_amount > v_settings.deposit_daily_limit then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  update public.users set balance = balance + v_amount where id = v_uid;

  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (null, v_uid, v_amount, 'PHP', v_amount, 'PHP', 'add', 'completed',
     'Deposit via ' || case when p_method = 'lightning' then 'Lightning Network' else 'Stripe Card' end)
  returning * into v_tx;
  return v_tx;
end;
$$;

-- 10f. Cash scan
-- p_notes: [{ "currency": "USD", "denomination": 20, "rate": 58.1 }, ...]
-- The server only accepts real denominations and rates close to its reference,
-- works out the PHP total itself, and enforces a daily limit.
create or replace function public.wallet_add_scanned_cash(p_notes jsonb)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.wallet_settings;
  v_note jsonb;
  v_currency text;
  v_denomination numeric;
  v_rate numeric;
  v_ref public.wallet_fx_reference;
  v_php numeric(12,2);
  v_total numeric(12,2) := 0;
  v_summary text := '';
  v_today numeric;
  v_tx public.transactions;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if p_notes is null or jsonb_typeof(p_notes) <> 'array'
     or jsonb_array_length(p_notes) = 0 or jsonb_array_length(p_notes) > 20 then
    raise exception 'INVALID_SCAN';
  end if;
  select * into v_settings from public.wallet_settings;

  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;

  for v_note in select * from jsonb_array_elements(p_notes) loop
    begin
      v_currency := upper(v_note->>'currency');
      v_denomination := (v_note->>'denomination')::numeric;
      v_rate := (v_note->>'rate')::numeric;
    exception when others then
      raise exception 'INVALID_SCAN';
    end;

    select * into v_ref from public.wallet_fx_reference where currency = v_currency;
    if not found or v_denomination is null or not (v_denomination = any (v_ref.denominations)) then
      raise exception 'INVALID_SCAN';
    end if;
    if v_currency = 'PHP' then
      v_rate := 1;
    elsif v_rate is null
       or abs(v_rate - v_ref.php_per_unit) > v_ref.php_per_unit * v_settings.fx_tolerance then
      raise exception 'RATE_OUT_OF_RANGE';
    end if;

    v_php := round(v_denomination * v_rate, 2);
    v_total := v_total + v_php;
    v_summary := v_summary || case when v_summary = '' then '' else ', ' end
      || v_currency || ' ' || trim(to_char(v_denomination, 'FM999990'));

    insert into public.scanned_cash (user_id, currency, denomination, serial_number, php_equivalent, exchange_rate)
    values (v_uid, v_currency, v_denomination, null, v_php, v_rate);
  end loop;

  select coalesce(sum(amount), 0) into v_today from public.transactions
    where to_user = v_uid and type = 'scan' and status = 'completed'
      and created_at > now() - interval '24 hours';
  if v_today + v_total > v_settings.scan_daily_limit then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  update public.users set balance = balance + v_total where id = v_uid;

  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (null, v_uid, v_total, 'PHP', v_total, 'PHP', 'scan', 'completed', left('Cash scan: ' || v_summary, 200))
  returning * into v_tx;
  return v_tx;
end;
$$;

revoke execute on function public.ensure_profile() from public, anon;
revoke execute on function public.wallet_find_recipient(text) from public, anon;
revoke execute on function public.wallet_send(uuid, numeric, text) from public, anon;
revoke execute on function public.wallet_deposit(numeric, text) from public, anon;
revoke execute on function public.wallet_add_scanned_cash(jsonb) from public, anon;

grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.wallet_find_recipient(text) to authenticated;
grant execute on function public.wallet_send(uuid, numeric, text) to authenticated;
grant execute on function public.wallet_deposit(numeric, text) to authenticated;
grant execute on function public.wallet_add_scanned_cash(jsonb) to authenticated;


-- ============================================================
-- 11. KYC (identity verification)
-- Two ways to get verified, both ending in users.kyc_verified = true,
-- which only the server can set:
--   * Didit (automatic): ID document + face match + liveness. Sessions are
--     created by the `kyc` Edge Function and results arrive on the signed
--     `kyc-webhook` Edge Function.
--   * Manual review: the user uploads ID photos and a selfie to a private
--     bucket and a KYC admin approves or rejects in the app.
-- ============================================================

-- 11a. Settings (server-side only)
create table if not exists public.kyc_settings (
  id boolean primary key default true check (id),
  -- 'auto'   : use Didit when it is configured and working, otherwise manual review
  -- 'didit'  : Didit only (users see an error if it is unavailable)
  -- 'manual' : manual review only (e.g. once the free Didit checks are used up)
  provider_mode text not null default 'auto' check (provider_mode in ('auto', 'didit', 'manual')),
  -- Protects the Didit quota: sessions one user may start per 24 hours.
  didit_sessions_per_day integer not null default 3,
  -- Features that need a verified identity. Empty = KYC is optional.
  -- Supported values: 'p2p' (send or deliver cash), 'send' (wallet transfers).
  required_for text[] not null default '{}'
);
insert into public.kyc_settings (id) values (true) on conflict (id) do nothing;
alter table public.kyc_settings enable row level security;
revoke all on public.kyc_settings from anon, authenticated;

-- People allowed to review manual submissions. Add yourself in the SQL editor:
--   insert into public.kyc_admins (user_id)
--   select id from public.users where email = 'you@example.com';
create table if not exists public.kyc_admins (
  user_id uuid references public.users(id) on delete cascade primary key,
  added_at timestamptz not null default now()
);
alter table public.kyc_admins enable row level security;
revoke all on public.kyc_admins from anon, authenticated;

create or replace function public.kyc_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.kyc_admins where user_id = auth.uid());
$$;

-- 11b. Verification attempts
create table if not exists public.kyc_verifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  method text not null check (method in ('didit', 'manual')),
  status text not null default 'started'
    check (status in ('started', 'pending_review', 'approved', 'declined', 'expired')),
  -- Didit
  didit_session_id text unique,
  didit_status text,
  -- True when the result came from Didit's test mode and is simulated, not a real check.
  is_test boolean not null default false,
  -- Manual review
  legal_name text,
  date_of_birth date,
  document_type text check (document_type in ('passport', 'national_id', 'drivers_license', 'other')),
  id_front_path text,
  id_back_path text,
  selfie_path text,
  reviewed_by uuid references public.users(id),
  -- Shown to the user when declined, so keep it factual and actionable.
  review_note text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.kyc_verifications add column if not exists is_test boolean not null default false;

create index if not exists idx_kyc_verifications_user on public.kyc_verifications(user_id, created_at desc);
create index if not exists idx_kyc_verifications_queue on public.kyc_verifications(submitted_at)
  where status = 'pending_review' and method = 'manual';
-- A user has at most one manual submission open at a time.
create unique index if not exists idx_kyc_one_open_manual on public.kyc_verifications(user_id)
  where method = 'manual' and status in ('started', 'pending_review');

alter table public.kyc_verifications enable row level security;
revoke all on public.kyc_verifications from anon, authenticated;
grant select on public.kyc_verifications to authenticated;

drop policy if exists "Users can view own verifications" on public.kyc_verifications;
drop policy if exists "KYC admins can view all verifications" on public.kyc_verifications;

create policy "Users can view own verifications"
  on public.kyc_verifications for select
  using (auth.uid() = user_id);

create policy "KYC admins can view all verifications"
  on public.kyc_verifications for select
  using (public.kyc_is_admin());

-- 11c. Private bucket for ID photos and selfies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload own KYC documents" on storage.objects;
drop policy if exists "KYC admins read KYC documents" on storage.objects;

-- Users may add files under their own folder ("<user id>/<verification id>/...").
-- They cannot read, replace or delete them afterwards, and cannot see anyone else's.
create policy "Users upload own KYC documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "KYC admins read KYC documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'kyc-documents' and public.kyc_is_admin());

-- 11d. Enforcement helper used by the wallet and P2P functions
create or replace function public.kyc_require(p_feature text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.kyc_settings where p_feature = any (required_for))
     and not exists (select 1 from public.users where id = auth.uid() and kyc_verified) then
    raise exception 'KYC_REQUIRED';
  end if;
end;
$$;

-- Internal: write a decision and keep users.kyc_verified in step with it
create or replace function public.kyc_apply_decision(
  p_verification_id uuid, p_status text, p_note text, p_reviewer uuid
)
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kyc_verifications;
begin
  update public.kyc_verifications
    set status = p_status,
        review_note = p_note,
        reviewed_by = coalesce(p_reviewer, reviewed_by),
        decided_at = case when p_status in ('approved', 'declined', 'expired') then now() else decided_at end,
        updated_at = now()
    where id = p_verification_id
    returning * into v_row;

  if p_status = 'approved' then
    update public.users set kyc_verified = true where id = v_row.user_id;
  end if;
  return v_row;
end;
$$;

-- 11e. Manual review: user side
create or replace function public.kyc_start_manual()
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.kyc_verifications;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if exists (select 1 from public.kyc_settings where provider_mode = 'didit') then
    raise exception 'MANUAL_KYC_DISABLED';
  end if;
  if exists (select 1 from public.users where id = v_uid and kyc_verified) then
    raise exception 'ALREADY_VERIFIED';
  end if;

  select * into v_row from public.kyc_verifications
    where user_id = v_uid and method = 'manual' and status in ('started', 'pending_review');
  if found then
    if v_row.status = 'pending_review' then
      raise exception 'ALREADY_SUBMITTED';
    end if;
    return v_row;
  end if;

  -- Limit repeat attempts after a rejection.
  if (select count(*) from public.kyc_verifications
      where user_id = v_uid and method = 'manual' and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  insert into public.kyc_verifications (user_id, method) values (v_uid, 'manual')
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.kyc_submit_manual(
  p_verification_id uuid,
  p_legal_name text,
  p_date_of_birth date,
  p_document_type text,
  p_id_front_path text,
  p_id_back_path text,
  p_selfie_path text
)
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_row public.kyc_verifications;
  v_path text;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_row from public.kyc_verifications
    where id = p_verification_id and user_id = v_uid and method = 'manual' and status = 'started'
    for update;
  if not found then
    raise exception 'VERIFICATION_NOT_OPEN';
  end if;

  if length(trim(coalesce(p_legal_name, ''))) < 3
     or p_date_of_birth is null
     or p_date_of_birth > (current_date - interval '18 years')
     or p_date_of_birth < date '1900-01-01'
     or p_document_type is null
     or p_document_type not in ('passport', 'national_id', 'drivers_license', 'other') then
    raise exception 'INVALID_DETAILS';
  end if;
  if p_id_front_path is null or p_selfie_path is null then
    raise exception 'MISSING_DOCUMENTS';
  end if;

  -- Every file must sit in this user's folder for this verification and actually exist.
  v_prefix := v_uid::text || '/' || v_row.id::text || '/';
  foreach v_path in array array_remove(array[p_id_front_path, p_id_back_path, p_selfie_path], null) loop
    if left(v_path, length(v_prefix)) <> v_prefix
       or not exists (select 1 from storage.objects where bucket_id = 'kyc-documents' and name = v_path) then
      raise exception 'MISSING_DOCUMENTS';
    end if;
  end loop;

  update public.kyc_verifications
    set legal_name = left(trim(p_legal_name), 120),
        date_of_birth = p_date_of_birth,
        document_type = p_document_type,
        id_front_path = p_id_front_path,
        id_back_path = p_id_back_path,
        selfie_path = p_selfie_path,
        status = 'pending_review',
        submitted_at = now(),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  return v_row;
end;
$$;

-- 11f. Manual review: admin side
create or replace function public.kyc_review(p_verification_id uuid, p_approve boolean, p_note text default null)
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kyc_verifications;
begin
  if not public.kyc_is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_row from public.kyc_verifications
    where id = p_verification_id and method = 'manual' and status = 'pending_review'
    for update;
  if not found then
    raise exception 'VERIFICATION_NOT_OPEN';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;

  return public.kyc_apply_decision(
    v_row.id,
    case when p_approve then 'approved' else 'declined' end,
    nullif(left(trim(coalesce(p_note, '')), 300), ''),
    auth.uid()
  );
end;
$$;

-- Admin: withdraw someone's verified status (e.g. a fraudulent document found later)
create or replace function public.kyc_revoke(p_user_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.kyc_is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;
  update public.users set kyc_verified = false where id = p_user_id;
  update public.kyc_verifications
    set status = 'declined', review_note = left(trim(p_note), 300),
        reviewed_by = auth.uid(), decided_at = now(), updated_at = now()
    where user_id = p_user_id and status = 'approved';
end;
$$;

-- 11g. Didit: called only by the Edge Functions (service role)
create or replace function public.kyc_didit_can_start(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.kyc_settings;
begin
  select * into v_settings from public.kyc_settings;
  if exists (select 1 from public.users where id = p_user_id and kyc_verified) then
    return 'verified';
  end if;
  if v_settings.provider_mode = 'manual' then
    return 'manual';
  end if;
  if (select count(*) from public.kyc_verifications
      where user_id = p_user_id and method = 'didit' and created_at > now() - interval '24 hours')
     >= v_settings.didit_sessions_per_day then
    return case when v_settings.provider_mode = 'auto' then 'manual' else 'limit' end;
  end if;
  return v_settings.provider_mode; -- 'auto' or 'didit'
end;
$$;

drop function if exists public.kyc_didit_record_session(uuid, text);

create or replace function public.kyc_didit_record_session(p_user_id uuid, p_session_id text, p_is_test boolean default false)
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kyc_verifications;
begin
  -- Didit hands back the same unfinished session for the same user, so this may already exist.
  insert into public.kyc_verifications (user_id, method, didit_session_id, didit_status, is_test)
  values (p_user_id, 'didit', p_session_id, 'Not Started', coalesce(p_is_test, false))
  on conflict (didit_session_id) do update set updated_at = now()
  returning * into v_row;
  if v_row.user_id <> p_user_id then
    raise exception 'SESSION_USER_MISMATCH';
  end if;
  return v_row;
end;
$$;

-- Applies a status reported by Didit. Unknown sessions are ignored, and a late or
-- out-of-order "in progress" event can never undo an approval.
create or replace function public.kyc_didit_apply_status(p_session_id text, p_didit_status text)
returns public.kyc_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.kyc_verifications;
  v_status text;
begin
  select * into v_row from public.kyc_verifications
    where didit_session_id = p_session_id and method = 'didit'
    for update;
  if not found then
    return null;
  end if;

  v_status := case p_didit_status
    when 'Approved' then 'approved'
    when 'Declined' then 'declined'
    when 'In Review' then 'pending_review'
    when 'Abandoned' then 'expired'
    when 'Expired' then 'expired'
    when 'Kyc Expired' then 'expired'
    when 'Not Started' then 'started'
    when 'In Progress' then 'started'
    when 'Awaiting User' then 'started'
    when 'Resubmitted' then 'started'
    else null
  end;
  if v_status is null then
    return v_row;
  end if;

  if v_row.status = 'approved' then
    -- Only an explicit decline or expiry of the verification changes an approved user.
    if p_didit_status in ('Declined', 'Kyc Expired') then
      update public.users set kyc_verified = false where id = v_row.user_id
        and not exists (
          select 1 from public.kyc_verifications k
          where k.user_id = v_row.user_id and k.status = 'approved' and k.id <> v_row.id
        );
    else
      return v_row;
    end if;
  elsif v_row.status in ('declined', 'expired') and v_status in ('started', 'expired') then
    return v_row;
  end if;

  update public.kyc_verifications set didit_status = p_didit_status where id = v_row.id;
  return public.kyc_apply_decision(
    v_row.id, v_status,
    case when v_status = 'declined' then 'Your ID or face check did not pass. You can try again.' else null end,
    null
  );
end;
$$;

-- Going live: run `select public.kyc_clear_test_verifications();` in the SQL editor.
-- Everyone who was only "verified" by a simulated test result goes back to
-- unverified and is asked to verify for real. Returns how many users changed.
create or replace function public.kyc_clear_test_verifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.kyc_verifications
    set status = 'expired', review_note = 'Test verification cleared', updated_at = now()
    where is_test and status in ('started', 'pending_review', 'approved');

  update public.users u set kyc_verified = false
    where u.kyc_verified
      and not exists (
        select 1 from public.kyc_verifications k
        where k.user_id = u.id and k.status = 'approved' and not k.is_test
      );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 11h. Who may call what
revoke execute on function public.kyc_apply_decision(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.kyc_require(text) from public, anon, authenticated;
revoke execute on function public.kyc_didit_can_start(uuid) from public, anon, authenticated;
revoke execute on function public.kyc_didit_record_session(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.kyc_clear_test_verifications() from public, anon, authenticated;
revoke execute on function public.kyc_didit_apply_status(text, text) from public, anon, authenticated;

revoke execute on function public.kyc_is_admin() from public, anon;
revoke execute on function public.kyc_start_manual() from public, anon;
revoke execute on function public.kyc_submit_manual(uuid, text, date, text, text, text, text) from public, anon;
revoke execute on function public.kyc_review(uuid, boolean, text) from public, anon;
revoke execute on function public.kyc_revoke(uuid, text) from public, anon;

grant execute on function public.kyc_is_admin() to authenticated;
grant execute on function public.kyc_start_manual() to authenticated;
grant execute on function public.kyc_submit_manual(uuid, text, date, text, text, text, text) to authenticated;
grant execute on function public.kyc_review(uuid, boolean, text) to authenticated;
grant execute on function public.kyc_revoke(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.kyc_didit_can_start(uuid) to service_role;
    grant execute on function public.kyc_didit_record_session(uuid, text, boolean) to service_role;
    grant execute on function public.kyc_didit_apply_status(text, text) to service_role;
  end if;
end $$;

-- ============================================================
-- 12. Foreign-currency quotes and withdrawals
--   * A sender abroad gets a quote (e.g. AED -> PHP) with a rate and fee
--     that are fixed on the server for a few minutes, then pays for a P2P
--     cash delivery with it.
--   * Anyone with a wallet balance (typically a cash partner) can ask to
--     withdraw it to GCash, Maya or a bank; a reviewer pays it out and
--     marks it paid, or rejects it and the money returns to the wallet.
-- ============================================================

-- 12a. Pricing (server-side only). Edit this row to change what customers pay.
create table if not exists public.fx_settings (
  id boolean primary key default true check (id),
  -- Taken off the market rate: customer rate = market rate x (1 - margin).
  margin numeric(5,4) not null default 0.0100 check (margin >= 0 and margin < 0.5),
  -- Transfer fee as a share of the amount converted, with a floor.
  fee_pct numeric(5,4) not null default 0.0150 check (fee_pct >= 0 and fee_pct < 0.5),
  min_fee_php numeric(12,2) not null default 50 check (min_fee_php >= 0),
  -- How long a quoted rate is held.
  quote_ttl_seconds integer not null default 600 check (quote_ttl_seconds between 30 and 3600),
  -- Quotes stop if the market rate has not been refreshed for this long.
  max_rate_age_hours integer not null default 168,
  currencies text[] not null default '{AED,USD,EUR}'
);
insert into public.fx_settings (id) values (true) on conflict (id) do nothing;
alter table public.fx_settings enable row level security;
revoke all on public.fx_settings from anon, authenticated;

-- 12b. Quotes
create table if not exists public.fx_quotes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  from_currency text not null,
  -- PHP per 1 unit of from_currency: the market rate and the rate the customer gets.
  mid_rate numeric(14,6) not null,
  rate numeric(14,6) not null,
  -- All three in from_currency: pay_amount = send_amount + fee_amount.
  send_amount numeric(12,2) not null,
  fee_amount numeric(12,2) not null,
  pay_amount numeric(12,2) not null,
  -- What the receiver gets, in PHP.
  receive_amount numeric(12,2) not null,
  rate_as_of timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists idx_fx_quotes_user on public.fx_quotes(user_id, created_at desc);

alter table public.fx_quotes enable row level security;
revoke all on public.fx_quotes from anon, authenticated;
grant select on public.fx_quotes to authenticated;

drop policy if exists "Users can view own quotes" on public.fx_quotes;
create policy "Users can view own quotes"
  on public.fx_quotes for select
  using (auth.uid() = user_id);

alter table public.p2p_orders add column if not exists quote_id uuid references public.fx_quotes(id);
alter table public.p2p_orders add column if not exists pay_currency text;
alter table public.p2p_orders add column if not exists pay_amount numeric(12,2);
alter table public.p2p_orders add column if not exists fee_amount numeric(12,2);
alter table public.p2p_orders add column if not exists fx_rate numeric(14,6);

-- Server-side refresh of a market rate (called by the `fx-rates` Edge Function).
-- A new value far from the current one is refused, so a bad feed cannot move prices.
create or replace function public.fx_set_reference_rate(p_currency text, p_php_per_unit numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
begin
  select php_per_unit into v_current from public.wallet_fx_reference where currency = upper(p_currency);
  if not found or p_currency = 'PHP' or p_php_per_unit is null or p_php_per_unit <= 0 then
    return false;
  end if;
  if abs(p_php_per_unit - v_current) > v_current * 0.30 then
    return false;
  end if;
  update public.wallet_fx_reference
    set php_per_unit = round(p_php_per_unit, 4), updated_at = now()
    where currency = upper(p_currency);
  return true;
end;
$$;

-- Customer: ask for a quote.
--   p_side = 'pay'     -> p_amount is what the sender pays in total (fee included)
--   p_side = 'receive' -> p_amount is what the receiver should get in PHP
create or replace function public.fx_request_quote(p_from_currency text, p_side text, p_amount numeric)
returns public.fx_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.fx_settings;
  v_ref public.wallet_fx_reference;
  v_currency text := upper(coalesce(p_from_currency, ''));
  v_rate numeric;
  v_min_fee numeric;
  v_send numeric;
  v_fee numeric;
  v_pay numeric;
  v_receive numeric;
  v_quote public.fx_quotes;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_settings from public.fx_settings;
  if v_currency = 'PHP' or not (v_currency = any (v_settings.currencies)) then
    raise exception 'CURRENCY_NOT_SUPPORTED';
  end if;
  select * into v_ref from public.wallet_fx_reference where currency = v_currency;
  if not found or v_ref.updated_at < now() - make_interval(hours => v_settings.max_rate_age_hours) then
    raise exception 'RATE_UNAVAILABLE';
  end if;
  if p_amount is null or p_amount <= 0 or p_side is null or p_side not in ('pay', 'receive') then
    raise exception 'INVALID_AMOUNT';
  end if;
  if (select count(*) from public.fx_quotes
      where user_id = v_uid and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'TOO_MANY_QUOTES';
  end if;

  v_rate := round(v_ref.php_per_unit * (1 - v_settings.margin), 4);
  v_min_fee := round(v_settings.min_fee_php / v_rate, 2);

  if p_side = 'pay' then
    v_pay := round(p_amount, 2);
    v_send := v_pay / (1 + v_settings.fee_pct);
    if v_send * v_settings.fee_pct < v_min_fee then
      v_send := v_pay - v_min_fee;
    end if;
    v_send := round(v_send, 2);
    v_fee := v_pay - v_send;
    -- Round the payout down so the receiver is never promised more than was converted.
    v_receive := floor(v_send * v_rate * 100) / 100;
  else
    v_receive := round(p_amount, 2);
    -- Round the charge up so the converted amount always covers the payout.
    v_send := ceil(v_receive / v_rate * 100) / 100;
    v_fee := greatest(round(v_send * v_settings.fee_pct, 2), v_min_fee);
    v_pay := v_send + v_fee;
  end if;

  if v_send <= 0 or v_receive < 100 or v_receive > 50000 then
    raise exception 'AMOUNT_OUT_OF_RANGE';
  end if;

  -- Old unused quotes are of no use to anyone.
  delete from public.fx_quotes
    where user_id = v_uid and used_at is null and expires_at < now() - interval '1 hour';

  insert into public.fx_quotes
    (user_id, from_currency, mid_rate, rate, send_amount, fee_amount, pay_amount, receive_amount, rate_as_of, expires_at)
  values
    (v_uid, v_currency, v_ref.php_per_unit, v_rate, v_send, v_fee, v_pay, v_receive, v_ref.updated_at,
     now() + make_interval(secs => v_settings.quote_ttl_seconds))
  returning * into v_quote;
  return v_quote;
end;
$$;

-- Customer: pay for a P2P cash delivery with a quote.
-- The foreign-currency payment is SIMULATED for now (no card is charged), exactly
-- like Add Money, and is subject to the same switch and daily limit. When a real
-- payment provider is added, this is the step that must wait for its confirmation.
create or replace function public.p2p_create_order_from_quote(
  p_quote_id uuid,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_lat double precision,
  p_lng double precision
)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quote public.fx_quotes;
  v_settings public.wallet_settings;
  v_today numeric;
  v_order public.p2p_orders;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_quote from public.fx_quotes
    where id = p_quote_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND';
  end if;
  if v_quote.used_at is not null then
    raise exception 'QUOTE_USED';
  end if;
  if v_quote.expires_at < now() then
    raise exception 'QUOTE_EXPIRED';
  end if;

  select * into v_settings from public.wallet_settings;
  if not v_settings.demo_deposits_enabled then
    raise exception 'PAYMENTS_UNAVAILABLE';
  end if;

  perform 1 from public.users where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;
  select coalesce(sum(amount), 0) into v_today from public.transactions
    where to_user = v_uid and type = 'add' and status = 'completed'
      and created_at > now() - interval '24 hours';
  if v_today + v_quote.receive_amount > v_settings.deposit_daily_limit then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  -- 1. The (simulated) payment funds the wallet with the converted amount.
  update public.users set balance = balance + v_quote.receive_amount where id = v_uid;
  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (null, v_uid, v_quote.receive_amount, 'PHP', v_quote.receive_amount, 'PHP', 'add', 'completed',
     format('Paid %s %s (fee %s) at %s', v_quote.from_currency,
            trim(to_char(v_quote.pay_amount, 'FM999999990.00')),
            trim(to_char(v_quote.fee_amount, 'FM999999990.00')),
            trim(to_char(v_quote.rate, 'FM999990.0000'))));

  -- 2. The usual order: KYC check, nearest partner, escrow. Any failure undoes step 1.
  v_order := public.p2p_create_order(
    v_quote.receive_amount, p_receiver_name, p_receiver_phone, p_receiver_address, p_lat, p_lng);

  update public.fx_quotes set used_at = now() where id = v_quote.id;
  update public.p2p_orders
    set quote_id = v_quote.id,
        pay_currency = v_quote.from_currency,
        pay_amount = v_quote.pay_amount,
        fee_amount = v_quote.fee_amount,
        fx_rate = v_quote.rate
    where id = v_order.id
    returning * into v_order;
  return v_order;
end;
$$;

-- 12c. Withdrawals
alter table public.wallet_settings add column if not exists withdrawals_enabled boolean not null default true;
alter table public.wallet_settings add column if not exists withdrawals_require_kyc boolean not null default true;
alter table public.wallet_settings add column if not exists withdraw_min numeric(12,2) not null default 100;
alter table public.wallet_settings add column if not exists withdraw_max numeric(12,2) not null default 50000;
alter table public.wallet_settings add column if not exists withdraw_daily_limit numeric(12,2) not null default 100000;
-- Flat fee per withdrawal, in PHP, taken on top of the amount requested.
alter table public.wallet_settings add column if not exists withdraw_fee numeric(12,2) not null default 0;

create table if not exists public.withdrawal_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  user_name text not null default '',
  -- What the user receives, and the fee charged on top. Both in PHP.
  amount numeric(12,2) not null check (amount > 0),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  method text not null check (method in ('gcash', 'maya', 'bank')),
  account_name text not null,
  account_number text not null,
  bank_name text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'cancelled')),
  -- The reference of the transfer you made, shown to the user as proof.
  payout_reference text,
  -- Shown to the user when rejected.
  admin_note text,
  reviewed_by uuid references public.users(id),
  transaction_id uuid references public.transactions(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists idx_withdrawals_user on public.withdrawal_requests(user_id, created_at desc);
create index if not exists idx_withdrawals_queue on public.withdrawal_requests(created_at) where status = 'pending';

alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from anon, authenticated;
grant select on public.withdrawal_requests to authenticated;

drop policy if exists "Users can view own withdrawals" on public.withdrawal_requests;
drop policy if exists "Reviewers can view all withdrawals" on public.withdrawal_requests;

create policy "Users can view own withdrawals"
  on public.withdrawal_requests for select
  using (auth.uid() = user_id);

-- The same people who review identity documents (kyc_admins) pay out withdrawals.
create policy "Reviewers can view all withdrawals"
  on public.withdrawal_requests for select
  using (public.kyc_is_admin());

-- User: ask for a withdrawal. The amount (plus fee) leaves the wallet immediately and is held.
create or replace function public.wallet_request_withdrawal(
  p_amount numeric,
  p_method text,
  p_account_name text,
  p_account_number text,
  p_bank_name text default null
)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_settings public.wallet_settings;
  v_user public.users;
  v_account text := regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g');
  v_today numeric;
  v_total numeric(12,2);
  v_tx_id uuid;
  v_row public.withdrawal_requests;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into v_settings from public.wallet_settings;
  if not v_settings.withdrawals_enabled then
    raise exception 'WITHDRAWALS_DISABLED';
  end if;

  select * into v_user from public.users where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;
  if v_settings.withdrawals_require_kyc and not v_user.kyc_verified then
    raise exception 'KYC_REQUIRED';
  end if;

  if v_amount is null or v_amount < v_settings.withdraw_min or v_amount > v_settings.withdraw_max then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_method is null or p_method not in ('gcash', 'maya', 'bank')
     or length(trim(coalesce(p_account_name, ''))) < 2
     or v_account !~ '^\+?[0-9]{7,20}$'
     or (p_method = 'bank' and length(trim(coalesce(p_bank_name, ''))) < 2) then
    raise exception 'INVALID_ACCOUNT';
  end if;

  if (select count(*) from public.withdrawal_requests where user_id = v_uid and status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING';
  end if;
  select coalesce(sum(amount), 0) into v_today from public.withdrawal_requests
    where user_id = v_uid and status in ('pending', 'paid') and created_at > now() - interval '24 hours';
  if v_today + v_amount > v_settings.withdraw_daily_limit then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  v_total := v_amount + v_settings.withdraw_fee;
  if v_user.balance < v_total then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;
  update public.users set balance = balance - v_total where id = v_uid;

  insert into public.transactions
    (from_user, to_user, amount, currency, converted_amount, converted_currency, type, status, note)
  values
    (v_uid, null, v_total, 'PHP', v_total, 'PHP', 'withdraw', 'pending',
     'Withdrawal to ' || case p_method when 'gcash' then 'GCash' when 'maya' then 'Maya' else left(trim(p_bank_name), 40) end
       || ' ••••' || right(v_account, 4))
  returning id into v_tx_id;

  insert into public.withdrawal_requests
    (user_id, user_name, amount, fee, method, account_name, account_number, bank_name, transaction_id)
  values
    (v_uid, coalesce(nullif(trim(v_user.full_name), ''), 'YTCash user'), v_amount, v_settings.withdraw_fee,
     p_method, left(trim(p_account_name), 80), v_account,
     case when p_method = 'bank' then left(trim(p_bank_name), 60) else null end, v_tx_id)
  returning * into v_row;
  return v_row;
end;
$$;

-- Internal: give a held withdrawal back to the wallet
create or replace function public.wallet_refund_withdrawal(p_row public.withdrawal_requests, p_status text, p_note text, p_reviewer uuid)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.withdrawal_requests;
begin
  update public.users set balance = balance + p_row.amount + p_row.fee where id = p_row.user_id;
  update public.transactions set status = 'failed' where id = p_row.transaction_id;
  update public.withdrawal_requests
    set status = p_status, admin_note = p_note, reviewed_by = p_reviewer, decided_at = now()
    where id = p_row.id
    returning * into v_row;
  return v_row;
end;
$$;

-- User: cancel a withdrawal that has not been handled yet
create or replace function public.wallet_cancel_withdrawal(p_id uuid)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.withdrawal_requests;
begin
  select * into v_row from public.withdrawal_requests
    where id = p_id and user_id = auth.uid() and status = 'pending'
    for update;
  if not found then
    raise exception 'WITHDRAWAL_NOT_OPEN';
  end if;
  return public.wallet_refund_withdrawal(v_row, 'cancelled', null, null);
end;
$$;

-- Reviewer: mark as paid (after sending the money) or reject (money returns to the wallet)
create or replace function public.wallet_review_withdrawal(
  p_id uuid, p_paid boolean, p_reference text default null, p_note text default null
)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.withdrawal_requests;
begin
  if not public.kyc_is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_row from public.withdrawal_requests
    where id = p_id and status = 'pending'
    for update;
  if not found then
    raise exception 'WITHDRAWAL_NOT_OPEN';
  end if;

  if p_paid then
    if length(trim(coalesce(p_reference, ''))) < 3 then
      raise exception 'REFERENCE_REQUIRED';
    end if;
    update public.transactions set status = 'completed' where id = v_row.transaction_id;
    update public.withdrawal_requests
      set status = 'paid', payout_reference = left(trim(p_reference), 60),
          reviewed_by = auth.uid(), decided_at = now()
      where id = v_row.id
      returning * into v_row;
    return v_row;
  end if;

  if length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;
  return public.wallet_refund_withdrawal(v_row, 'rejected', left(trim(p_note), 300), auth.uid());
end;
$$;

-- 12d. Who may call what
revoke execute on function public.fx_set_reference_rate(text, numeric) from public, anon, authenticated;
revoke execute on function public.wallet_refund_withdrawal(public.withdrawal_requests, text, text, uuid) from public, anon, authenticated;

revoke execute on function public.fx_request_quote(text, text, numeric) from public, anon;
revoke execute on function public.p2p_create_order_from_quote(uuid, text, text, text, double precision, double precision) from public, anon;
revoke execute on function public.wallet_request_withdrawal(numeric, text, text, text, text) from public, anon;
revoke execute on function public.wallet_cancel_withdrawal(uuid) from public, anon;
revoke execute on function public.wallet_review_withdrawal(uuid, boolean, text, text) from public, anon;

grant execute on function public.fx_request_quote(text, text, numeric) to authenticated;
grant execute on function public.p2p_create_order_from_quote(uuid, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.wallet_request_withdrawal(numeric, text, text, text, text) to authenticated;
grant execute on function public.wallet_cancel_withdrawal(uuid) to authenticated;
grant execute on function public.wallet_review_withdrawal(uuid, boolean, text, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fx_set_reference_rate(text, numeric) to service_role;
    grant select on public.wallet_fx_reference to service_role;
  end if;
end $$;


-- ============================================================
-- 13. Direct pay: deliver first, pay the partner afterwards
-- No money passes through YTCash. The sender picks a nearby partner, the
-- partner hands cash to the receiver, the receiver gives the partner the
-- release code (OTP), and only then is the sender shown the partner's
-- GCash / Maya / GoTyme account to pay. YTCash records each step.
--
-- The partner carries the risk of not being paid, so: a sender with an
-- unpaid or disputed delivery cannot start another, and partners see
-- whether the sender's identity is verified before accepting.
-- ============================================================

-- 13a. Partner details for direct pay
alter table public.p2p_partners add column if not exists accepts_direct boolean not null default false;
-- Shared with a sender only after the partner accepts their request.
alter table public.p2p_partners add column if not exists contact_phone text;

create table if not exists public.p2p_partner_payouts (
  user_id uuid references public.users(id) on delete cascade not null,
  method text not null check (method in ('gcash', 'maya', 'gotyme')),
  account_name text not null check (length(trim(account_name)) >= 2),
  account_number text not null check (account_number ~ '^\+?[0-9]{7,20}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, method)
);

alter table public.p2p_partner_payouts enable row level security;

drop policy if exists "Partners manage own payout accounts" on public.p2p_partner_payouts;

-- Only the partner can read these. A sender sees one account, copied onto
-- their order, once the delivery has been confirmed with the release code.
create policy "Partners manage own payout accounts"
  on public.p2p_partner_payouts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 13b. Order fields and statuses for direct pay
alter table public.p2p_orders add column if not exists pay_method text check (pay_method in ('gcash', 'maya', 'gotyme'));
alter table public.p2p_orders add column if not exists sender_contact text;
alter table public.p2p_orders add column if not exists sender_verified boolean not null default false;
alter table public.p2p_orders add column if not exists partner_contact text;
alter table public.p2p_orders add column if not exists pay_account_name text;
alter table public.p2p_orders add column if not exists pay_account_number text;
alter table public.p2p_orders add column if not exists payment_reference text;
alter table public.p2p_orders add column if not exists delivered_at timestamptz;
alter table public.p2p_orders add column if not exists paid_at timestamptz;

--   delivered : cash handed over and confirmed with the code; sender has not paid yet
--   paid      : sender says they sent the payment; partner has not confirmed it
--   disputed  : partner reports the payment did not arrive
alter table public.p2p_orders drop constraint if exists p2p_orders_status_check;
alter table public.p2p_orders add constraint p2p_orders_status_check
  check (status in ('matched', 'accepted', 'delivered', 'paid', 'disputed', 'completed', 'cancelled'));

-- 13c. Finding partners
-- Internal: partners who can take a direct-pay delivery near a point, nearest first.
create or replace function public.p2p_direct_candidates(
  p_lat double precision, p_lng double precision, p_method text, p_exclude uuid
)
returns table (partner_id uuid, partner_name text, lat double precision, lng double precision, distance_km double precision)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    coalesce(nullif(split_part(trim(u.full_name), ' ', 1), ''), 'YTCash partner'),
    p.lat, p.lng,
    public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) as km
  from public.p2p_partners p
  join public.users u on u.id = p.user_id
  join public.p2p_partner_payouts a on a.user_id = p.user_id and a.method = p_method
  where p.is_available
    and p.accepts_direct
    and p.contact_phone is not null
    and p.user_id <> p_exclude
    and public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) <= 30
  order by km asc, p.updated_at desc
  limit 5;
$$;

-- Sender: the nearest partners to the receiver, for the map. Partner positions are
-- the rounded (about 1 km) areas they chose to share; no contact details are returned.
create or replace function public.p2p_nearby_partners(p_lat double precision, p_lng double precision, p_method text)
returns table (partner_id uuid, partner_name text, lat double precision, lng double precision, distance_km double precision)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_method is null or p_method not in ('gcash', 'maya', 'gotyme') then
    raise exception 'INVALID_RECEIVER';
  end if;
  return query select * from public.p2p_direct_candidates(p_lat, p_lng, p_method, auth.uid());
end;
$$;

-- 13d. Order steps
-- Sender: ask a partner to deliver. Nothing is charged.
create or replace function public.p2p_direct_create(
  p_amount numeric,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_lat double precision,
  p_lng double precision,
  p_method text,
  p_sender_contact text,
  p_partner_id uuid default null
)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_contact text := regexp_replace(coalesce(p_sender_contact, ''), '[\s-]', '', 'g');
  v_sender public.users;
  v_partner record;
  v_order public.p2p_orders;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  perform public.kyc_require('p2p');
  if v_amount is null or v_amount < 100 or v_amount > 50000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_method is null or p_method not in ('gcash', 'maya', 'gotyme') then
    raise exception 'INVALID_METHOD';
  end if;
  if length(trim(coalesce(p_receiver_name, ''))) < 2
     or length(trim(coalesce(p_receiver_phone, ''))) < 7
     or length(trim(coalesce(p_receiver_address, ''))) < 5
     or p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_RECEIVER';
  end if;
  if v_contact !~ '^\+?[0-9]{7,20}$' then
    raise exception 'INVALID_CONTACT';
  end if;

  select * into v_sender from public.users where id = v_uid for update;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;
  -- A delivery that was made but not yet paid for blocks new requests.
  if exists (select 1 from public.p2p_orders
             where sender_id = v_uid and mode = 'direct' and status in ('delivered', 'disputed')) then
    raise exception 'UNPAID_ORDER';
  end if;
  if (select count(*) from public.p2p_orders
      where sender_id = v_uid and mode = 'direct' and status in ('matched', 'accepted', 'paid')) >= 3 then
    raise exception 'TOO_MANY_OPEN';
  end if;

  select * into v_partner
    from public.p2p_direct_candidates(p_lat, p_lng, p_method, v_uid) c
    where p_partner_id is null or c.partner_id = p_partner_id
    order by c.distance_km asc
    limit 1;
  if v_partner.partner_id is null then
    raise exception 'NO_PARTNER_NEARBY';
  end if;

  insert into public.p2p_orders
    (mode, pay_method, sender_id, partner_id, sender_name, partner_name, amount,
     receiver_name, receiver_phone, receiver_address, receiver_lat, receiver_lng,
     distance_km, sender_contact, sender_verified)
  values
    ('direct', p_method, v_uid, v_partner.partner_id,
     coalesce(nullif(split_part(trim(v_sender.full_name), ' ', 1), ''), 'YTCash user'),
     v_partner.partner_name, v_amount,
     left(trim(p_receiver_name), 80), left(trim(p_receiver_phone), 30),
     left(trim(p_receiver_address), 300), p_lat, p_lng,
     round(v_partner.distance_km::numeric, 2), v_contact, v_sender.kyc_verified)
  returning * into v_order;

  insert into public.p2p_order_codes (order_id, code)
  values (
    v_order.id,
    lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::int) % 1000000)::text, 6, '0')
  );
  return v_order;
end;
$$;

-- Partner: accept. The sender can now see the partner's contact number.
create or replace function public.p2p_direct_accept(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  perform public.kyc_require('p2p');
  update public.p2p_orders o
    set status = 'accepted', accepted_at = now(),
        partner_contact = (select contact_phone from public.p2p_partners where user_id = auth.uid())
    where o.id = p_order_id and o.partner_id = auth.uid() and o.status = 'matched' and o.mode = 'direct'
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner declines or sender cancels: allowed until the cash has been handed over.
create or replace function public.p2p_direct_cancel(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.p2p_orders;
begin
  update public.p2p_orders
    set status = 'cancelled', cancelled_at = now(),
        cancel_reason = case when sender_id = v_uid then 'sender_cancelled' else 'partner_declined' end
    where id = p_order_id and mode = 'direct' and status in ('matched', 'accepted')
      and (sender_id = v_uid or partner_id = v_uid)
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: confirm the hand-over with the receiver's code. Only now does the
-- sender get the partner's payment account.
create or replace function public.p2p_direct_deliver(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
  v_account public.p2p_partner_payouts;
  v_code text;
  v_attempts integer;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and partner_id = auth.uid() and status = 'accepted' and mode = 'direct'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if v_order.failed_code_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'attempts_left', 0);
  end if;
  select * into v_account from public.p2p_partner_payouts
    where user_id = v_order.partner_id and method = v_order.pay_method;
  if not found then
    raise exception 'PAYOUT_ACCOUNT_MISSING';
  end if;

  select code into v_code from public.p2p_order_codes where order_id = v_order.id;
  if v_code is null or v_code <> trim(coalesce(p_code, '')) then
    update public.p2p_orders
      set failed_code_attempts = failed_code_attempts + 1
      where id = v_order.id
      returning failed_code_attempts into v_attempts;
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_attempts >= 5 then 'locked' else 'wrong_code' end,
      'attempts_left', greatest(0, 5 - v_attempts)
    );
  end if;

  update public.p2p_orders
    set status = 'delivered', delivered_at = now(),
        pay_account_name = v_account.account_name,
        pay_account_number = v_account.account_number
    where id = v_order.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Sender: say the payment was sent, with the reference from their e-wallet.
create or replace function public.p2p_direct_mark_paid(p_order_id uuid, p_reference text)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  if length(trim(coalesce(p_reference, ''))) < 3 then
    raise exception 'REFERENCE_REQUIRED';
  end if;
  update public.p2p_orders
    set status = 'paid', paid_at = now(), payment_reference = left(trim(p_reference), 60)
    where id = p_order_id and sender_id = auth.uid() and mode = 'direct' and status in ('delivered', 'disputed')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: the payment arrived. Closes the order.
create or replace function public.p2p_direct_confirm_received(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  update public.p2p_orders
    set status = 'completed', completed_at = now()
    where id = p_order_id and partner_id = auth.uid() and mode = 'direct'
      and status in ('delivered', 'paid', 'disputed')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: the payment did not arrive. Possible straight away once the sender claims
-- to have paid, or an hour after delivery if the sender has done nothing.
create or replace function public.p2p_direct_report_unpaid(p_order_id uuid)
returns public.p2p_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.p2p_orders;
begin
  select * into v_order from public.p2p_orders
    where id = p_order_id and partner_id = auth.uid() and mode = 'direct' and status in ('delivered', 'paid')
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if v_order.status = 'delivered' and v_order.delivered_at > now() - interval '1 hour' then
    raise exception 'TOO_EARLY';
  end if;
  update public.p2p_orders set status = 'disputed' where id = v_order.id returning * into v_order;
  return v_order;
end;
$$;

-- 13e. Who may call what
revoke execute on function public.p2p_direct_candidates(double precision, double precision, text, uuid) from public, anon, authenticated;

revoke execute on function public.p2p_nearby_partners(double precision, double precision, text) from public, anon;
revoke execute on function public.p2p_direct_create(numeric, text, text, text, double precision, double precision, text, text, uuid) from public, anon;
revoke execute on function public.p2p_direct_accept(uuid) from public, anon;
revoke execute on function public.p2p_direct_cancel(uuid) from public, anon;
revoke execute on function public.p2p_direct_deliver(uuid, text) from public, anon;
revoke execute on function public.p2p_direct_mark_paid(uuid, text) from public, anon;
revoke execute on function public.p2p_direct_confirm_received(uuid) from public, anon;
revoke execute on function public.p2p_direct_report_unpaid(uuid) from public, anon;

grant execute on function public.p2p_nearby_partners(double precision, double precision, text) to authenticated;
grant execute on function public.p2p_direct_create(numeric, text, text, text, double precision, double precision, text, text, uuid) to authenticated;
grant execute on function public.p2p_direct_accept(uuid) to authenticated;
grant execute on function public.p2p_direct_cancel(uuid) to authenticated;
grant execute on function public.p2p_direct_deliver(uuid, text) to authenticated;
grant execute on function public.p2p_direct_mark_paid(uuid, text) to authenticated;
grant execute on function public.p2p_direct_confirm_received(uuid) to authenticated;
grant execute on function public.p2p_direct_report_unpaid(uuid) to authenticated;

-- ============================================================
-- 13. Direct Pay (GCash, GoTyme, Maya)
-- No money passes through YTCash here. The sender picks a nearby cash
-- partner, the partner hands cash to the receiver, the receiver gives the
-- partner an OTP code, and only then does the sender pay the partner
-- directly from their own GCash, GoTyme or Maya app.
--
-- The partner is paid AFTER handing over cash, so the partner carries the
-- risk of a sender who does not pay. Senders with an unpaid delivery cannot
-- start another one, and partners can report non-payment.
-- ============================================================

-- 13a. Where a partner wants to be paid
create table if not exists public.partner_payout_accounts (
  user_id uuid references public.users(id) on delete cascade not null,
  method text not null check (method in ('gcash', 'gotyme', 'maya')),
  account_name text not null,
  account_number text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, method)
);
alter table public.partner_payout_accounts enable row level security;
revoke all on public.partner_payout_accounts from anon, authenticated;
grant select on public.partner_payout_accounts to authenticated;

drop policy if exists "Partners can view own payout accounts" on public.partner_payout_accounts;
create policy "Partners can view own payout accounts"
  on public.partner_payout_accounts for select
  using (auth.uid() = user_id);

-- 13b. Orders
create table if not exists public.direct_orders (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references public.users(id) not null,
  partner_id uuid references public.users(id) not null,
  sender_name text not null default '',
  partner_name text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('gcash', 'gotyme', 'maya')),
  receiver_name text not null,
  receiver_phone text not null,
  receiver_address text not null,
  receiver_lat double precision not null,
  receiver_lng double precision not null,
  distance_km numeric(8,2),
  -- requested -> accepted -> delivered (OTP given) -> paid (sender says so) -> completed (partner got it)
  -- declined / cancelled end it early. disputed = partner reports no payment. unpaid = confirmed by a reviewer.
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'delivered', 'paid', 'completed',
                      'declined', 'cancelled', 'disputed', 'unpaid')),
  payment_reference text,
  resolution_note text,
  failed_code_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz
);
create index if not exists idx_direct_orders_sender on public.direct_orders(sender_id, created_at desc);
create index if not exists idx_direct_orders_partner on public.direct_orders(partner_id, created_at desc);

alter table public.direct_orders enable row level security;
revoke all on public.direct_orders from anon, authenticated;
grant select on public.direct_orders to authenticated;

drop policy if exists "Sender and partner can view direct order" on public.direct_orders;
drop policy if exists "Reviewers can view disputed direct orders" on public.direct_orders;

create policy "Sender and partner can view direct order"
  on public.direct_orders for select
  using (auth.uid() = sender_id or auth.uid() = partner_id);

create policy "Reviewers can view disputed direct orders"
  on public.direct_orders for select
  using (status in ('disputed', 'unpaid') and public.kyc_is_admin());

-- The OTP: only the sender can read it, to pass to the receiver.
create table if not exists public.direct_order_codes (
  order_id uuid references public.direct_orders(id) on delete cascade primary key,
  code text not null
);
alter table public.direct_order_codes enable row level security;
revoke all on public.direct_order_codes from anon, authenticated;
grant select on public.direct_order_codes to authenticated;

drop policy if exists "Sender can view direct order code" on public.direct_order_codes;
create policy "Sender can view direct order code"
  on public.direct_order_codes for select
  using (exists (select 1 from public.direct_orders o where o.id = order_id and o.sender_id = auth.uid()));

-- The account to pay, fixed when the partner accepts. The sender can only see it
-- once the cash has been handed over.
create table if not exists public.direct_order_payment (
  order_id uuid references public.direct_orders(id) on delete cascade primary key,
  account_name text not null,
  account_number text not null
);
alter table public.direct_order_payment enable row level security;
revoke all on public.direct_order_payment from anon, authenticated;
grant select on public.direct_order_payment to authenticated;

drop policy if exists "Parties can view payment details when due" on public.direct_order_payment;
create policy "Parties can view payment details when due"
  on public.direct_order_payment for select
  using (
    exists (
      select 1 from public.direct_orders o
      where o.id = order_id
        and (
          o.partner_id = auth.uid()
          or (o.sender_id = auth.uid() and o.status in ('delivered', 'paid', 'completed', 'disputed', 'unpaid'))
        )
    )
  );

-- Chat between the sender and the partner of one order
create table if not exists public.direct_order_messages (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.direct_orders(id) on delete cascade not null,
  author_id uuid references public.users(id) not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_direct_messages_order on public.direct_order_messages(order_id, created_at);

alter table public.direct_order_messages enable row level security;
revoke all on public.direct_order_messages from anon, authenticated;
grant select on public.direct_order_messages to authenticated;

drop policy if exists "Parties can read order messages" on public.direct_order_messages;
create policy "Parties can read order messages"
  on public.direct_order_messages for select
  using (
    exists (
      select 1 from public.direct_orders o
      where o.id = order_id and (o.sender_id = auth.uid() or o.partner_id = auth.uid())
    )
  );

-- 13c. Partner: payout accounts
create or replace function public.partner_set_payout_account(p_method text, p_account_name text, p_account_number text)
returns public.partner_payout_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_number text := regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g');
  v_row public.partner_payout_accounts;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if p_method is null or p_method not in ('gcash', 'gotyme', 'maya')
     or length(trim(coalesce(p_account_name, ''))) < 2
     or v_number !~ '^\+?[0-9]{7,20}$' then
    raise exception 'INVALID_ACCOUNT';
  end if;

  insert into public.partner_payout_accounts (user_id, method, account_name, account_number)
  values (v_uid, p_method, left(trim(p_account_name), 80), v_number)
  on conflict (user_id, method) do update
    set account_name = excluded.account_name, account_number = excluded.account_number, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.partner_remove_payout_account(p_method text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.partner_payout_accounts where user_id = auth.uid() and method = p_method;
$$;

-- 13d. Sender: who can deliver near this point?
-- Returns up to 5 available partners within 30 km, nearest first. Only a first
-- name, an area rounded to about 1 km, and which apps they accept are shared.
create or replace function public.direct_find_partners(p_lat double precision, p_lng double precision)
returns table (
  partner_id uuid,
  name text,
  lat double precision,
  lng double precision,
  distance_km double precision,
  methods text[],
  completed_orders integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    coalesce(nullif(split_part(trim(u.full_name), ' ', 1), ''), 'YTCash partner'),
    round(p.lat::numeric, 2)::double precision,
    round(p.lng::numeric, 2)::double precision,
    public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) as km,
    (select array_agg(a.method order by a.method) from public.partner_payout_accounts a where a.user_id = p.user_id),
    (select count(*)::integer from public.direct_orders o where o.partner_id = p.user_id and o.status = 'completed')
  from public.p2p_partners p
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and p_lat between -90 and 90 and p_lng between -180 and 180
    and p.is_available
    and p.user_id <> auth.uid()
    and exists (select 1 from public.partner_payout_accounts a where a.user_id = p.user_id)
    and public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) <= 30
  order by km asc, p.updated_at desc
  limit 5;
$$;

-- 13e. Sender: ask a partner to deliver
create or replace function public.direct_create_order(
  p_partner_id uuid,
  p_amount numeric,
  p_method text,
  p_receiver_name text,
  p_receiver_phone text,
  p_receiver_address text,
  p_lat double precision,
  p_lng double precision
)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_sender_name text;
  v_partner record;
  v_account public.partner_payout_accounts;
  v_order public.direct_orders;
begin
  if v_uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  perform public.kyc_require('p2p');

  select coalesce(nullif(split_part(trim(full_name), ' ', 1), ''), 'YTCash user') into v_sender_name
    from public.users where id = v_uid;
  if not found then
    raise exception 'PROFILE_MISSING';
  end if;

  -- A sender who still owes a partner cannot start another delivery.
  if exists (select 1 from public.direct_orders
             where sender_id = v_uid and status in ('disputed', 'unpaid')) then
    raise exception 'BLOCKED_UNPAID';
  end if;
  if exists (select 1 from public.direct_orders where sender_id = v_uid and status = 'delivered') then
    raise exception 'PAY_PREVIOUS_FIRST';
  end if;
  if (select count(*) from public.direct_orders
      where sender_id = v_uid and status in ('requested', 'accepted')) >= 3 then
    raise exception 'TOO_MANY_OPEN';
  end if;

  if v_amount is null or v_amount < 100 or v_amount > 50000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if length(trim(coalesce(p_receiver_name, ''))) < 2
     or length(trim(coalesce(p_receiver_phone, ''))) < 7
     or length(trim(coalesce(p_receiver_address, ''))) < 5
     or p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_RECEIVER';
  end if;

  select p.user_id,
         coalesce(nullif(split_part(trim(u.full_name), ' ', 1), ''), 'YTCash partner') as name,
         public.p2p_distance_km(p_lat, p_lng, p.lat, p.lng) as km
    into v_partner
    from public.p2p_partners p join public.users u on u.id = p.user_id
    where p.user_id = p_partner_id and p.is_available and p.user_id <> v_uid;
  if not found or v_partner.km > 30 then
    raise exception 'PARTNER_NOT_AVAILABLE';
  end if;
  select * into v_account from public.partner_payout_accounts
    where user_id = p_partner_id and method = p_method;
  if not found then
    raise exception 'METHOD_NOT_ACCEPTED';
  end if;

  insert into public.direct_orders
    (sender_id, partner_id, sender_name, partner_name, amount, method,
     receiver_name, receiver_phone, receiver_address, receiver_lat, receiver_lng, distance_km)
  values
    (v_uid, p_partner_id, v_sender_name, v_partner.name, v_amount, p_method,
     left(trim(p_receiver_name), 80), left(trim(p_receiver_phone), 30),
     left(trim(p_receiver_address), 300), p_lat, p_lng, round(v_partner.km::numeric, 2))
  returning * into v_order;

  insert into public.direct_order_codes (order_id, code)
  values (
    v_order.id,
    lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::int) % 1000000)::text, 6, '0')
  );
  insert into public.direct_order_payment (order_id, account_name, account_number)
  values (v_order.id, v_account.account_name, v_account.account_number);

  return v_order;
end;
$$;

-- 13f. Partner: accept or decline
create or replace function public.direct_accept_order(p_order_id uuid)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
  v_account public.partner_payout_accounts;
begin
  perform public.kyc_require('p2p');
  select * into v_order from public.direct_orders
    where id = p_order_id and partner_id = auth.uid() and status = 'requested'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  -- Fix the account to pay now, so it cannot change after the cash is handed over.
  select * into v_account from public.partner_payout_accounts
    where user_id = v_order.partner_id and method = v_order.method;
  if not found then
    raise exception 'METHOD_NOT_ACCEPTED';
  end if;
  update public.direct_order_payment
    set account_name = v_account.account_name, account_number = v_account.account_number
    where order_id = v_order.id;

  update public.direct_orders set status = 'accepted', accepted_at = now()
    where id = v_order.id
    returning * into v_order;
  return v_order;
end;
$$;

-- Partner declines a request, or gives up one they accepted but have not delivered.
create or replace function public.direct_decline_order(p_order_id uuid)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  update public.direct_orders set status = 'declined', closed_at = now()
    where id = p_order_id and partner_id = auth.uid() and status in ('requested', 'accepted')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Sender cancels before the cash is handed over.
create or replace function public.direct_cancel_order(p_order_id uuid)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  update public.direct_orders set status = 'cancelled', closed_at = now()
    where id = p_order_id and sender_id = auth.uid() and status in ('requested', 'accepted')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- 13g. Partner: confirm the hand-over with the receiver's OTP.
-- Returns { ok, reason?, attempts_left? } so a wrong attempt is still counted.
create or replace function public.direct_confirm_delivery(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
  v_code text;
  v_attempts integer;
begin
  select * into v_order from public.direct_orders
    where id = p_order_id and partner_id = auth.uid() and status = 'accepted'
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if v_order.failed_code_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'attempts_left', 0);
  end if;

  select code into v_code from public.direct_order_codes where order_id = v_order.id;
  if v_code is null or v_code <> trim(coalesce(p_code, '')) then
    update public.direct_orders set failed_code_attempts = failed_code_attempts + 1
      where id = v_order.id
      returning failed_code_attempts into v_attempts;
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_attempts >= 5 then 'locked' else 'wrong_code' end,
      'attempts_left', greatest(0, 5 - v_attempts)
    );
  end if;

  update public.direct_orders set status = 'delivered', delivered_at = now() where id = v_order.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 13h. Sender: "I have paid the partner" (also clears a non-payment report)
create or replace function public.direct_mark_paid(p_order_id uuid, p_reference text)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  if length(trim(coalesce(p_reference, ''))) < 4 then
    raise exception 'REFERENCE_REQUIRED';
  end if;
  update public.direct_orders
    set status = 'paid', paid_at = now(), payment_reference = left(trim(p_reference), 60)
    where id = p_order_id and sender_id = auth.uid() and status in ('delivered', 'disputed', 'unpaid')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: "I received the payment"
create or replace function public.direct_confirm_payment(p_order_id uuid)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  update public.direct_orders set status = 'completed', completed_at = now(), closed_at = now()
    where id = p_order_id and partner_id = auth.uid() and status in ('delivered', 'paid', 'disputed', 'unpaid')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- Partner: report that the sender has not paid. Allowed 30 minutes after the
-- hand-over, or 30 minutes after the sender claimed to have paid.
create or replace function public.direct_report_unpaid(p_order_id uuid)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  select * into v_order from public.direct_orders
    where id = p_order_id and partner_id = auth.uid() and status in ('delivered', 'paid')
    for update;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if coalesce(v_order.paid_at, v_order.delivered_at) > now() - interval '30 minutes' then
    raise exception 'TOO_EARLY';
  end if;
  update public.direct_orders set status = 'disputed' where id = v_order.id returning * into v_order;
  return v_order;
end;
$$;

-- Reviewer: settle a report. 'completed' clears the sender; 'unpaid' keeps them blocked.
create or replace function public.direct_resolve_dispute(p_order_id uuid, p_outcome text, p_note text default null)
returns public.direct_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.direct_orders;
begin
  if not public.kyc_is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_outcome is null or p_outcome not in ('completed', 'unpaid') then
    raise exception 'INVALID_OUTCOME';
  end if;
  update public.direct_orders
    set status = p_outcome,
        resolution_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
        completed_at = case when p_outcome = 'completed' then now() else completed_at end,
        closed_at = now()
    where id = p_order_id and status in ('disputed', 'unpaid')
    returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  return v_order;
end;
$$;

-- 13i. Chat
create or replace function public.direct_send_message(p_order_id uuid, p_body text)
returns public.direct_order_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
  v_row public.direct_order_messages;
begin
  if not exists (select 1 from public.direct_orders
                 where id = p_order_id and (sender_id = v_uid or partner_id = v_uid)) then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;
  if length(v_body) < 1 or length(v_body) > 500 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if (select count(*) from public.direct_order_messages
      where author_id = v_uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'TOO_MANY_MESSAGES';
  end if;
  insert into public.direct_order_messages (order_id, author_id, body)
  values (p_order_id, v_uid, v_body)
  returning * into v_row;
  return v_row;
end;
$$;

-- 13j. Who may call what
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.partner_set_payout_account(text, text, text)',
    'public.partner_remove_payout_account(text)',
    'public.direct_find_partners(double precision, double precision)',
    'public.direct_create_order(uuid, numeric, text, text, text, text, double precision, double precision)',
    'public.direct_accept_order(uuid)',
    'public.direct_decline_order(uuid)',
    'public.direct_cancel_order(uuid)',
    'public.direct_confirm_delivery(uuid, text)',
    'public.direct_mark_paid(uuid, text)',
    'public.direct_confirm_payment(uuid)',
    'public.direct_report_unpaid(uuid)',
    'public.direct_resolve_dispute(uuid, text, text)',
    'public.direct_send_message(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 13k. Live updates for orders and chat
do $$
declare
  t text;
begin
  foreach t in array array['direct_orders', 'direct_order_messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
