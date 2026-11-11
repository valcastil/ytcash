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
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
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
