-- =====================================================================
-- BOX aplikācija — Supabase datubāzes shēma (v1)
-- Palaist vienreiz: Supabase → SQL Editor → ielīmēt visu → Run
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Iestatījumi (viena rinda)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                    int primary key default 1 check (id = 1),
  hourly_rate           numeric(6,2) not null default 2.00,   -- € par stundu
  min_minutes           int not null default 60,              -- minimālā maksa (min)
  checkin_early_minutes int not null default 15,              -- cik agri drīkst iečekoties
  walkin_minutes        int not null default 60,              -- iečekošanās bez rezervācijas: cik BOX jābūt brīvam
  checkin_code          text not null default upper(substr(encode(gen_random_bytes(6),'hex'),1,6)),
  noshow_enabled        boolean not null default false,       -- 2. posms
  noshow_minutes        int not null default 30,              -- 2. posms
  updated_at            timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Lietotāji
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  phone      text,
  car        text,                                   -- auto marka / numurs
  role       text not null default 'member' check (role in ('admin','member')),
  active     boolean not null default false,         -- tikai aktīvi drīkst rezervēt
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  code       text primary key default upper(substr(encode(gen_random_bytes(6),'hex'),1,8)),
  note       text,                                   -- kam domāts, piem. "Roberts"
  created_by uuid references public.profiles(id),
  used_by    uuid references public.profiles(id),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Rezervācijas (pārklāšanās nav iespējama — DB līmenī)
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  note       text,
  status     text not null default 'active' check (status in ('active','cancelled','completed','noshow')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint bookings_no_overlap exclude using gist
    (tstzrange(starts_at, ends_at, '[)') with &&) where (status in ('active','completed'))
);

-- ---------------------------------------------------------------------
-- 4. Lietošanas sesijas (iečekošanās → izčekošanās)
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  id             bigserial primary key,
  user_id        uuid not null references public.profiles(id),
  booking_id     bigint references public.bookings(id),
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz,
  minutes        int,                 -- faktiskās minūtes
  billed_minutes int,                 -- ar minimumu (≥ 60)
  amount         numeric(8,2),        -- €
  closed_by      uuid references public.profiles(id),  -- ja izčekoja admins
  note           text
);
-- BOX ir viens → vienlaikus drīkst būt tikai viena atvērta sesija
create unique index if not exists sessions_one_open on public.sessions ((true)) where checked_out_at is null;

-- ---------------------------------------------------------------------
-- 5. Virtuālais konts (parāds BOX kasei)
--    amount > 0 → parāds pieaug (lietošana); amount < 0 → samazinās (darbs, nauda)
-- ---------------------------------------------------------------------
create table if not exists public.ledger (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id),
  kind        text not null check (kind in ('usage','work','cash','adjustment')),
  period      date,                          -- mēneša 1. datums (lietošanai)
  hours       numeric(8,2),
  amount      numeric(8,2) not null,
  description text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create unique index if not exists ledger_usage_once on public.ledger (user_id, period) where kind = 'usage';

-- ---------------------------------------------------------------------
-- 6. BOX kase (fiziskā skaidrā nauda un izdevumi)
-- ---------------------------------------------------------------------
create table if not exists public.cash_entries (
  id          bigserial primary key,
  entry_date  date not null default current_date,
  direction   text not null check (direction in ('in','out')),
  category    text not null,      -- iemaksa / elektrība / siltums / nodokļi / instrumenti / serviss / cits
  amount      numeric(8,2) not null check (amount > 0),
  description text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Iekārtas — REZERVĒTS 2./3. posmam (Shelly relejs, kameras). Tagad neaktīvas.
-- ---------------------------------------------------------------------
create table if not exists public.devices (
  id         bigserial primary key,
  kind       text not null check (kind in ('shelly_lift','shelly_door','camera')),
  name       text not null,
  location   text,
  config     jsonb not null default '{}'::jsonb,  -- IP, kanāls, stream URL u.c. (netiek rādīts lietotājiem)
  enabled    boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.device_events (
  id         bigserial primary key,
  device_id  bigint references public.devices(id),
  event      text not null,          -- 'power_on','power_off','person_detected','vehicle_detected' u.c.
  payload    jsonb,
  created_at timestamptz not null default now()
);
insert into public.devices (kind, name, location) values
  ('shelly_lift', 'Pacēlāja HOFMANN barošana', 'Elektrības sadalne'),
  ('camera',      'Kamera 1',                 'BOX kreisā puse'),
  ('camera',      'Kamera 2',                 'BOX labā puse')
on conflict do nothing;

-- =====================================================================
-- PALĪGFUNKCIJAS
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Jauns lietotājs: profils + ielūguma pārbaude. Pirmais lietotājs = admins.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code  text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code','')));
  v_first boolean := not exists (select 1 from profiles);
  v_ok    boolean := false;
begin
  if v_code <> '' then
    select true into v_ok from invites where code = v_code and used_by is null for update;
  end if;

  insert into profiles (id, full_name, phone, car, role, active)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), new.email),
          new.raw_user_meta_data->>'phone',
          new.raw_user_meta_data->>'car',
          case when v_first then 'admin' else 'member' end,
          v_first or coalesce(v_ok,false));

  if coalesce(v_ok,false) then
    update invites set used_by = new.id, used_at = now() where code = v_code;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- DARBĪBAS (RPC)
-- =====================================================================

-- Rezervēt
create or replace function public.create_booking(p_starts timestamptz, p_ends timestamptz, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts'; end if;
  if p_ends <= p_starts then raise exception 'Beigu laikam jābūt pēc sākuma'; end if;
  if p_starts < now() - interval '10 minutes' then raise exception 'Nevar rezervēt pagātnē'; end if;
  begin
    insert into bookings (user_id, starts_at, ends_at, note)
    values (auth.uid(), p_starts, p_ends, p_note) returning * into b;
  exception when exclusion_violation then
    raise exception 'Šis laiks jau ir aizņemts';
  end;
  return b;
end $$;

-- Atcelt (savu vai admins jebkuru); sākušos rezervāciju atcelt nevar, ja ir sesija
create or replace function public.cancel_booking(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_id;
  if not found then raise exception 'Rezervācija nav atrasta'; end if;
  if b.user_id <> auth.uid() and not is_admin() then raise exception 'Nav tiesību'; end if;
  if exists (select 1 from sessions where booking_id = p_id) then
    raise exception 'Rezervācija jau izmantota — izčekojies';
  end if;
  update bookings set status = 'cancelled' where id = p_id;
end $$;

-- Iečekoties ar QR kodu
create or replace function public.check_in(p_code text) returns sessions
language plpgsql security definer set search_path = public as $$
declare s settings; b bookings; ses sessions;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts'; end if;
  select * into s from settings where id = 1;
  if upper(trim(p_code)) <> s.checkin_code then raise exception 'Nepareizs BOX kods'; end if;
  if exists (select 1 from sessions where checked_out_at is null) then
    raise exception 'BOX šobrīd jau ir aizņemts';
  end if;

  -- 1) sava rezervācija, kas sākas tūlīt vai jau notiek
  select * into b from bookings
   where user_id = auth.uid() and status = 'active'
     and now() >= starts_at - make_interval(mins => s.checkin_early_minutes)
     and now() < ends_at
   order by starts_at limit 1;

  if found then
    if b.starts_at > now() then  -- agrāk ieradies → pavelk sākumu, ja brīvs
      begin
        update bookings set starts_at = now() where id = b.id;
      exception when exclusion_violation then null; end;
    end if;
  else
    -- 2) bez rezervācijas: drīkst, ja BOX brīvs nākamās walkin_minutes
    begin
      insert into bookings (user_id, starts_at, ends_at, note)
      values (auth.uid(), now(), now() + make_interval(mins => s.walkin_minutes), 'Iečekošanās bez rezervācijas')
      returning * into b;
    exception when exclusion_violation then
      raise exception 'BOX tuvākajā laikā ir rezervēts citam — rezervē brīvu laiku kalendārā';
    end;
  end if;

  insert into sessions (user_id, booking_id) values (auth.uid(), b.id) returning * into ses;

  -- 2. posms: šeit ieslēgs Shelly releju (devices.enabled = true)
  insert into device_events (device_id, event, payload)
  select id, 'checkin_hook', jsonb_build_object('session', ses.id) from devices where kind like 'shelly%' and enabled;

  return ses;
end $$;

-- Izčekoties (sava sesija; admins var aizvērt jebkuru)
create or replace function public.check_out(p_session bigint default null) returns sessions
language plpgsql security definer set search_path = public as $$
declare s settings; ses sessions; v_min int; v_bill int;
begin
  select * into s from settings where id = 1;
  if p_session is null then
    select * into ses from sessions where user_id = auth.uid() and checked_out_at is null;
  else
    select * into ses from sessions where id = p_session and checked_out_at is null;
    if found and ses.user_id <> auth.uid() and not is_admin() then raise exception 'Nav tiesību'; end if;
  end if;
  if not found then raise exception 'Nav atvērtas sesijas'; end if;

  v_min  := greatest(1, ceil(extract(epoch from (now() - ses.checked_in_at)) / 60.0)::int);
  v_bill := greatest(v_min, s.min_minutes);

  update sessions set checked_out_at = now(), minutes = v_min, billed_minutes = v_bill,
         amount = round(v_bill / 60.0 * s.hourly_rate, 2),
         closed_by = case when user_id <> auth.uid() then auth.uid() end
   where id = ses.id returning * into ses;

  -- rezervācija: ja beidza agrāk → atbrīvo atlikušo laiku kalendārā
  update bookings set status = 'completed',
         ends_at = case when ends_at > now() then greatest(now(), starts_at + interval '1 minute') else ends_at end
   where id = ses.booking_id;

  insert into device_events (device_id, event, payload)
  select id, 'checkout_hook', jsonb_build_object('session', ses.id) from devices where kind like 'shelly%' and enabled;

  return ses;
end $$;

-- BOX statuss (redz visi aktīvie)
create or replace function public.box_status()
returns table (session_id bigint, user_id uuid, full_name text, car text, checked_in_at timestamptz, booking_ends timestamptz)
language sql stable security definer set search_path = public as $$
  select se.id, se.user_id, p.full_name, p.car, se.checked_in_at, b.ends_at
    from sessions se join profiles p on p.id = se.user_id
    left join bookings b on b.id = se.booking_id
   where se.checked_out_at is null and is_active();
$$;

-- Mēneša slēgšana: sesijas → virtuālais konts (vienreiz uz mēnesi)
create or replace function public.close_month(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz; n int;
begin
  if auth.uid() is not null and not is_admin() then raise exception 'Nav tiesību'; end if;
  v_from := (date_trunc('month', p_month)::date)::timestamp at time zone 'Europe/Riga';
  v_to   := ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone 'Europe/Riga';
  insert into ledger (user_id, kind, period, hours, amount, description, created_by)
  select user_id, 'usage', date_trunc('month', p_month)::date,
         round(sum(billed_minutes)/60.0, 2), sum(amount),
         'BOX lietošana ' || to_char(p_month, 'YYYY-MM') || ' (' || count(*) || ' reizes)',
         auth.uid()
    from sessions
   where checked_out_at is not null and checked_in_at >= v_from and checked_in_at < v_to
   group by user_id
  on conflict (user_id, period) where kind = 'usage' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Norēķins: darbs vai skaidra nauda (tikai admins)
create or replace function public.record_payment(p_user uuid, p_kind text, p_amount numeric, p_description text, p_hours numeric default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if p_kind not in ('work','cash','adjustment') then raise exception 'Nepareizs veids'; end if;
  if p_amount = 0 then raise exception 'Summa nevar būt 0'; end if;
  insert into ledger (user_id, kind, hours, amount, description, created_by)
  values (p_user, p_kind, p_hours,
          case when p_kind = 'adjustment' then p_amount else -abs(p_amount) end,
          p_description, auth.uid());
  if p_kind = 'cash' then
    insert into cash_entries (direction, category, amount, description, created_by)
    values ('in', 'iemaksa', abs(p_amount), coalesce(p_description, 'Iemaksa'), auth.uid());
  end if;
end $$;

-- Atlikumi visiem (admins) — parāds = uzkrātie slēgtie mēneši − samaksātais
create or replace function public.balances()
returns table (user_id uuid, full_name text, balance numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, coalesce(sum(l.amount),0)
    from profiles p left join ledger l on l.user_id = p.id
   where is_admin() or p.id = auth.uid()
   group by p.id, p.full_name order by p.full_name;
$$;

-- =====================================================================
-- RINDU LĪMEŅA DROŠĪBA (RLS)
-- =====================================================================
alter table public.settings      enable row level security;
alter table public.profiles      enable row level security;
alter table public.invites       enable row level security;
alter table public.bookings      enable row level security;
alter table public.sessions      enable row level security;
alter table public.ledger        enable row level security;
alter table public.cash_entries  enable row level security;
alter table public.devices       enable row level security;
alter table public.device_events enable row level security;

-- settings: lasa aktīvie (bez koda!), maina admins
create policy settings_admin_all on public.settings for all using (is_admin()) with check (is_admin());
create or replace view public.public_settings with (security_invoker = false) as
  select hourly_rate, min_minutes, checkin_early_minutes, walkin_minutes, noshow_enabled, noshow_minutes from settings;
grant select on public.public_settings to authenticated;

-- profiles: savu redz vienmēr; aktīvie redz citu vārdus; savu var labot (bez role/active)
create policy profiles_select on public.profiles for select using (id = auth.uid() or is_active());
create policy profiles_update_self on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())
                               and active = (select active from profiles where id = auth.uid()));
create policy profiles_admin on public.profiles for all using (is_admin()) with check (is_admin());

create policy invites_admin on public.invites for all using (is_admin()) with check (is_admin());

-- bookings: visi aktīvie redz kalendāru; izveide/atcelšana tikai caur RPC
create policy bookings_select on public.bookings for select using (is_active());
create policy bookings_admin on public.bookings for all using (is_admin()) with check (is_admin());

-- sessions: savas + admins
create policy sessions_select on public.sessions for select using (user_id = auth.uid() or is_admin());
create policy sessions_admin on public.sessions for all using (is_admin()) with check (is_admin());

-- ledger: savs + admins
create policy ledger_select on public.ledger for select using (user_id = auth.uid() or is_admin());
create policy ledger_admin on public.ledger for all using (is_admin()) with check (is_admin());

-- kase: caurspīdīga visiem aktīvajiem; raksta admins
create policy cash_select on public.cash_entries for select using (is_active());
create policy cash_admin on public.cash_entries for all using (is_admin()) with check (is_admin());

-- iekārtas: tikai admins (config satur IP/paroles)
create policy devices_admin on public.devices for all using (is_admin()) with check (is_admin());
create policy device_events_admin on public.device_events for all using (is_admin()) with check (is_admin());

-- =====================================================================
-- AUTOMĀTISKĀ MĒNEŠA SLĒGŠANA — katra mēneša 1. datumā 03:05 (Rīgas laiks ≈ 01:05 UTC)
-- (Supabase: Database → Extensions → ieslēgt pg_cron, tad palaist šo bloku)
-- =====================================================================
-- create extension if not exists pg_cron;
-- select cron.schedule('box-close-month', '5 1 1 * *',
--   $$ select public.close_month((date_trunc('month', now() at time zone 'Europe/Riga') - interval '1 month')::date) $$);
