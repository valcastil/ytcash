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

-- 4. RPC: Atomic balance update (prevents race conditions)
create or replace function public.update_balance(user_id uuid, delta numeric)
returns void
language plpgsql
security definer
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
    where id = p_order_id and partner_id = auth.uid() and status = 'matched'
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
    where id = p_order_id and partner_id = v_uid and status in ('matched', 'accepted')
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
    where id = p_order_id and sender_id = auth.uid() and status in ('matched', 'accepted')
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
    where id = p_order_id and partner_id = auth.uid() and status = 'accepted'
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
    where id = p_order_id and sender_id = auth.uid() and status = 'accepted'
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
