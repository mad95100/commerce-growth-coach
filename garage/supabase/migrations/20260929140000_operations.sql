-- =============================================================================
-- BS Garage — operations: appointments, inspections, outbound messages,
-- team management, global search, dashboard and reports
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  customer_id uuid,
  vehicle_id uuid,
  contact_name text,
  phone text,
  reason text not null check (length(btrim(reason)) between 1 and 300),
  starts_at timestamptz not null,
  duration_minutes int not null default 60 check (duration_minutes between 5 and 1440),
  technician_id uuid,
  status text not null default 'requested'
    check (status in ('requested','confirmed','arrived','in_progress','ready','completed','cancelled','no_show')),
  notes text,
  job_card_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  check (customer_id is not null or length(btrim(coalesce(contact_name, ''))) > 0),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles(org_id, id),
  foreign key (org_id, technician_id) references public.technicians(org_id, id),
  foreign key (org_id, job_card_id) references public.job_cards(org_id, id)
);
create index appointments_org_time on public.appointments(org_id, starts_at);
create trigger appointments_touch before update on public.appointments
  for each row execute function private.touch_updated_at();
create trigger appointments_created_by before insert on public.appointments
  for each row execute function private.stamp_created_by();

-- A vehicle on an appointment must belong to that appointment's customer.
create or replace function private.check_appointment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vehicle_id is not null and (new.customer_id is null or not exists (
      select 1 from public.vehicles where id = new.vehicle_id and customer_id = new.customer_id)) then
    raise exception using message = 'bsg.vehicle_not_customer';
  end if;
  return new;
end $$;
create trigger appointments_check before insert or update on public.appointments
  for each row execute function private.check_appointment();

-- -----------------------------------------------------------------------------
-- Inspections
-- -----------------------------------------------------------------------------
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  vehicle_id uuid not null,
  customer_id uuid not null,
  job_card_id uuid,
  technician_id uuid,
  mileage int check (mileage is null or mileage >= 0),
  status text not null default 'draft' check (status in ('draft','completed')),
  summary text,
  recommendations text,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, job_card_id) references public.job_cards(org_id, id),
  foreign key (org_id, technician_id) references public.technicians(org_id, id)
);
create index inspections_vehicle on public.inspections(org_id, vehicle_id);

create table public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  item_key text not null,
  label text not null,
  position int not null,
  status text check (status is null or status in ('ok','attention','urgent')),
  comment text,
  unique (inspection_id, item_key),
  foreign key (org_id, inspection_id) references public.inspections(org_id, id) on delete cascade
);

create or replace function public.create_inspection(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_vehicle record;
  v_id uuid;
  v_jc uuid := (p ->> 'job_card_id')::uuid;
begin
  perform private.assert_perm(v_org, 'inspections.manage');
  select id, customer_id, mileage into v_vehicle from public.vehicles
   where id = (p ->> 'vehicle_id')::uuid and org_id = v_org;
  if v_vehicle.id is null then raise exception using message = 'bsg.not_found', detail = 'vehicle'; end if;
  if v_jc is not null and not exists (
    select 1 from public.job_cards where id = v_jc and org_id = v_org and vehicle_id = v_vehicle.id) then
    raise exception using message = 'bsg.not_found', detail = 'job_card';
  end if;
  insert into public.inspections(org_id, branch_id, vehicle_id, customer_id, job_card_id, technician_id, mileage, created_by)
  values (v_org, private.branch_or_default(v_org, (p ->> 'branch_id')::uuid), v_vehicle.id, v_vehicle.customer_id,
    v_jc, (select id from public.technicians where id = (p ->> 'technician_id')::uuid and org_id = v_org),
    coalesce((p ->> 'mileage')::int, v_vehicle.mileage), auth.uid())
  returning id into v_id;
  insert into public.inspection_items(org_id, inspection_id, item_key, label, position)
  select v_org, v_id, k, l, ord from unnest(
    array['tires','brakes','battery','oil','coolant','suspension','lights','ac','engine','transmission','body'],
    array['Tires','Brakes','Battery','Oil','Coolant','Suspension','Lights','AC','Engine','Transmission','Body']
  ) with ordinality as t(k, l, ord);
  perform private.log(v_org, 'inspection.created', 'inspection', v_id, '', '{}');
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Outbound messages: every document or reminder sent to a customer.
-- delivery = 'manual_link': the app opened WhatsApp / the email app with a
-- prepared message; the user pressed send. We do NOT know it was delivered.
-- A future WhatsApp Business API adapter writes delivery = 'api'.
-- -----------------------------------------------------------------------------
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email','sms')),
  purpose text not null check (purpose in ('invoice','invoice_reminder','estimate','receipt','credit_note',
    'job_card','vehicle_ready','appointment_reminder','inspection','other')),
  delivery text not null default 'manual_link' check (delivery in ('manual_link','api')),
  status text not null default 'opened' check (status in ('opened','queued','sent','delivered','read','failed')),
  customer_id uuid,
  invoice_id uuid,
  estimate_id uuid,
  job_card_id uuid,
  payment_id uuid,
  credit_note_id uuid,
  inspection_id uuid,
  appointment_id uuid,
  recipient text,
  body text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, invoice_id) references public.invoices(org_id, id)
);
create index outbound_messages_invoice on public.outbound_messages(org_id, invoice_id, created_at desc);
create index outbound_messages_customer on public.outbound_messages(org_id, customer_id, created_at desc);

create or replace function public.log_outbound_message(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_id uuid;
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_invoice uuid := (p ->> 'invoice_id')::uuid;
  v_estimate uuid := (p ->> 'estimate_id')::uuid;
begin
  if not public.is_member(v_org) then
    raise exception using message = 'bsg.permission_denied', errcode = '42501';
  end if;
  if v_invoice is not null then
    perform private.assert_perm(v_org, 'invoices.view');
    select customer_id into v_customer from public.invoices where id = v_invoice and org_id = v_org;
    if v_customer is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  elsif v_estimate is not null then
    perform private.assert_perm(v_org, 'estimates.view');
    select customer_id into v_customer from public.estimates where id = v_estimate and org_id = v_org;
    if v_customer is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
  elsif v_customer is not null and not exists (select 1 from public.customers where id = v_customer and org_id = v_org) then
    raise exception using message = 'bsg.not_found', detail = 'customer';
  end if;
  insert into public.outbound_messages(org_id, channel, purpose, customer_id, invoice_id, estimate_id, job_card_id,
    payment_id, credit_note_id, inspection_id, appointment_id, recipient, body, created_by, created_by_name)
  values (v_org, p ->> 'channel', p ->> 'purpose', v_customer, v_invoice, v_estimate,
    (select id from public.job_cards where id = (p ->> 'job_card_id')::uuid and org_id = v_org),
    (select id from public.payments where id = (p ->> 'payment_id')::uuid and org_id = v_org),
    (select id from public.credit_notes where id = (p ->> 'credit_note_id')::uuid and org_id = v_org),
    (select id from public.inspections where id = (p ->> 'inspection_id')::uuid and org_id = v_org),
    (select id from public.appointments where id = (p ->> 'appointment_id')::uuid and org_id = v_org),
    p ->> 'recipient', p ->> 'body', auth.uid(), private.actor_name(v_org))
  returning id into v_id;
  if v_invoice is not null and p ->> 'purpose' in ('invoice','invoice_reminder') then
    update public.invoices set sent_at = now() where id = v_invoice and status = 'issued' and sent_at is null;
  end if;
  if v_estimate is not null and p ->> 'purpose' = 'estimate' then
    update public.estimates set status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now()
     where id = v_estimate and status = 'draft';
  end if;
  perform private.log(v_org, 'message.' || (p ->> 'purpose'), 'message', v_id, coalesce(p ->> 'recipient', ''),
    jsonb_build_object('channel', p ->> 'channel'));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Team: invitations and roles
-- -----------------------------------------------------------------------------
create or replace function public.invite_member(p_org uuid, p_email text, p_role text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_email text := lower(btrim(p_email));
begin
  perform private.assert_perm(p_org, 'users.manage');
  if v_email is null or v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception using message = 'bsg.validation', detail = 'email';
  end if;
  if p_role not in ('owner','admin','manager','service_advisor','mechanic','accountant') then
    raise exception using message = 'bsg.validation', detail = 'role';
  end if;
  if p_role = 'owner' and (select role from public.memberships where org_id = p_org and user_id = auth.uid()) <> 'owner' then
    raise exception using message = 'bsg.permission_denied', detail = 'owner', errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m where m.org_id = p_org and lower(m.email) = v_email and m.active) then
    raise exception using message = 'bsg.already_member';
  end if;
  update public.invitations set revoked_at = now()
   where org_id = p_org and lower(email) = v_email and accepted_at is null and revoked_at is null;
  insert into public.invitations(org_id, email, role, display_name, invited_by)
  values (p_org, v_email, p_role, nullif(btrim(p_name), ''), auth.uid())
  returning id into v_id;
  perform private.log(p_org, 'member.invited', 'invitation', v_id, v_email, jsonb_build_object('role', p_role));
  return v_id;
end $$;

create or replace function public.revoke_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v record;
begin
  select * into v from public.invitations where id = p_id;
  if v.id is null then raise exception using message = 'bsg.not_found'; end if;
  perform private.assert_perm(v.org_id, 'users.manage');
  update public.invitations set revoked_at = now() where id = p_id and accepted_at is null;
  perform private.log(v.org_id, 'member.invitation_revoked', 'invitation', p_id, v.email, '{}');
end $$;

-- Called after sign-in: joins every garage that invited this email address.
create or replace function public.accept_invitations()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  r record;
  n int := 0;
begin
  if v_uid is null then raise exception using message = 'bsg.not_authenticated'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;
  for r in select * from public.invitations
           where lower(email) = v_email and accepted_at is null and revoked_at is null for update loop
    insert into public.memberships(org_id, user_id, role, display_name, email)
    values (r.org_id, v_uid, r.role, coalesce(r.display_name, v_email), v_email)
    on conflict (org_id, user_id) do update set role = excluded.role, active = true;
    update public.invitations set accepted_at = now(), accepted_by = v_uid where id = r.id;
    perform private.log(r.org_id, 'member.joined', 'membership', v_uid, v_email, jsonb_build_object('role', r.role));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.update_member(p_org uuid, p_user uuid, p_role text, p_active boolean, p_name text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_my_role text;
begin
  perform private.assert_perm(p_org, 'users.manage');
  select * into v from public.memberships where org_id = p_org and user_id = p_user for update;
  if v.user_id is null then raise exception using message = 'bsg.not_found'; end if;
  select role into v_my_role from public.memberships where org_id = p_org and user_id = auth.uid();
  if p_role not in ('owner','admin','manager','service_advisor','mechanic','accountant') then
    raise exception using message = 'bsg.validation', detail = 'role';
  end if;
  if p_user = auth.uid() and (p_role <> v.role or not p_active) then
    raise exception using message = 'bsg.cannot_change_self';
  end if;
  if (v.role = 'owner' or p_role = 'owner') and v_my_role <> 'owner' then
    raise exception using message = 'bsg.permission_denied', detail = 'owner', errcode = '42501';
  end if;
  update public.memberships set role = p_role, active = p_active,
    display_name = coalesce(nullif(btrim(p_name), ''), display_name)
  where org_id = p_org and user_id = p_user;
  if not exists (select 1 from public.memberships where org_id = p_org and role = 'owner' and active) then
    raise exception using message = 'bsg.last_owner';
  end if;
  perform private.log(p_org, 'member.updated', 'membership', p_user, coalesce(v.email, ''),
    jsonb_build_object('role', jsonb_build_object('from', v.role, 'to', p_role),
                       'active', jsonb_build_object('from', v.active, 'to', p_active)));
end $$;

-- -----------------------------------------------------------------------------
-- Global search. SECURITY INVOKER: the caller's permissions filter results
-- (a mechanic never sees invoices). The query is interpreted in TypeScript
-- (src/lib/search.ts); this function only matches.
-- -----------------------------------------------------------------------------
create or replace function public.global_search(
  p_org uuid, p_text text, p_phone_key text default null, p_plate_key text default null,
  p_plate_number text default null, p_emirate text default null
) returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_like text := '%' || replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_customers jsonb; v_vehicles jsonb; v_invoices jsonb; v_estimates jsonb; v_jobs jsonb; v_parts jsonb; v_suppliers jsonb;
  v_customer_ids uuid[]; v_vehicle_ids uuid[];
begin
  if length(btrim(coalesce(p_text, ''))) < 2 then
    return '{}';
  end if;

  select coalesce(array_agg(id), '{}') into v_vehicle_ids from (
    select v.id from public.vehicles v
    where v.org_id = p_org and v.archived_at is null
      and (p_emirate is null or v.plate_emirate = p_emirate)
      and (
        (p_plate_key is not null and (v.plate_key = p_plate_key
          or (length(p_plate_key) >= 3 and v.plate_key like '%' || p_plate_key || '%')))
        or (p_plate_number is not null and v.plate_number = p_plate_number)
        or upper(coalesce(v.vin, '')) like upper(v_like)
        or (length(p_text) >= 3 and (coalesce(v.make, '') || ' ' || coalesce(v.model, '')) ilike v_like)
      )
    limit 20) x;

  select coalesce(array_agg(id), '{}') into v_customer_ids from (
    select c.id from public.customers c
    where c.org_id = p_org and c.archived_at is null
      and (
        c.display_name ilike v_like or coalesce(c.company_name, '') ilike v_like
        or coalesce(c.email, '') ilike v_like or coalesce(c.trn, '') ilike v_like
        or (p_phone_key is not null and (c.phone_key like '%' || p_phone_key || '%'
                                         or c.whatsapp_key like '%' || p_phone_key || '%'))
        or c.id in (select customer_id from public.vehicles where id = any(v_vehicle_ids))
      )
    order by c.display_name
    limit 20) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_customers from (
    select c.id, c.display_name, c.type, c.phone, c.email,
      (select count(*) from public.vehicles v where v.customer_id = c.id and v.archived_at is null) as vehicles
    from public.customers c where c.id = any(v_customer_ids) order by c.display_name limit 8) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_vehicles from (
    select v.id, v.plate_emirate, v.plate_code, v.plate_number, v.make, v.model, v.year, v.vin,
      c.id as customer_id, c.display_name as customer_name
    from public.vehicles v join public.customers c on c.id = v.customer_id
    where v.id = any(v_vehicle_ids) or (v.customer_id = any(v_customer_ids) and v.archived_at is null)
    order by (v.id = any(v_vehicle_ids)) desc, v.updated_at desc limit 8) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_invoices from (
    select i.id, i.number, i.status, i.display_status, i.issue_date, i.total, i.balance, i.customer_name,
      i.plate_emirate, i.plate_code, i.plate_number
    from public.v_invoices i
    where i.org_id = p_org and (coalesce(i.number, '') ilike v_like or i.customer_id = any(v_customer_ids)
      or i.vehicle_id = any(v_vehicle_ids))
    order by (coalesce(i.number, '') ilike v_like) desc, i.created_at desc limit 8) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_estimates from (
    select e.id, e.number, e.display_status, e.issue_date, e.total, e.customer_name
    from public.v_estimates e
    where e.org_id = p_org and (e.number ilike v_like or e.customer_id = any(v_customer_ids)
      or e.vehicle_id = any(v_vehicle_ids))
    order by (e.number ilike v_like) desc, e.created_at desc limit 5) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_jobs from (
    select j.id, j.number, j.status, j.received_at, j.total, j.customer_name, j.plate_emirate, j.plate_code, j.plate_number
    from public.v_job_cards j
    where j.org_id = p_org and (j.number ilike v_like or j.customer_id = any(v_customer_ids)
      or j.vehicle_id = any(v_vehicle_ids))
    order by (j.number ilike v_like) desc, j.created_at desc limit 5) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_parts from (
    select p.id, p.sku, p.part_number, p.oem_ref, p.name, p.brand, p.selling_price, p.barcode,
      (select coalesce(sum(quantity), 0) from public.stock_levels sl where sl.part_id = p.id) as stock,
      p.min_stock, s.id as supplier_id, s.name as supplier_name
    from public.parts p left join public.suppliers s on s.id = p.supplier_id
    where p.org_id = p_org and (p.sku ilike v_like or coalesce(p.part_number, '') ilike v_like
      or coalesce(p.oem_ref, '') ilike v_like or coalesce(p.barcode, '') = p_text or p.name ilike v_like)
    order by (upper(p.sku) = upper(p_text)) desc, p.name limit 8) x;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_suppliers from (
    select s.id, s.name, s.phone, s.contact_name from public.suppliers s
    where s.org_id = p_org and (s.name ilike v_like or coalesce(s.contact_name, '') ilike v_like
      or s.id in (select p.supplier_id from public.parts p where p.org_id = p_org and (p.sku ilike v_like
        or coalesce(p.part_number, '') ilike v_like))
      or s.id in (select sp.supplier_id from public.supplier_parts sp join public.parts p on p.id = sp.part_id
        where sp.org_id = p_org and (p.sku ilike v_like or coalesce(p.part_number, '') ilike v_like)))
    order by s.name limit 5) x;

  return jsonb_build_object('customers', v_customers, 'vehicles', v_vehicles, 'invoices', v_invoices,
    'estimates', v_estimates, 'job_cards', v_jobs, 'parts', v_parts, 'suppliers', v_suppliers);
end $$;

-- -----------------------------------------------------------------------------
-- Reports. Definitions (shown in the UI next to each figure):
--   Invoiced  = Σ totals of issued invoices dated in the period
--               − Σ credit notes dated in the period (incl. VAT)
--   Net sales = same, excluding VAT
--   Collected = payments + deposits received in the period − refunds
-- Cancelled invoices count nowhere. Drafts count nowhere.
-- -----------------------------------------------------------------------------
create or replace function public.report_summary(p_org uuid, p_from date, p_to date, p_branch uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_tz text;
  r jsonb;
begin
  if not (public.has_perm(p_org, 'reports.view') or public.has_perm(p_org, 'finance.view')) then
    raise exception using message = 'bsg.permission_denied', detail = 'reports.view', errcode = '42501';
  end if;
  select timezone into v_tz from public.organizations where id = p_org;

  with inv as (
    select * from public.invoices
    where org_id = p_org and status = 'issued' and issue_date between p_from and p_to
      and (p_branch is null or branch_id = p_branch)
  ), cn as (
    select * from public.credit_notes
    where org_id = p_org and issue_date between p_from and p_to and (p_branch is null or branch_id = p_branch)
  ), pay as (
    select *, (paid_at at time zone v_tz)::date as day from public.payments
    where org_id = p_org and voided_at is null and (paid_at at time zone v_tz)::date between p_from and p_to
      and (p_branch is null or branch_id = p_branch)
  ), lines as (
    select l.*, i.issue_date, coalesce(l.technician_id, jc.technician_id) as tech_id
    from public.doc_lines l join inv i on i.id = l.invoice_id
    left join public.job_cards jc on jc.id = i.job_card_id
  ), cn_lines as (
    select l.* from public.doc_lines l join cn on cn.id = l.credit_note_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'invoices', jsonb_build_object(
      'count', (select count(*) from inv),
      'total', (select coalesce(sum(total), 0) from inv),
      'net', (select coalesce(sum(total - vat_total), 0) from inv),
      'vat', (select coalesce(sum(vat_total), 0) from inv),
      'discounts', (select coalesce(sum(doc_discount), 0) from inv)
        + (select coalesce(sum(discount_amount), 0) from lines),
      'average', (select coalesce(round(avg(total), 2), 0) from inv)),
    'credit_notes', jsonb_build_object(
      'count', (select count(*) from cn),
      'total', (select coalesce(sum(total), 0) from cn),
      'net', (select coalesce(sum(subtotal), 0) from cn),
      'vat', (select coalesce(sum(vat_total), 0) from cn)),
    'invoiced', (select coalesce(sum(total), 0) from inv) - (select coalesce(sum(total), 0) from cn),
    'net_sales', (select coalesce(sum(total - vat_total), 0) from inv) - (select coalesce(sum(subtotal), 0) from cn),
    'vat_due', (select coalesce(sum(vat_total), 0) from inv) - (select coalesce(sum(vat_total), 0) from cn),
    'collected', (select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) from pay),
    'refunds', jsonb_build_object('count', (select count(*) from pay where kind = 'refund'),
      'total', (select coalesce(sum(amount), 0) from pay where kind = 'refund')),
    'by_kind', (select coalesce(jsonb_object_agg(kind, net), '{}') from (
      select kind, sum(net) as net from (
        select kind, taxable as net from lines
        union all select kind, -taxable from cn_lines) k group by kind) x),
    'payments_by_method', (select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]') from (
      select method_name as method, count(*) as count,
        sum(case when kind = 'refund' then -amount else amount end) as total
      from pay group by method_name) x),
    'by_technician', (select coalesce(jsonb_agg(to_jsonb(x) order by x.net desc), '[]') from (
      select coalesce(t.name, 'Unassigned') as name, sum(l.taxable) as net,
        sum(l.taxable) filter (where l.kind in ('labor','service')) as labor_net,
        count(distinct l.invoice_id) as invoices
      from lines l left join public.technicians t on t.id = l.tech_id
      group by coalesce(t.name, 'Unassigned')) x),
    'by_service', (select coalesce(jsonb_agg(to_jsonb(x) order by x.net desc), '[]') from (
      select l.description as name, sum(l.quantity) as quantity, sum(l.taxable) as net, count(*) as lines
      from lines l where l.kind in ('service','labor')
      group by l.description order by sum(l.taxable) desc limit 20) x),
    'by_customer', (select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]') from (
      select c.id, c.display_name as name, count(*) as invoices, sum(i.total) as total
      from inv i join public.customers c on c.id = i.customer_id
      group by c.id, c.display_name order by sum(i.total) desc limit 20) x),
    'daily', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]') from (
      select d::date as day,
        (select coalesce(sum(total), 0) from inv where issue_date = d::date)
          - (select coalesce(sum(total), 0) from cn where issue_date = d::date) as invoiced,
        (select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) from pay where day = d::date) as collected
      from generate_series(p_from, p_to, interval '1 day') d
      where p_to - p_from <= 400) x),
    'monthly', (select coalesce(jsonb_agg(to_jsonb(x) order by x.month), '[]') from (
      select to_char(m, 'YYYY-MM') as month,
        (select coalesce(sum(total), 0) from inv where date_trunc('month', issue_date) = m)
          - (select coalesce(sum(total), 0) from cn where date_trunc('month', issue_date) = m) as invoiced,
        (select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) from pay
          where date_trunc('month', day) = m) as collected
      from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') m) x)
  ) into r;
  return r;
end $$;

-- Outstanding money at this moment (not bound to a period).
create or replace function public.outstanding_summary(p_org uuid, p_branch uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if not public.has_perm(p_org, 'invoices.view') then
    raise exception using message = 'bsg.permission_denied', detail = 'invoices.view', errcode = '42501';
  end if;
  return (
    with o as (
      select * from public.v_invoices
      where org_id = p_org and status = 'issued' and balance > 0 and (p_branch is null or branch_id = p_branch)
    )
    select jsonb_build_object(
      'count', count(*),
      'total', coalesce(sum(balance), 0),
      'overdue_count', count(*) filter (where days_overdue > 0),
      'overdue_total', coalesce(sum(balance) filter (where days_overdue > 0), 0),
      'aging', jsonb_build_object(
        'current', coalesce(sum(balance) filter (where days_overdue = 0), 0),
        'd1_30', coalesce(sum(balance) filter (where days_overdue between 1 and 30), 0),
        'd31_60', coalesce(sum(balance) filter (where days_overdue between 31 and 60), 0),
        'd61_90', coalesce(sum(balance) filter (where days_overdue between 61 and 90), 0),
        'd90_plus', coalesce(sum(balance) filter (where days_overdue > 90), 0)))
    from o);
end $$;

-- Dashboard counters. Financial figures only for roles that may see them;
-- workshop counters for everyone who can see job cards.
create or replace function public.dashboard_summary(p_org uuid, p_branch uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_today date;
  v_month_start date;
  v_fin boolean := public.has_perm(p_org, 'finance.view');
  v_inv boolean := public.has_perm(p_org, 'invoices.view');
  r jsonb := '{}';
begin
  if not public.is_member(p_org) then
    raise exception using message = 'bsg.permission_denied', errcode = '42501';
  end if;
  v_today := private_today_public(p_org);
  v_month_start := date_trunc('month', v_today)::date;

  r := r || jsonb_build_object('today', v_today,
    'workshop', (select count(*) from public.job_cards where org_id = p_org
       and status in ('open','in_progress','waiting_parts','ready') and (p_branch is null or branch_id = p_branch)),
    'ready_for_pickup', (select count(*) from public.job_cards where org_id = p_org and status = 'ready'
       and (p_branch is null or branch_id = p_branch)),
    'delayed', (select count(*) from public.v_job_cards where org_id = p_org and is_delayed
       and (p_branch is null or branch_id = p_branch)),
    'appointments_today', (select count(*) from public.appointments where org_id = p_org
       and (starts_at at time zone (select timezone from public.organizations where id = p_org))::date = v_today and status not in ('cancelled','no_show')
       and (p_branch is null or branch_id = p_branch)),
    'estimates_waiting', (select count(*) from public.v_estimates where org_id = p_org
       and display_status in ('draft','sent','pending') and (p_branch is null or branch_id = p_branch)),
    'estimates_approved', (select count(*) from public.estimates where org_id = p_org and status = 'approved'
       and (p_branch is null or branch_id = p_branch)),
    'low_stock', (select count(*) from public.v_stock where org_id = p_org and active and is_low
       and (p_branch is null or branch_id = p_branch)));

  if v_inv then
    r := r || jsonb_build_object(
      'invoices_today', (select count(*) from public.invoices where org_id = p_org and status = 'issued'
         and issue_date = v_today and (p_branch is null or branch_id = p_branch)),
      'invoices_month', (select count(*) from public.invoices where org_id = p_org and status = 'issued'
         and issue_date >= v_month_start and (p_branch is null or branch_id = p_branch)),
      'drafts', (select count(*) from public.invoices where org_id = p_org and status = 'draft'
         and (p_branch is null or branch_id = p_branch)),
      'unpaid_count', (select count(*) from public.v_invoices where org_id = p_org and status = 'issued'
         and balance > 0 and (p_branch is null or branch_id = p_branch)),
      'overdue_count', (select count(*) from public.v_invoices where org_id = p_org and days_overdue > 0
         and (p_branch is null or branch_id = p_branch)),
      'paid_count_month', (select count(*) from public.v_invoices where org_id = p_org
         and display_status = 'paid' and issue_date >= v_month_start and (p_branch is null or branch_id = p_branch)));
  end if;

  if v_fin then
    r := r || jsonb_build_object(
      'today_report', public.report_summary(p_org, v_today, v_today, p_branch) - array['daily','monthly','by_customer','by_service','by_technician'],
      'month_report', public.report_summary(p_org, v_month_start, v_today, p_branch) - array['daily','monthly'],
      'last30', public.report_summary(p_org, v_today - 29, v_today, p_branch) -> 'daily',
      'last12m', public.report_summary(p_org, (date_trunc('month', v_today) - interval '11 months')::date, v_today, p_branch) -> 'monthly',
      'outstanding', public.outstanding_summary(p_org, p_branch));
  end if;
  return r;
end $$;

-- private.today is not callable by API roles; the invoker functions above use
-- this thin public wrapper, which only reveals the garage's calendar date.
create or replace function public.private_today_public(p_org uuid)
returns date language sql stable security definer set search_path = public, pg_temp as $$
  select private.today(p_org)
$$;

-- Vehicle history in one call: every estimate, job card and invoice of the
-- vehicle with their lines, newest first. RLS decides what the caller sees.
create or replace function public.vehicle_history(p_vehicle uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.date desc, x.created_at desc), '[]') from (
    select 'invoice' as type, i.id, i.number, i.display_status as status, coalesce(i.issue_date, i.created_at::date) as date,
      i.created_at, i.total, i.mileage, i.description, jc.technician_name as technician, i.notes,
      (select jsonb_agg(jsonb_build_object('kind', l.kind, 'description', l.description, 'quantity', l.quantity,
         'part_number', l.part_number, 'total', l.total) order by l.position) from public.doc_lines l where l.invoice_id = i.id) as lines
    from public.v_invoices i left join public.v_job_cards jc on jc.id = i.job_card_id
    where i.vehicle_id = p_vehicle and i.status <> 'cancelled'
    union all
    select 'job_card', j.id, j.number, j.status, j.received_at::date, j.created_at, j.total, j.mileage_in,
      coalesce(j.work_done, j.complaint), j.technician_name, j.diagnosis,
      (select jsonb_agg(jsonb_build_object('kind', l.kind, 'description', l.description, 'quantity', l.quantity,
         'part_number', l.part_number, 'total', l.total) order by l.position) from public.doc_lines l where l.job_card_id = j.id)
    from public.v_job_cards j where j.vehicle_id = p_vehicle
    union all
    select 'estimate', e.id, e.number, e.display_status, e.issue_date, e.created_at, e.total, e.mileage, e.description,
      null, e.notes,
      (select jsonb_agg(jsonb_build_object('kind', l.kind, 'description', l.description, 'quantity', l.quantity,
         'part_number', l.part_number, 'total', l.total) order by l.position) from public.doc_lines l where l.estimate_id = e.id)
    from public.v_estimates e where e.vehicle_id = p_vehicle
    union all
    select 'inspection', s.id, null, s.status, s.created_at::date, s.created_at, null, s.mileage, s.summary, t.name,
      s.recommendations, null
    from public.inspections s left join public.technicians t on t.id = s.technician_id
    where s.vehicle_id = p_vehicle
  ) x
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table public.appointments enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_items enable row level security;
alter table public.outbound_messages enable row level security;

revoke all on public.appointments, public.inspections, public.inspection_items, public.outbound_messages
  from anon, authenticated;
grant select on public.appointments, public.inspections, public.inspection_items, public.outbound_messages to authenticated;
grant insert (org_id, branch_id, customer_id, vehicle_id, contact_name, phone, reason, starts_at, duration_minutes,
  technician_id, status, notes),
  update (customer_id, vehicle_id, contact_name, phone, reason, starts_at, duration_minutes, technician_id, status,
  notes, job_card_id)
  on public.appointments to authenticated;
grant update (technician_id, mileage, status, summary, recommendations, completed_at) on public.inspections to authenticated;
grant update (status, comment) on public.inspection_items to authenticated;

create policy appointments_select on public.appointments for select to authenticated
  using (public.has_perm(org_id, 'appointments.view'));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.has_perm(org_id, 'appointments.manage'));
create policy appointments_update on public.appointments for update to authenticated
  using (public.has_perm(org_id, 'appointments.manage')) with check (public.has_perm(org_id, 'appointments.manage'));

create policy inspections_select on public.inspections for select to authenticated
  using (public.has_perm(org_id, 'inspections.view'));
create policy inspections_update on public.inspections for update to authenticated
  using (public.has_perm(org_id, 'inspections.manage')) with check (public.has_perm(org_id, 'inspections.manage'));
create policy inspection_items_select on public.inspection_items for select to authenticated
  using (public.has_perm(org_id, 'inspections.view'));
create policy inspection_items_update on public.inspection_items for update to authenticated
  using (public.has_perm(org_id, 'inspections.manage')) with check (public.has_perm(org_id, 'inspections.manage'));

create policy outbound_messages_select on public.outbound_messages for select to authenticated
  using (public.is_member(org_id));

-- -----------------------------------------------------------------------------
-- Function privileges: API roles run public functions only when signed in;
-- nothing in `private` is executable by them.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
