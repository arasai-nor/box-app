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
  geo_enabled           boolean not null default true,        -- atrašanās vietas pārbaude
  box_lat               double precision not null default 56.99029,  -- Viskaļu iela 22, Rīga
  box_lng               double precision not null default 24.18677,
  geo_radius_m          int not null default 250,             -- atļautais attālums no BOX (m)
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

-- Ziņojumi "BOX nav atbrīvots": nākamais lietotājs atrod svešu auto → iepriekšējā sesija tiek atvērta no jauna
create table if not exists public.reports (
  id                  bigserial primary key,
  session_id          bigint not null references public.sessions(id),
  reporter_id         uuid not null references public.profiles(id),
  note                text,
  prev_checked_out_at timestamptz not null,   -- sākotnējās vērtības (lai admins var ziņojumu noraidīt)
  prev_minutes        int,
  prev_billed_minutes int,
  prev_amount         numeric(8,2),
  prev_closed_by      uuid,
  status              text not null default 'open' check (status in ('open','resolved','rejected')),
  resolved_by         uuid references public.profiles(id),
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);

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

-- Atrašanās vietas pārbaude: attālums līdz BOX (haversine). Precizitātes pielaide līdz 100 m.
create or replace function public.geo_check(p_lat double precision, p_lng double precision, p_acc double precision)
returns void language plpgsql stable security definer set search_path = public as $$
declare s settings; d double precision;
begin
  select * into s from settings where id = 1;
  if not s.geo_enabled then return; end if;
  if p_lat is null or p_lng is null then
    raise exception 'Nav zināma tava atrašanās vieta — atļauj aplikācijai piekļuvi atrašanās vietai';
  end if;
  d := 2 * 6371000 * asin(sqrt(
         power(sin(radians(p_lat - s.box_lat) / 2), 2) +
         cos(radians(s.box_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - s.box_lng) / 2), 2)));
  if d > s.geo_radius_m + least(coalesce(p_acc, 0), 100) then
    raise exception 'Tu neesi pie BOX (attālums ~%, atļauts % m)',
      case when d >= 1000 then round((d / 1000)::numeric, 1) || ' km' else round(d::numeric) || ' m' end,
      s.geo_radius_m;
  end if;
end $$;

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
create or replace function public.check_in(p_code text, p_lat double precision default null,
  p_lng double precision default null, p_acc double precision default null) returns sessions
language plpgsql security definer set search_path = public as $$
declare s settings; b bookings; ses sessions;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts'; end if;
  select * into s from settings where id = 1;
  if upper(trim(p_code)) <> s.checkin_code then raise exception 'Nepareizs BOX kods'; end if;
  perform geo_check(p_lat, p_lng, p_acc);
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

-- Izčekoties (sava sesija — tikai pie BOX; admins var aizvērt jebkuru sesiju no jebkuras vietas)
create or replace function public.check_out(p_session bigint default null, p_lat double precision default null,
  p_lng double precision default null, p_acc double precision default null) returns sessions
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
  if ses.user_id = auth.uid() then perform geo_check(p_lat, p_lng, p_acc); end if;

  v_min  := greatest(1, ceil(extract(epoch from (now() - ses.checked_in_at)) / 60.0)::int);
  v_bill := greatest(v_min, s.min_minutes);

  update sessions set checked_out_at = now(), minutes = v_min, billed_minutes = v_bill,
         amount = round(v_bill / 60.0 * s.hourly_rate, 2),
         closed_by = case when user_id <> auth.uid() then auth.uid() end
   where id = ses.id returning * into ses;

  -- rezervācija: ja beidza agrāk → atbrīvo atlikušo laiku kalendārā
  update bookings set status = 'completed',
         ends_at = case when ends_at > now() then greatest(now(), starts_at + interval '1 second') else ends_at end
   where id = ses.booking_id;

  update reports set status = 'resolved', resolved_at = now() where session_id = ses.id and status = 'open';

  insert into device_events (device_id, event, payload)
  select id, 'checkout_hook', jsonb_build_object('session', ses.id) from devices where kind like 'shelly%' and enabled;

  return ses;
end $$;

-- BOX statuss (redz visi aktīvie)
create or replace function public.box_status()
returns table (session_id bigint, user_id uuid, full_name text, car text, checked_in_at timestamptz, booking_ends timestamptz,
               reported_by text, reported_at timestamptz)
language sql stable security definer set search_path = public as $$
  select se.id, se.user_id, p.full_name, p.car, se.checked_in_at, b.ends_at, rp.full_name, r.created_at
    from sessions se join profiles p on p.id = se.user_id
    left join bookings b on b.id = se.booking_id
    left join reports r on r.session_id = se.id and r.status = 'open'
    left join profiles rp on rp.id = r.reporter_id
   where se.checked_out_at is null and is_active();
$$;

-- Ziņot "BOX nav atbrīvots": pēdējā lietotāja sesija tiek atvērta no jauna, laiks skaitās no viņa iečekošanās brīža
create or replace function public.report_not_vacated(p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare ses sessions; p profiles;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts'; end if;
  perform geo_check(p_lat, p_lng, p_acc);
  if exists (select 1 from sessions where checked_out_at is null) then
    raise exception 'BOX šobrīd ir iečekots — ziņot nav vajadzības';
  end if;
  select * into ses from sessions order by checked_out_at desc limit 1;
  if not found then raise exception 'Nav neviena iepriekšējā lietotāja'; end if;
  if ses.user_id = auth.uid() then
    raise exception 'Pēdējais lietotājs esi tu pats — ja tavs auto vēl ir BOX, iečekojies no jauna';
  end if;
  if ses.checked_out_at < now() - interval '14 days' then
    raise exception 'Pēdējā lietošana bija pirms vairāk nekā 14 dienām — sazinies ar administratoru';
  end if;
  if exists (select 1 from ledger where user_id = ses.user_id and kind = 'usage'
              and period = date_trunc('month', ses.checked_out_at at time zone 'Europe/Riga')::date) then
    raise exception 'Šis mēnesis jau ir slēgts — sazinies ar administratoru';
  end if;
  if exists (select 1 from reports where session_id = ses.id and status = 'rejected') then
    raise exception 'Ziņojums par šo reizi jau tika noraidīts — sazinies ar administratoru';
  end if;

  insert into reports (session_id, reporter_id, note, prev_checked_out_at, prev_minutes, prev_billed_minutes, prev_amount, prev_closed_by)
  values (ses.id, auth.uid(), p_note, ses.checked_out_at, ses.minutes, ses.billed_minutes, ses.amount, ses.closed_by);
  update sessions set checked_out_at = null, minutes = null, billed_minutes = null, amount = null, closed_by = null
   where id = ses.id;

  select * into p from profiles where id = ses.user_id;
  return json_build_object('full_name', p.full_name, 'phone', p.phone, 'checked_in_at', ses.checked_in_at);
end $$;

-- Admins noraida ziņojumu: sesijai tiek atjaunots sākotnējais izčekošanās laiks un summa
create or replace function public.reject_report(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reports;
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  select * into r from reports where id = p_id;
  if not found then raise exception 'Ziņojums nav atrasts'; end if;
  if r.status = 'rejected' then raise exception 'Ziņojums jau ir noraidīts'; end if;
  update sessions set checked_out_at = r.prev_checked_out_at, minutes = r.prev_minutes,
         billed_minutes = r.prev_billed_minutes, amount = r.prev_amount, closed_by = r.prev_closed_by
   where id = r.session_id;
  update reports set status = 'rejected', resolved_by = auth.uid(), resolved_at = now() where id = p_id;
end $$;

-- Ziņojumu saraksts (admins)
create or replace function public.list_reports()
returns table (id bigint, created_at timestamptz, status text, note text, reporter_name text, user_name text,
               checked_in_at timestamptz, prev_checked_out_at timestamptz, prev_amount numeric)
language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, r.status, r.note, rp.full_name, up.full_name, se.checked_in_at, r.prev_checked_out_at, r.prev_amount
    from reports r join sessions se on se.id = r.session_id
    join profiles rp on rp.id = r.reporter_id join profiles up on up.id = se.user_id
   where is_admin() order by r.created_at desc limit 200;
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
   where checked_out_at >= v_from and checked_out_at < v_to
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
alter table public.reports       enable row level security;
alter table public.ledger        enable row level security;
alter table public.cash_entries  enable row level security;
alter table public.devices       enable row level security;
alter table public.device_events enable row level security;

-- settings: lasa aktīvie (bez koda!), maina admins
create policy settings_admin_all on public.settings for all using (is_admin()) with check (is_admin());
create or replace view public.public_settings with (security_invoker = false) as
  select hourly_rate, min_minutes, checkin_early_minutes, walkin_minutes, noshow_enabled, noshow_minutes,
         geo_enabled, geo_radius_m from settings;
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

-- reports: ziņotājs + admins (pārējais caur RPC)
create policy reports_select on public.reports for select using (reporter_id = auth.uid() or is_admin());
create policy reports_admin on public.reports for all using (is_admin()) with check (is_admin());

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
