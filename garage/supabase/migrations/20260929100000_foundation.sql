-- =============================================================================
-- BS Garage — foundation: tenants, members, roles, settings, customers, vehicles
-- =============================================================================
-- Conventions for every migration of this project:
--   * every business table carries org_id and has row-level security;
--   * relations between tenant rows use composite keys (org_id, id) so a row
--     can never point at another garage's row;
--   * errors raised for the UI use messages 'bsg.<code>' (see src/lib/errors.ts);
--   * internal helpers live in schema `private`, never exposed nor executable
--     by API roles.

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Organizations (garages = tenants) and branches
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  legal_name text,
  trn text,
  trade_license_no text,
  vat_registered boolean not null default true,
  address text,
  emirate text,
  city text,
  phone text,
  email text,
  website text,
  logo_url text,
  currency text not null default 'AED',
  timezone text not null default 'Asia/Dubai',
  default_payment_terms_days int not null default 0 check (default_payment_terms_days between 0 and 365),
  estimate_validity_days int not null default 14 check (estimate_validity_days between 1 and 365),
  default_labor_rate numeric(12,2) not null default 0 check (default_labor_rate >= 0),
  large_amount_threshold numeric(14,2) not null default 5000 check (large_amount_threshold >= 0),
  invoice_terms text,
  estimate_terms text,
  receipt_footer text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  address text,
  phone text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index branches_one_default on public.branches(org_id) where is_default;

-- -----------------------------------------------------------------------------
-- Members, roles, permissions
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role text not null check (role in ('owner','admin','manager','service_advisor','mechanic','accountant')),
  permission text not null,
  primary key (role, permission)
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','service_advisor','mechanic','accountant')),
  display_name text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user on public.memberships(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  role text not null check (role in ('owner','admin','manager','service_advisor','mechanic','accountant')),
  display_name text,
  invited_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
create unique index invitations_pending on public.invitations(org_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- The permission matrix. The UI reads this same table, so what is hidden in the
-- interface and what the database refuses can never disagree.
insert into public.role_permissions(role, permission)
select r, p from (values
  ('dashboard.view'), ('finance.view'),
  ('invoices.view'), ('invoices.create'), ('invoices.issue'), ('invoices.cancel'),
  ('payments.record'), ('payments.void'), ('refunds.record'), ('credit_notes.create'),
  ('estimates.view'), ('estimates.manage'),
  ('job_cards.view'), ('job_cards.manage'), ('job_cards.progress'),
  ('customers.view'), ('customers.manage'),
  ('catalog.view'), ('catalog.manage'),
  ('stock.view'), ('stock.adjust'),
  ('suppliers.view'), ('suppliers.manage'), ('purchases.manage'),
  ('appointments.view'), ('appointments.manage'),
  ('inspections.view'), ('inspections.manage'),
  ('reports.view'), ('audit.view'), ('staff.manage'),
  ('settings.manage'), ('users.manage')
) as perms(p)
cross join (values ('owner'), ('admin')) as roles(r);

insert into public.role_permissions(role, permission)
select 'manager', permission from public.role_permissions
where role = 'owner' and permission not in ('settings.manage', 'users.manage');

insert into public.role_permissions(role, permission) values
  ('service_advisor','dashboard.view'),
  ('service_advisor','invoices.view'), ('service_advisor','invoices.create'), ('service_advisor','invoices.issue'),
  ('service_advisor','payments.record'),
  ('service_advisor','estimates.view'), ('service_advisor','estimates.manage'),
  ('service_advisor','job_cards.view'), ('service_advisor','job_cards.manage'), ('service_advisor','job_cards.progress'),
  ('service_advisor','customers.view'), ('service_advisor','customers.manage'),
  ('service_advisor','catalog.view'), ('service_advisor','stock.view'), ('service_advisor','suppliers.view'),
  ('service_advisor','appointments.view'), ('service_advisor','appointments.manage'),
  ('service_advisor','inspections.view'), ('service_advisor','inspections.manage'),

  ('mechanic','dashboard.view'),
  ('mechanic','job_cards.progress'),
  ('mechanic','customers.view'),
  ('mechanic','catalog.view'), ('mechanic','stock.view'),
  ('mechanic','appointments.view'),
  ('mechanic','inspections.view'), ('mechanic','inspections.manage'),

  ('accountant','dashboard.view'), ('accountant','finance.view'),
  ('accountant','invoices.view'),
  ('accountant','payments.record'), ('accountant','payments.void'), ('accountant','refunds.record'),
  ('accountant','credit_notes.create'),
  ('accountant','estimates.view'), ('accountant','job_cards.view'),
  ('accountant','customers.view'), ('accountant','catalog.view'), ('accountant','stock.view'),
  ('accountant','suppliers.view'),
  ('accountant','reports.view'), ('accountant','audit.view');

create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and active
  )
$$;

create or replace function public.has_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role = m.role
    where m.org_id = p_org and m.user_id = auth.uid() and m.active and rp.permission = p_perm
  )
$$;

create or replace function private.assert_perm(p_org uuid, p_perm text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception using message = 'bsg.not_authenticated';
  end if;
  if not public.has_perm(p_org, p_perm) then
    raise exception using message = 'bsg.permission_denied', detail = p_perm, errcode = '42501';
  end if;
end $$;

create or replace function private.actor_name(p_org uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select coalesce(nullif(btrim(display_name), ''), email) from public.memberships
      where org_id = p_org and user_id = auth.uid()),
    (select email from auth.users where id = auth.uid()),
    'system'
  )
$$;

create or replace function private.today(p_org uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select timezone from public.organizations where id = p_org), 'Asia/Dubai'))::date
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_org_time on public.audit_log(org_id, created_at desc);
create index audit_log_entity on public.audit_log(org_id, entity_type, entity_id);

create or replace function private.log(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid, p_summary text, p_details jsonb default '{}'
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log(org_id, actor_id, actor_name, action, entity_type, entity_id, summary, details)
  values (p_org, auth.uid(), private.actor_name(p_org), p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_details, '{}'))
$$;

-- -----------------------------------------------------------------------------
-- Settings: tax rates, payment methods, numbering, technicians
-- -----------------------------------------------------------------------------
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  rate numeric(5,2) not null check (rate between 0 and 100),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index tax_rates_one_default on public.tax_rates(org_id) where is_default;

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  kind text not null default 'other' check (kind in ('cash','card','bank_transfer','online','cheque','other')),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.document_sequences (
  org_id uuid not null references public.organizations(id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice','estimate','job_card','receipt','refund','credit_note','purchase_order')),
  prefix text not null default '' check (length(prefix) <= 12),
  next_number bigint not null default 1 check (next_number >= 1),
  padding int not null default 5 check (padding between 1 and 10),
  primary key (org_id, doc_type)
);

-- Gapless: the row stays locked until the calling transaction ends, and a
-- rollback returns the number. Numbers are only drawn inside RPC transactions.
create or replace function private.next_number(p_org uuid, p_type text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefix text; v_n bigint; v_pad int;
begin
  update public.document_sequences
     set next_number = next_number + 1
   where org_id = p_org and doc_type = p_type
  returning prefix, next_number - 1, padding into v_prefix, v_n, v_pad;
  if v_n is null then
    raise exception using message = 'bsg.sequence_missing', detail = p_type;
  end if;
  return v_prefix || lpad(v_n::text, v_pad, '0');
end $$;

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text,
  user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

-- -----------------------------------------------------------------------------
-- Customers and vehicles
-- -----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null default 'individual' check (type in ('individual','company')),
  first_name text,
  last_name text,
  company_name text,
  display_name text generated always as (
    case when type = 'company' and nullif(btrim(coalesce(company_name, '')), '') is not null
      then btrim(company_name)
      else btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    end
  ) stored,
  phone text,
  whatsapp text,
  email text check (email is null or email = '' or email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  address text,
  emirate text,
  trn text,
  trade_license_no text,
  notes text,
  phone_key text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9)) stored,
  whatsapp_key text generated always as (right(regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g'), 9)) stored,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, id),
  check (
    (type = 'individual' and length(btrim(coalesce(first_name, '') || coalesce(last_name, ''))) > 0)
    or (type = 'company' and length(btrim(coalesce(company_name, ''))) > 0)
  )
);
create index customers_org_name on public.customers(org_id, display_name);
create index customers_org_phone on public.customers(org_id, phone_key);
create index customers_org_whatsapp on public.customers(org_id, whatsapp_key);
create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  plate_emirate text check (plate_emirate is null or plate_emirate in ('DXB','AUH','SHJ','AJM','UAQ','RAK','FUJ')),
  plate_code text check (plate_code is null or plate_code ~ '^[A-Za-z0-9]{0,3}$'),
  plate_number text check (plate_number is null or plate_number ~ '^[0-9]{1,5}$'),
  plate_key text generated always as (
    upper(regexp_replace(coalesce(plate_code, '') || coalesce(plate_number, ''), '[^A-Za-z0-9]', '', 'g'))
  ) stored,
  vin text check (vin is null or length(vin) <= 32),
  make text,
  model text,
  year int check (year is null or year between 1900 and 2100),
  trim text,
  engine text,
  fuel text check (fuel is null or fuel in ('petrol','diesel','hybrid','electric','lpg','other')),
  transmission text check (transmission is null or transmission in ('automatic','manual','cvt','other')),
  mileage int check (mileage is null or mileage >= 0),
  color text,
  registration_date date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  check (plate_number is not null or vin is not null)
);
create index vehicles_org_plate on public.vehicles(org_id, plate_key);
create index vehicles_org_vin on public.vehicles(org_id, upper(vin));
create index vehicles_customer on public.vehicles(org_id, customer_id);
create trigger vehicles_touch before update on public.vehicles
  for each row execute function private.touch_updated_at();

-- Audit of direct edits (customers, vehicles, settings).
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_label text;
  v_changed jsonb := '{}';
  k text;
begin
  if tg_table_name = 'customers' then
    v_label := coalesce(new.display_name, '');
  elsif tg_table_name = 'vehicles' then
    v_label := btrim(coalesce(new.plate_emirate, '') || ' ' || coalesce(new.plate_code, '') || ' ' || coalesce(new.plate_number, '') || ' ' || coalesce(new.make, '') || ' ' || coalesce(new.model, ''));
  elsif tg_table_name = 'organizations' then
    v_label := new.name;
  else
    v_label := coalesce(to_jsonb(new) ->> 'name', '');
  end if;

  if tg_op = 'INSERT' then
    perform private.log(
      case when tg_table_name = 'organizations' then new.id else (to_jsonb(new) ->> 'org_id')::uuid end,
      tg_argv[0] || '.created', tg_argv[0], new.id, v_label, '{}');
  else
    for k in select key from jsonb_each(to_jsonb(new)) loop
      if k not in ('updated_at', 'display_name', 'phone_key', 'whatsapp_key', 'plate_key')
         and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_changed <> '{}' then
      perform private.log(
        case when tg_table_name = 'organizations' then new.id else (to_jsonb(new) ->> 'org_id')::uuid end,
        case when new.archived_at is not null and old.archived_at is null then tg_argv[0] || '.archived'
             else tg_argv[0] || '.updated' end,
        tg_argv[0], new.id, v_label, v_changed);
    end if;
  end if;
  return new;
end $$;

create trigger customers_audit after insert or update on public.customers
  for each row execute function private.audit_row('customer');
create trigger vehicles_audit after insert or update on public.vehicles
  for each row execute function private.audit_row('vehicle');

-- organizations has no archived_at: use a dedicated wrapper so NEW.archived_at
-- is never referenced on it.
create or replace function private.audit_settings()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_changed jsonb := '{}';
  k text;
  v_org uuid := coalesce((to_jsonb(new) ->> 'org_id')::uuid, new.id);
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  for k in select key from jsonb_each(to_jsonb(new)) loop
    if k not in ('updated_at') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if v_changed <> '{}' then
    perform private.log(v_org, tg_argv[0] || '.updated', tg_argv[0],
      (to_jsonb(new) ->> 'id')::uuid, coalesce(to_jsonb(new) ->> 'name', ''), v_changed);
  end if;
  return new;
end $$;

create trigger organizations_audit after update on public.organizations
  for each row execute function private.audit_settings('settings');
create trigger tax_rates_audit after update on public.tax_rates
  for each row execute function private.audit_settings('tax_rate');

-- -----------------------------------------------------------------------------
-- Row-level security and grants
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.role_permissions enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.tax_rates enable row level security;
alter table public.payment_methods enable row level security;
alter table public.document_sequences enable row level security;
alter table public.technicians enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;

revoke all on public.organizations, public.branches, public.role_permissions, public.memberships,
  public.invitations, public.audit_log, public.tax_rates, public.payment_methods,
  public.document_sequences, public.technicians, public.customers, public.vehicles
  from anon, authenticated;

grant select on public.organizations, public.branches, public.role_permissions, public.memberships,
  public.invitations, public.audit_log, public.tax_rates, public.payment_methods,
  public.document_sequences, public.technicians, public.customers, public.vehicles
  to authenticated;

-- Only profile columns are editable; identity and ownership columns are not.
grant update (name, legal_name, trn, trade_license_no, vat_registered, address, emirate, city, phone,
  email, website, logo_url, default_payment_terms_days, estimate_validity_days, default_labor_rate,
  large_amount_threshold, invoice_terms, estimate_terms, receipt_footer)
  on public.organizations to authenticated;
grant insert (org_id, name, address, phone), update (name, address, phone, active) on public.branches to authenticated;
grant insert (org_id, name, rate, active), update (name, rate, active) on public.tax_rates to authenticated;
grant insert (org_id, name, kind, active, sort_order), update (name, kind, active, sort_order) on public.payment_methods to authenticated;
grant insert (org_id, name, phone, user_id, active), update (name, phone, user_id, active) on public.technicians to authenticated;
grant insert (org_id, type, first_name, last_name, company_name, phone, whatsapp, email, address, emirate,
  trn, trade_license_no, notes),
  update (type, first_name, last_name, company_name, phone, whatsapp, email, address, emirate,
  trn, trade_license_no, notes, archived_at)
  on public.customers to authenticated;
grant insert (org_id, customer_id, plate_emirate, plate_code, plate_number, vin, make, model, year, trim,
  engine, fuel, transmission, mileage, color, registration_date, notes),
  update (customer_id, plate_emirate, plate_code, plate_number, vin, make, model, year, trim,
  engine, fuel, transmission, mileage, color, registration_date, notes, archived_at)
  on public.vehicles to authenticated;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_perm(id, 'settings.manage')) with check (public.has_perm(id, 'settings.manage'));

create policy branches_select on public.branches for select to authenticated using (public.is_member(org_id));
create policy branches_insert on public.branches for insert to authenticated with check (public.has_perm(org_id, 'settings.manage'));
create policy branches_update on public.branches for update to authenticated
  using (public.has_perm(org_id, 'settings.manage')) with check (public.has_perm(org_id, 'settings.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_member(org_id));

create policy invitations_select on public.invitations for select to authenticated
  using (public.has_perm(org_id, 'users.manage'));

create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_perm(org_id, 'audit.view'));

create policy tax_rates_select on public.tax_rates for select to authenticated using (public.is_member(org_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated with check (public.has_perm(org_id, 'settings.manage'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (public.has_perm(org_id, 'settings.manage')) with check (public.has_perm(org_id, 'settings.manage'));

create policy payment_methods_select on public.payment_methods for select to authenticated using (public.is_member(org_id));
create policy payment_methods_insert on public.payment_methods for insert to authenticated with check (public.has_perm(org_id, 'settings.manage'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (public.has_perm(org_id, 'settings.manage')) with check (public.has_perm(org_id, 'settings.manage'));

create policy document_sequences_select on public.document_sequences for select to authenticated using (public.is_member(org_id));

create policy technicians_select on public.technicians for select to authenticated using (public.is_member(org_id));
create policy technicians_insert on public.technicians for insert to authenticated with check (public.has_perm(org_id, 'staff.manage'));
create policy technicians_update on public.technicians for update to authenticated
  using (public.has_perm(org_id, 'staff.manage')) with check (public.has_perm(org_id, 'staff.manage'));

create policy customers_select on public.customers for select to authenticated using (public.has_perm(org_id, 'customers.view'));
create policy customers_insert on public.customers for insert to authenticated with check (public.has_perm(org_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (public.has_perm(org_id, 'customers.manage')) with check (public.has_perm(org_id, 'customers.manage'));

create policy vehicles_select on public.vehicles for select to authenticated using (public.has_perm(org_id, 'customers.view'));
create policy vehicles_insert on public.vehicles for insert to authenticated with check (public.has_perm(org_id, 'customers.manage'));
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_perm(org_id, 'customers.manage')) with check (public.has_perm(org_id, 'customers.manage'));

-- created_by is stamped by the database, never taken from the client.
create or replace function private.stamp_created_by()
returns trigger language plpgsql as $$
begin
  new.created_by := auth.uid();
  return new;
end $$;
create trigger customers_created_by before insert on public.customers
  for each row execute function private.stamp_created_by();
create trigger vehicles_created_by before insert on public.vehicles
  for each row execute function private.stamp_created_by();

-- -----------------------------------------------------------------------------
-- Onboarding: create a garage. Any signed-in user may create one and becomes
-- its owner. The VAT rate is asked, never assumed.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_org uuid;
  v_vat boolean := coalesce((p ->> 'vat_registered')::boolean, true);
  v_rate numeric := (p ->> 'vat_rate')::numeric;
begin
  if v_uid is null then
    raise exception using message = 'bsg.not_authenticated';
  end if;
  if nullif(btrim(p ->> 'name'), '') is null then
    raise exception using message = 'bsg.validation', detail = 'name';
  end if;
  if v_vat and (v_rate is null or v_rate < 0 or v_rate > 100) then
    raise exception using message = 'bsg.validation', detail = 'vat_rate';
  end if;
  select email into v_email from auth.users where id = v_uid;

  insert into public.organizations(name, legal_name, trn, trade_license_no, vat_registered, address, emirate,
    city, phone, email, default_labor_rate, created_by)
  values (btrim(p ->> 'name'), nullif(p ->> 'legal_name', ''), nullif(p ->> 'trn', ''),
    nullif(p ->> 'trade_license_no', ''), v_vat, nullif(p ->> 'address', ''), nullif(p ->> 'emirate', ''),
    nullif(p ->> 'city', ''), nullif(p ->> 'phone', ''), nullif(p ->> 'email', ''),
    coalesce((p ->> 'default_labor_rate')::numeric, 0), v_uid)
  returning id into v_org;

  insert into public.branches(org_id, name, address, phone, is_default)
  values (v_org, coalesce(nullif(btrim(p ->> 'branch_name'), ''), btrim(p ->> 'name')),
    nullif(p ->> 'address', ''), nullif(p ->> 'phone', ''), true);

  insert into public.memberships(org_id, user_id, role, display_name, email)
  values (v_org, v_uid, 'owner', coalesce(nullif(btrim(p ->> 'owner_name'), ''), v_email), v_email);

  if v_vat then
    insert into public.tax_rates(org_id, name, rate, is_default) values
      (v_org, 'Standard', v_rate, true),
      (v_org, 'Zero-rated', 0, false);
  else
    insert into public.tax_rates(org_id, name, rate, is_default) values (v_org, 'No VAT', 0, true);
  end if;

  insert into public.payment_methods(org_id, name, kind, sort_order) values
    (v_org, 'Cash', 'cash', 1),
    (v_org, 'Card', 'card', 2),
    (v_org, 'Bank Transfer', 'bank_transfer', 3),
    (v_org, 'Online Payment', 'online', 4),
    (v_org, 'Cheque', 'cheque', 5);

  insert into public.document_sequences(org_id, doc_type, prefix) values
    (v_org, 'invoice', 'INV-'),
    (v_org, 'estimate', 'EST-'),
    (v_org, 'job_card', 'JC-'),
    (v_org, 'receipt', 'RCT-'),
    (v_org, 'refund', 'RFD-'),
    (v_org, 'credit_note', 'CN-'),
    (v_org, 'purchase_order', 'PO-');

  perform private.log(v_org, 'organization.created', 'organization', v_org, btrim(p ->> 'name'), '{}');
  return v_org;
end $$;

-- Change a numbering prefix, or start numbering higher (when moving from a
-- previous system). Never lower: that would reuse numbers already issued.
create or replace function public.update_document_sequence(p_org uuid, p_doc_type text, p_prefix text, p_next_number bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_current bigint;
begin
  perform private.assert_perm(p_org, 'settings.manage');
  select next_number into v_current from public.document_sequences
   where org_id = p_org and doc_type = p_doc_type for update;
  if v_current is null then
    raise exception using message = 'bsg.not_found';
  end if;
  if p_next_number < v_current then
    raise exception using message = 'bsg.sequence_cannot_go_back', detail = v_current::text;
  end if;
  update public.document_sequences set prefix = coalesce(p_prefix, prefix), next_number = p_next_number
   where org_id = p_org and doc_type = p_doc_type;
  perform private.log(p_org, 'settings.numbering_changed', 'document_sequence', null,
    p_doc_type, jsonb_build_object('prefix', p_prefix, 'next_number', p_next_number));
end $$;

create or replace function public.set_default_tax_rate(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.assert_perm(p_org, 'settings.manage');
  if not exists (select 1 from public.tax_rates where id = p_id and org_id = p_org and active) then
    raise exception using message = 'bsg.not_found';
  end if;
  update public.tax_rates set is_default = false where org_id = p_org and is_default;
  update public.tax_rates set is_default = true where id = p_id;
  perform private.log(p_org, 'tax_rate.default_changed', 'tax_rate', p_id, '', '{}');
end $$;

create or replace function public.set_default_branch(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.assert_perm(p_org, 'settings.manage');
  if not exists (select 1 from public.branches where id = p_id and org_id = p_org and active) then
    raise exception using message = 'bsg.not_found';
  end if;
  update public.branches set is_default = false where org_id = p_org and is_default;
  update public.branches set is_default = true where id = p_id;
end $$;
