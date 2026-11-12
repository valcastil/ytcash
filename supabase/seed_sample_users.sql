-- ============================================================
-- YTCash: sample users for testing Send / transfers  (TEST PROJECTS ONLY)
-- Run in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/agsxwjunxrtubpjnfkri/sql/new
--
-- Security notes
-- * This is a one-shot DO block, not a function. Supabase exposes every function
--   in the public schema as an API endpoint, so a reusable seeding function would
--   let anyone with the app's public key create accounts with any balance.
-- * It only tops up the ONE account you name below, never other users.
-- * Never run this against a project that holds real money.
-- ============================================================

do $$
declare
  -- ▼ Set this to the email you sign in with (your Google account) ▼
  v_my_email   text    := 'YOUR_EMAIL@gmail.com';
  v_my_balance numeric := 10000.00;

  v_password text := 'Password123!';
  v_users jsonb := '[
    {"email":"maria.santos@gmail.com",   "phone":"+639171234567", "name":"Maria Santos",     "balance":2500},
    {"email":"juan.delacruz@gmail.com",  "phone":"+639185551234", "name":"Juan Dela Cruz",   "balance":5000},
    {"email":"carlos.mendoza@gmail.com", "phone":"+639208889999", "name":"Carlos Mendoza",   "balance":10000},
    {"email":"satoshi@bitcoin.org",      "phone":"+639992121212", "name":"Satoshi Nakamoto", "balance":210000}
  ]';
  v_u jsonb;
  v_uid uuid;
begin
  for v_u in select * from jsonb_array_elements(v_users) loop
    select id into v_uid from auth.users where lower(email) = lower(v_u->>'email');

    if v_uid is null then
      v_uid := gen_random_uuid();

      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        v_u->>'email', extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', v_u->>'name'),
        now(), now(), '', '', '', ''
      );

      -- Email identity, so the account can also sign in with email + password.
      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_uid, v_uid::text, 'email',
        jsonb_build_object('sub', v_uid::text, 'email', v_u->>'email', 'email_verified', true),
        now(), now(), now()
      );
    end if;

    -- The on_auth_user_created trigger creates the profile; fill in the test data.
    insert into public.users (id, email, phone, full_name, balance, kyc_verified)
    values (v_uid, v_u->>'email', v_u->>'phone', v_u->>'name', (v_u->>'balance')::numeric, true)
    on conflict (id) do update
      set phone = excluded.phone,
          full_name = excluded.full_name,
          balance = excluded.balance,
          kyc_verified = true;
  end loop;

  -- Top up only your own test wallet.
  update public.users set balance = v_my_balance where lower(email) = lower(v_my_email);
  if not found then
    raise notice 'No profile found for %, edit v_my_email at the top and re-run to top up your wallet.', v_my_email;
  end if;
end $$;

-- If an earlier version of this script was run, remove the function it left behind.
drop function if exists public.seed_test_user(text, text, text, text, numeric);
