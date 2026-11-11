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
