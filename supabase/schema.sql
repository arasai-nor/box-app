-- =====================================================================
-- BOX aplikācija — Supabase datubāzes shēma (v1)
-- Palaist vienreiz: Supabase → SQL Editor → ielīmēt visu → Run
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. Iestatījumi (viena rinda)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                    int primary key default 1 check (id = 1),
  hourly_rate           numeric(6,2) not null default 2.00,   -- € par stundu
  min_minutes           int not null default 60,              -- minimālā maksa (min)
  checkin_early_minutes int not null default 15,              -- cik agri drīkst iečekoties
  walkin_minutes        int not null default 60,              -- iečekošanās bez rezervācijas: cik BOX jābūt brīvam
  checkin_code          text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  noshow_enabled        boolean not null default false,       -- 2. posms
  noshow_minutes        int not null default 30,              -- 2. posms
  geo_enabled           boolean not null default true,        -- atrašanās vietas pārbaude
  box_lat               double precision not null default 56.990484, -- BOX, Viskaļu iela 22, Rīga
  box_lng               double precision not null default 24.185431,
  geo_radius_m          int not null default 250,             -- atļautais attālums no BOX (m)
  bill_step_minutes     int not null default 30,              -- aprēķina solis pēc minimuma (0 = pa minūtēm)
  bill_round_down_minutes int not null default 15,            -- atlikumu līdz šim (ieskaitot) noapaļo uz leju, vairāk — uz augšu
  photo_required        boolean not null default true,        -- izčekojoties obligāts BOX foto
  max_active_bookings   int not null default 2,               -- cik nākotnes rezervāciju drīkst būt vienam (0 = bez limita)
  debt_warn_eur         numeric(8,2) not null default 30,     -- atgādinājums dalībniekam, ja uzkrāts vismaz tik (0 = nav)
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
  removed_at timestamptz,                            -- izslēgts no BOX (dalība beigusies); vēsture un atlikums saglabājas
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  code       text primary key default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  note       text,                                   -- kam domāts, piem. "Roberts"
  phone      text,                                   -- telefons ielūguma nosūtīšanai (nav obligāts)
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
  billed_minutes int,                 -- aprēķina minūtes: minimums 60, tālāk pa 30 min (sk. bill_minutes)
  amount         numeric(8,2),        -- €
  closed_by      uuid references public.profiles(id),  -- ja izčekoja admins
  photo_path     text,                -- BOX foto izčekojoties (Storage: checkout/<lietotājs>/<fails>.jpg)
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
  kind        text not null check (kind in ('usage','work','cash','adjustment','hold')),
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
-- 6a. BOX noteikumi: versijas un apstiprinājumi (kurš, kuru versiju, kad)
-- ---------------------------------------------------------------------
create table if not exists public.rules_versions (
  version      int primary key,
  body         text not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id)
);
create table if not exists public.rule_acceptances (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  version     int not null references public.rules_versions(version),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
insert into public.rules_versions (version, body) values (1, $rules$1. BOX lieto tikai ar rezervāciju aplikācijā. Ja BOX ir brīvs, var iečekoties arī bez rezervācijas. Vienam dalībniekam vienlaikus var būt ne vairāk kā 2 rezervācijas.
2. IEČEKOŠANĀS — ar QR kodu. Sākot darbu, aplikācijā noskenē QR kodu, kas piestiprināts BOX iekšpusē. To var izdarīt tikai uz vietas.
3. IZČEKOŠANĀS — ar fotogrāfiju. Kad auto ir izbraukts un BOX ir tukšs un sakopts, aplikācijā nofotografē BOX telpu. Tiklīdz foto ir uzņemts, izčekošanās notiek automātiski. Bez foto izčekoties nevar.
4. Foto redz admins un nākamais lietotājs — lai būtu skaidrs, kādā kārtībā un tīrībā BOX ir atstāts. Fotografē pats, uz vietas, ar aplikācijas kameru. Cita atsūtītu bildi izmantot nevar.
5. Maksa ir 2 € stundā. Mazākā maksa ir par 1 stundu, tālāk laiku skaita pa 30 minūtēm: līdz 15 minūtēm noapaļo uz leju, vairāk — uz augšu. Piemēri: 1 h 15 min = 1 h; 1 h 20 min = 1 h 30 min; 1 h 47 min = 2 h.
6. Ja aizbrauc neizčekojies, laiks turpina skaitīties, un tas izmaksās dārgi. Atgriezies un nofotografē tukšu BOX vai uzreiz sazinies ar adminu. Aplikācijas brīdinājums ir tikai palīgs — par izčekošanos atbild pats lietotājs.
7. Ja atrodi BOX aizņemtu ar cita auto, nospied "BOX nav atbrīvots". Iepriekšējam lietotājam laiks tiks skaitīts tālāk.
8. Ja BOX vajag ilgāk nekā parasti (avārija, sarežģīts remonts), sarunā to ar adminu. Admins uzliek HOLD, un to redz visi.
9. Ja kaut kas ir salūzis vai trūkst, uzreiz ziņo par to aplikācijā.
10. Katra mēneša 1. datumā tiek saskaitīts, cik katrs ir lietojis. Savu uzkrāto summu katrs redz aplikācijā.
11. Uzkrāto summu dzēš ar papildu darbiem ārpus darba laika (piemēram, granulu papildināšana, lapu vai sniega tīrīšana) vai ar naudu. Par katru darbu un tā summu iepriekš vienojas ar adminu.
12. Ja uzkrāto summu nenokārto, admins var slēgt piekļuvi BOX.
13. Nauda tiek tērēta tikai BOX uzturēšanai un instrumentiem. Kasi redz visi.
14. Pacēlāju lieto tikai tas, kurš prot ar to droši strādāt. Par savu drošību un nodarītiem bojājumiem atbild pats lietotājs.
15. BOX kodu nedod citiem. BOX lieto tikai grupas dalībnieki.
16. Strīdus izšķir admins. Par noteikumu pārkāpšanu admins var slēgt piekļuvi.$rules$)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6b. HOLD: admins aptur BOX konkrētam lietotājam (avārija, ilgs remonts). Vienlaikus tikai viens.
-- ---------------------------------------------------------------------
create table if not exists public.holds (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id),
  starts_at    timestamptz not null default now(),
  expected_end timestamptz not null,          -- aptuvenais beigu laiks (vienošanās ar adminu)
  ended_at     timestamptz,
  reason       text,
  amount       numeric(8,2),                  -- summa, par ko vienojās; admins ieraksta, beidzot HOLD
  created_by   uuid references public.profiles(id),
  ended_by     uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  check (expected_end > starts_at)
);
create unique index if not exists holds_one_open on public.holds ((true)) where ended_at is null;

-- ---------------------------------------------------------------------
-- 7. Iekārtas — REZERVĒTS 2./3. posmam (Shelly relejs, kameras). Tagad neaktīvas.
-- ---------------------------------------------------------------------
create table if not exists public.issues (            -- bojājumu un trūkumu žurnāls
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references public.profiles(id),
  body        text not null check (char_length(trim(body)) between 3 and 300),
  status      text not null default 'open' check (status in ('open','done')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution  text
);

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
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active)
     and exists (select 1 from rule_acceptances a where a.user_id = auth.uid()
                  and a.version = (select max(version) from rules_versions));
$$;

-- Noteikumi: jaunākā versija + vai es to esmu apstiprinājis
create or replace function public.current_rules()
returns table (version int, body text, published_at timestamptz, accepted boolean, accepted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.version, r.body, r.published_at, a.user_id is not null, a.accepted_at
    from rules_versions r
    left join rule_acceptances a on a.version = r.version and a.user_id = auth.uid()
   where auth.uid() is not null
   order by r.version desc limit 1;
$$;

create or replace function public.accept_rules(p_version int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and active) then
    raise exception 'Konts nav aktivizēts';
  end if;
  if p_version is distinct from (select max(version) from rules_versions) then
    raise exception 'Noteikumi ir mainīti — atver aplikāciju no jauna';
  end if;
  insert into rule_acceptances (user_id, version) values (auth.uid(), p_version) on conflict do nothing;
end $$;

-- Admins publicē jaunu noteikumu versiju: visiem (arī adminam) tā jāapstiprina no jauna
create or replace function public.publish_rules(p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if length(trim(coalesce(p_body, ''))) < 20 then raise exception 'Noteikumu teksts ir par īsu'; end if;
  select coalesce(max(version), 0) + 1 into v from rules_versions;
  insert into rules_versions (version, body, published_by) values (v, trim(p_body), auth.uid());
  return v;
end $$;

create or replace function public.list_rule_acceptances()
returns table (user_id uuid, full_name text, accepted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, a.accepted_at
    from profiles p
    left join rule_acceptances a on a.user_id = p.id and a.version = (select max(version) from rules_versions)
   where is_admin() and p.active
   order by p.full_name;
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

-- Aprēķina minūtes: minimums (60), tālāk pa soļiem (30); atlikumu līdz 15 min noapaļo uz leju, vairāk — uz augšu.
-- 75 → 60, 80 → 90, 104 → 90, 107 → 120.
create or replace function public.bill_minutes(p_min int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(s.min_minutes,
    case when s.bill_step_minutes <= 0 then p_min
         when p_min % s.bill_step_minutes <= s.bill_round_down_minutes then p_min - p_min % s.bill_step_minutes
         else p_min - p_min % s.bill_step_minutes + s.bill_step_minutes end)
    from settings s where s.id = 1;
$$;

-- Rezervēt
create or replace function public.create_booking(p_starts timestamptz, p_ends timestamptz, p_note text default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare b bookings; v_lim int;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts vai nav apstiprināti BOX noteikumi'; end if;
  if p_ends <= p_starts then raise exception 'Beigu laikam jābūt pēc sākuma'; end if;
  if p_starts < now() - interval '10 minutes' then raise exception 'Nevar rezervēt pagātnē'; end if;
  if exists (select 1 from holds where ended_at is null
              and p_starts < greatest(expected_end, now()) and p_ends > starts_at) then
    raise exception 'Šajā laikā BOX ir uz HOLD — rezervē laiku pēc tā';
  end if;
  select max_active_bookings into v_lim from settings where id = 1;
  if v_lim > 0 and (select count(*) from bookings bk where bk.user_id = auth.uid() and bk.status = 'active' and bk.ends_at > now()
                      and not exists (select 1 from sessions se where se.booking_id = bk.id)) >= v_lim then
    raise exception 'Tev jau ir % aktīvas rezervācijas — vispirms izmanto vai atcel kādu no tām', v_lim;
  end if;
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
  if not is_active() then raise exception 'Konts nav aktivizēts vai nav apstiprināti BOX noteikumi'; end if;
  select * into s from settings where id = 1;
  if upper(trim(p_code)) <> s.checkin_code then raise exception 'Nepareizs BOX kods'; end if;
  perform geo_check(p_lat, p_lng, p_acc);
  if exists (select 1 from holds where ended_at is null) then
    raise exception 'BOX ir uz HOLD — iečekoties nevar';
  end if;
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

-- Izčekoties (sava sesija — tikai pie BOX un ar BOX foto; admins var aizvērt cita sesiju no jebkuras vietas bez foto)
create or replace function public.check_out(p_session bigint default null, p_lat double precision default null,
  p_lng double precision default null, p_acc double precision default null, p_photo text default null) returns sessions
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
  if ses.user_id = auth.uid() then
    perform geo_check(p_lat, p_lng, p_acc);
    if s.photo_required then
      if coalesce(p_photo, '') = '' or split_part(p_photo, '/', 1) <> auth.uid()::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'checkout' and o.name = p_photo) then
        raise exception 'Vispirms nofotografē sakoptu BOX — bez foto izčekoties nevar';
      end if;
    end if;
  end if;

  v_min  := greatest(1, floor(extract(epoch from (now() - ses.checked_in_at)) / 60.0)::int);
  v_bill := bill_minutes(v_min);

  update sessions set checked_out_at = now(), minutes = v_min, billed_minutes = v_bill,
         amount = round(v_bill / 60.0 * s.hourly_rate, 2),
         closed_by = case when user_id <> auth.uid() then auth.uid() end,
         photo_path = case when user_id = auth.uid() then nullif(p_photo, '') end
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

-- Pēdējā pabeigtā lietošana un tās foto — nākamais lietotājs redz, kādu BOX atstāja iepriekšējais
create or replace function public.last_checkout()
returns table (session_id bigint, user_id uuid, full_name text, checked_out_at timestamptz, photo_path text, by_admin boolean)
language sql stable security definer set search_path = public as $$
  select se.id, se.user_id, p.full_name, se.checked_out_at, se.photo_path, se.closed_by is not null
    from sessions se join profiles p on p.id = se.user_id
   where se.checked_out_at is not null and is_active()
   order by se.checked_out_at desc limit 1;
$$;

-- Ziņot "BOX nav atbrīvots": pēdējā lietotāja sesija tiek atvērta no jauna, laiks skaitās no viņa iečekošanās brīža
create or replace function public.report_not_vacated(p_lat double precision default null, p_lng double precision default null,
  p_acc double precision default null, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare ses sessions; p profiles;
begin
  if not is_active() then raise exception 'Konts nav aktivizēts vai nav apstiprināti BOX noteikumi'; end if;
  perform geo_check(p_lat, p_lng, p_acc);
  if exists (select 1 from holds where ended_at is null) then
    raise exception 'BOX ir uz HOLD — ziņot nav vajadzības';
  end if;
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

-- Admins izslēdz dalībnieku no BOX (piem., mainījis darbavietu). Vēsture un atlikums saglabājas, nākotnes rezervācijas tiek atceltas.
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if p_user = auth.uid() then raise exception 'Sevi izslēgt nevar'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Dalībnieks nav atrasts'; end if;
  if exists (select 1 from sessions where user_id = p_user and checked_out_at is null) then
    raise exception 'Dalībnieks šobrīd ir iečekots BOX — vispirms izčeko viņu';
  end if;
  if exists (select 1 from holds where user_id = p_user and ended_at is null) then
    raise exception 'Dalībniekam ir aktīvs HOLD — vispirms beidz to';
  end if;
  update bookings set status = 'cancelled', note = trim(coalesce(note, '') || ' (atcelts: dalība beigusies)')
   where user_id = p_user and status = 'active';
  update profiles set active = false, role = 'member', removed_at = now() where id = p_user;
end $$;

create or replace function public.restore_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  update profiles set active = true, removed_at = null where id = p_user and removed_at is not null;
  if not found then raise exception 'Dalībnieks nav izslēgts'; end if;
end $$;

-- HOLD: redz visi aktīvie lietotāji
create or replace function public.box_hold()
returns table (id bigint, user_id uuid, full_name text, phone text, starts_at timestamptz, expected_end timestamptz, reason text)
language sql stable security definer set search_path = public as $$
  select h.id, h.user_id, p.full_name, p.phone, h.starts_at, h.expected_end, h.reason
    from holds h join profiles p on p.id = h.user_id
   where h.ended_at is null and is_active();
$$;

-- Admins uzliek HOLD. Ja lietotājs pats ir iečekots, viņa sesija tiek noslēgta (parastā maksa līdz šim brīdim).
-- Citu lietotāju rezervācijas HOLD laikā tiek atceltas.
create or replace function public.start_hold(p_user uuid, p_expected_end timestamptz, p_reason text default null)
returns holds language plpgsql security definer set search_path = public as $$
declare ses sessions; s settings; h holds; v_min int; v_bill int;
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if p_expected_end <= now() then raise exception 'Beigu laikam jābūt nākotnē'; end if;
  if not exists (select 1 from profiles where id = p_user and active) then raise exception 'Lietotājs nav atrasts'; end if;
  if exists (select 1 from holds where ended_at is null) then
    raise exception 'HOLD jau ir aktīvs — vispirms beidz esošo';
  end if;
  select * into s from settings where id = 1;
  select * into ses from sessions where checked_out_at is null;
  if found then
    if ses.user_id <> p_user then
      raise exception 'BOX šobrīd lieto cits lietotājs — vispirms izčeko viņu';
    end if;
    v_min  := greatest(1, floor(extract(epoch from (now() - ses.checked_in_at)) / 60.0)::int);
    v_bill := bill_minutes(v_min);
    update sessions set checked_out_at = now(), minutes = v_min, billed_minutes = v_bill,
           amount = round(v_bill / 60.0 * s.hourly_rate, 2), closed_by = auth.uid(), note = 'Noslēgts, uzliekot HOLD'
     where id = ses.id;
    update bookings set status = 'completed',
           ends_at = case when ends_at > now() then greatest(now(), starts_at + interval '1 second') else ends_at end
     where id = ses.booking_id;
    update reports set status = 'resolved', resolved_at = now() where session_id = ses.id and status = 'open';
  end if;
  update bookings set status = 'cancelled', note = trim(coalesce(note, '') || ' (atcelts: HOLD)')
   where status = 'active' and starts_at < p_expected_end and ends_at > now();
  insert into holds (user_id, expected_end, reason, created_by)
  values (p_user, p_expected_end, nullif(trim(coalesce(p_reason, '')), ''), auth.uid()) returning * into h;
  return h;
end $$;

-- Admins maina HOLD aptuveno beigu laiku vai iemeslu
create or replace function public.update_hold(p_id bigint, p_expected_end timestamptz, p_reason text default null)
returns holds language plpgsql security definer set search_path = public as $$
declare h holds;
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if p_expected_end <= now() then raise exception 'Beigu laikam jābūt nākotnē'; end if;
  update holds set expected_end = p_expected_end, reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), reason)
   where id = p_id and ended_at is null returning * into h;
  if not found then raise exception 'HOLD nav atrasts vai jau ir beidzies'; end if;
  update bookings set status = 'cancelled', note = trim(coalesce(note, '') || ' (atcelts: HOLD)')
   where status = 'active' and starts_at < p_expected_end and ends_at > now();
  return h;
end $$;

-- Admins beidz HOLD un ieraksta summu, par ko vienojās (0 = bez maksas). Summa nonāk lietotāja kontā.
create or replace function public.end_hold(p_id bigint, p_amount numeric default 0, p_note text default null)
returns holds language plpgsql security definer set search_path = public as $$
declare h holds;
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Summa nevar būt negatīva'; end if;
  update holds set ended_at = now(), ended_by = auth.uid(), amount = coalesce(p_amount, 0)
   where id = p_id and ended_at is null returning * into h;
  if not found then raise exception 'HOLD nav atrasts vai jau ir beidzies'; end if;
  if coalesce(p_amount, 0) > 0 then
    insert into ledger (user_id, kind, amount, description, created_by)
    values (h.user_id, 'hold', p_amount,
            'HOLD ' || to_char(h.starts_at at time zone 'Europe/Riga', 'DD.MM.') || '–' ||
            to_char(now() at time zone 'Europe/Riga', 'DD.MM.YYYY') ||
            coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ': ' || h.reason, ''),
            auth.uid());
  end if;
  return h;
end $$;

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

-- Uzkrājumi: balance = konta kustība (slēgtie mēneši − nokārtotais); pending = lietošana, kas vēl nav pārnesta uz kontu
-- (mēnesis nav slēgts). Kopā uzkrāts = balance + pending. Dalībnieks redz tikai savu, admins — visus.
create or replace function public.balances()
returns table (user_id uuid, full_name text, balance numeric, pending numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name,
         coalesce((select sum(l.amount) from ledger l where l.user_id = p.id), 0),
         coalesce((select sum(se.amount) from sessions se
                    where se.user_id = p.id and se.checked_out_at is not null
                      and not exists (select 1 from ledger l where l.user_id = p.id and l.kind = 'usage'
                            and l.period = date_trunc('month', se.checked_out_at at time zone 'Europe/Riga')::date)), 0)
    from profiles p
   where is_admin() or p.id = auth.uid()
   order by p.full_name;
$$;

-- Admins atzīmē bojājumu kā atrisinātu
create or replace function public.resolve_issue(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Nav tiesību'; end if;
  update issues set status = 'done', resolved_at = now(), resolved_by = auth.uid(), resolution = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id and status = 'open';
  if not found then raise exception 'Ieraksts nav atrasts'; end if;
end $$;

-- =====================================================================
-- RINDU LĪMEŅA DROŠĪBA (RLS)
-- =====================================================================
alter table public.settings      enable row level security;
alter table public.profiles      enable row level security;
alter table public.invites       enable row level security;
alter table public.bookings      enable row level security;
alter table public.sessions      enable row level security;
alter table public.reports       enable row level security;
alter table public.rules_versions   enable row level security;
alter table public.rule_acceptances enable row level security;
alter table public.holds            enable row level security;
alter table public.ledger        enable row level security;
alter table public.cash_entries  enable row level security;
alter table public.issues        enable row level security;
alter table public.devices       enable row level security;
alter table public.device_events enable row level security;

-- settings: lasa aktīvie (bez koda!), maina admins
create policy settings_admin_all on public.settings for all using (is_admin()) with check (is_admin());
create or replace view public.public_settings with (security_invoker = false) as
  select hourly_rate, min_minutes, checkin_early_minutes, walkin_minutes, noshow_enabled, noshow_minutes,
         geo_enabled, geo_radius_m, box_lat, box_lng,
         bill_step_minutes, bill_round_down_minutes, photo_required, max_active_bookings, debt_warn_eur from settings;
grant select on public.public_settings to authenticated;

-- profiles: savu redz vienmēr; aktīvie redz citu vārdus; savu var labot (bez role/active)
create policy profiles_select on public.profiles for select using (id = auth.uid() or is_active());
create policy profiles_update_self on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())
                               and active = (select active from profiles where id = auth.uid())
                               and removed_at is not distinct from (select removed_at from profiles where id = auth.uid()));
create policy profiles_admin on public.profiles for all using (is_admin()) with check (is_admin());

create policy invites_admin on public.invites for all using (is_admin()) with check (is_admin());

-- bookings: visi aktīvie redz kalendāru; izveide/atcelšana tikai caur RPC
create policy bookings_select on public.bookings for select using (is_active());
create policy bookings_admin on public.bookings for all using (is_admin()) with check (is_admin());

-- sessions: savas + admins
create policy sessions_select on public.sessions for select using (user_id = auth.uid() or is_admin());
create policy sessions_admin on public.sessions for all using (is_admin()) with check (is_admin());

-- noteikumi: tekstu lasa katrs ielogojies lietotājs; apstiprinājumus redz pats lietotājs un admins
create policy rules_select on public.rules_versions for select using (auth.uid() is not null);
create policy rules_admin on public.rules_versions for all using (is_admin()) with check (is_admin());
create policy acceptances_select on public.rule_acceptances for select using (user_id = auth.uid() or is_admin());
create policy acceptances_admin on public.rule_acceptances for all using (is_admin()) with check (is_admin());

-- HOLD: redz visi aktīvie; maina tikai admins (caur RPC)
create policy holds_select on public.holds for select using (is_active());
create policy holds_admin on public.holds for all using (is_admin()) with check (is_admin());

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
-- issues: redz un pievieno aktīvie dalībnieki; labo admins
create policy issues_select on public.issues for select using (is_active());
create policy issues_insert on public.issues for insert with check (user_id = auth.uid() and is_active() and status = 'open');
create policy issues_admin on public.issues for all using (is_admin()) with check (is_admin());

create policy devices_admin on public.devices for all using (is_admin()) with check (is_admin());
create policy device_events_admin on public.device_events for all using (is_admin()) with check (is_admin());

-- =====================================================================
-- PIEKĻUVES TIESĪBAS (Data API). Tabulām un funkcijām piekļūst tikai ielogoti lietotāji;
-- ko katrs drīkst redzēt un darīt, nosaka RLS politikas un pārbaudes funkcijās. Neielogotiem (anon) — nekas.
-- =====================================================================
revoke all on all tables in schema public from anon, public;
revoke all on all sequences in schema public from anon, public;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Uztur bezmaksas projektu nomodā: GitHub (.github/workflows/supabase-keepalive.yml) katru dienu izsauc šo funkciju.
-- Vienīgā funkcija, ko drīkst izsaukt neielogots (anon); neatklāj nekādus datus.
create or replace function public.keepalive() returns int
language sql stable security definer set search_path = public as $$ select count(*)::int from settings $$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- =====================================================================
-- FOTO GLABĀTUVE (Supabase Storage): BOX foto izčekojoties.
-- Augšupielādē tikai savā mapē (<lietotāja id>/...), skatās aktīvie dalībnieki, dzēš tikai admins.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('checkout', 'checkout', false) on conflict (id) do nothing;
create policy checkout_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'checkout' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active());
create policy checkout_select on storage.objects for select to authenticated
  using (bucket_id = 'checkout' and public.is_active());
create policy checkout_delete on storage.objects for delete to authenticated
  using (bucket_id = 'checkout' and public.is_admin());

-- =====================================================================
-- AUTOMĀTISKĀ MĒNEŠA SLĒGŠANA — katra mēneša 1. datumā 03:05 (Rīgas laiks ≈ 01:05 UTC)
-- (Supabase: Database → Extensions → ieslēgt pg_cron, tad palaist šo bloku)
-- =====================================================================
-- create extension if not exists pg_cron;
-- select cron.schedule('box-close-month', '5 1 1 * *',
--   $$ select public.close_month((date_trunc('month', now() at time zone 'Europe/Riga') - interval '1 month')::date) $$);
