-- =============================================================================
-- BS Garage — document workflow functions
--   Customer → Vehicle → Estimate → Approved → Job card → Invoice → Payment
--   → Receipt → Vehicle history, with deposits, credit notes and refunds.
-- Every function checks the caller's permission in the document's garage and
-- runs as one transaction: it happens completely or not at all.
-- =============================================================================

create or replace function private.check_parties(p_org uuid, p_customer uuid, p_vehicle uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_customer is null or not exists (select 1 from public.customers where id = p_customer and org_id = p_org) then
    raise exception using message = 'bsg.not_found', detail = 'customer';
  end if;
  if p_vehicle is not null and not exists (
    select 1 from public.vehicles where id = p_vehicle and org_id = p_org and customer_id = p_customer
  ) then
    raise exception using message = 'bsg.vehicle_not_customer';
  end if;
end $$;

create or replace function private.customer_snapshot(p_customer uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', display_name, 'type', type, 'company_name', company_name,
    'phone', phone, 'whatsapp', whatsapp, 'email', email, 'address', address, 'emirate', emirate,
    'trn', trn, 'trade_license_no', trade_license_no)
  from public.customers where id = p_customer
$$;

create or replace function private.vehicle_snapshot(p_vehicle uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('plate_emirate', plate_emirate, 'plate_code', plate_code, 'plate_number', plate_number,
    'vin', vin, 'make', make, 'model', model, 'year', year, 'color', color)
  from public.vehicles where id = p_vehicle
$$;

create or replace function private.org_snapshot(p_org uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', name, 'legal_name', legal_name, 'trn', trn, 'trade_license_no', trade_license_no,
    'address', address, 'emirate', emirate, 'city', city, 'phone', phone, 'email', email, 'website', website,
    'logo_url', logo_url, 'vat_registered', vat_registered)
  from public.organizations where id = p_org
$$;

create or replace function private.apply_totals(p_table text, p_id uuid, p_totals jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  execute format('update public.%I set subtotal = $1, doc_discount = $2, vat_total = $3, total = $4, updated_at = now() where id = $5', p_table)
  using (p_totals ->> 'subtotal')::numeric, (p_totals ->> 'doc_discount')::numeric,
        (p_totals ->> 'vat_total')::numeric, (p_totals ->> 'total')::numeric, p_id;
end $$;

-- =============================================================================
-- Estimates
-- =============================================================================
create or replace function public.save_estimate(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_id uuid := (p ->> 'id')::uuid;
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_vehicle uuid := (p ->> 'vehicle_id')::uuid;
  v_cur record;
  v_totals jsonb;
  v_today date;
  v_number text;
begin
  perform private.assert_perm(v_org, 'estimates.manage');
  perform private.check_parties(v_org, v_customer, v_vehicle);
  v_today := private.today(v_org);
  if v_id is null then
    v_number := private.next_number(v_org, 'estimate');
    insert into public.estimates(org_id, branch_id, number, customer_id, vehicle_id, issue_date, valid_until, mileage,
      description, notes, terms, discount_type, discount_value, created_by)
    values (v_org, private.branch_or_default(v_org, (p ->> 'branch_id')::uuid), v_number, v_customer, v_vehicle,
      v_today,
      coalesce((p ->> 'valid_until')::date,
        v_today + (select estimate_validity_days from public.organizations where id = v_org)),
      (p ->> 'mileage')::int, nullif(p ->> 'description', ''), nullif(p ->> 'notes', ''),
      coalesce(nullif(p ->> 'terms', ''), (select estimate_terms from public.organizations where id = v_org)),
      nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0), auth.uid())
    returning id into v_id;
    perform private.log(v_org, 'estimate.created', 'estimate', v_id, v_number, '{}');
  else
    select * into v_cur from public.estimates where id = v_id and org_id = v_org for update;
    if v_cur.id is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
    if v_cur.status not in ('draft','sent','pending') then
      raise exception using message = 'bsg.invalid_state', detail = v_cur.status;
    end if;
    update public.estimates set customer_id = v_customer, vehicle_id = v_vehicle,
      branch_id = private.branch_or_default(v_org, coalesce((p ->> 'branch_id')::uuid, v_cur.branch_id)),
      valid_until = coalesce((p ->> 'valid_until')::date, v_cur.valid_until),
      mileage = (p ->> 'mileage')::int, description = nullif(p ->> 'description', ''),
      notes = nullif(p ->> 'notes', ''), terms = nullif(p ->> 'terms', ''),
      discount_type = nullif(p ->> 'discount_type', ''), discount_value = coalesce((p ->> 'discount_value')::numeric, 0)
    where id = v_id;
    perform private.log(v_org, 'estimate.updated', 'estimate', v_id, v_cur.number,
      jsonb_build_object('total_before', v_cur.total));
  end if;
  v_totals := private.write_lines('estimate', v_id, v_org, p -> 'lines',
    nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0));
  perform private.apply_totals('estimates', v_id, v_totals);
  return v_id;
end $$;

create or replace function public.set_estimate_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
begin
  select * into v from public.estimates where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
  perform private.assert_perm(v.org_id, 'estimates.manage');
  if not (
    (v.status = 'draft' and p_status in ('sent','pending','approved','rejected'))
    or (v.status = 'sent' and p_status in ('pending','approved','rejected','draft'))
    or (v.status = 'pending' and p_status in ('approved','rejected','draft'))
    or (v.status = 'approved' and p_status in ('draft','rejected'))
    or (v.status = 'rejected' and p_status in ('draft'))
  ) then
    raise exception using message = 'bsg.invalid_state', detail = v.status || '→' || p_status;
  end if;
  update public.estimates set status = p_status, updated_at = now(),
    sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
    decided_at = case when p_status in ('approved','rejected') then now()
                      when p_status = 'draft' then null else decided_at end
  where id = p_id;
  perform private.log(v.org_id, 'estimate.' || p_status, 'estimate', p_id, v.number,
    jsonb_build_object('from', v.status, 'to', p_status));
end $$;

-- One click: approve (if needed) and open the job card. Lines, customer,
-- vehicle, mileage and deposits carry over.
create or replace function public.convert_estimate_to_job_card(p_id uuid, p jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_jc uuid;
  v_number text;
  v_totals jsonb;
  v_tech uuid := (p ->> 'technician_id')::uuid;
begin
  select * into v from public.estimates where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
  perform private.assert_perm(v.org_id, 'job_cards.manage');
  perform private.assert_perm(v.org_id, 'estimates.manage');
  if v.status not in ('draft','sent','pending','approved') or v.job_card_id is not null or v.invoice_id is not null then
    raise exception using message = 'bsg.invalid_state', detail = v.status;
  end if;
  if v.vehicle_id is null then
    raise exception using message = 'bsg.vehicle_required';
  end if;
  if v_tech is not null and not exists (select 1 from public.technicians where id = v_tech and org_id = v.org_id) then
    raise exception using message = 'bsg.not_found', detail = 'technician';
  end if;
  v_number := private.next_number(v.org_id, 'job_card');
  insert into public.job_cards(org_id, branch_id, number, estimate_id, customer_id, vehicle_id, technician_id,
    mileage_in, complaint, promised_at, discount_type, discount_value, created_by)
  values (v.org_id, v.branch_id, v_number, v.id, v.customer_id, v.vehicle_id, v_tech, v.mileage, v.description,
    (p ->> 'promised_at')::timestamptz, v.discount_type, v.discount_value, auth.uid())
  returning id into v_jc;
  v_totals := private.write_lines('job_card', v_jc, v.org_id, private.lines_as_json('estimate', v.id),
    v.discount_type, v.discount_value);
  perform private.apply_totals('job_cards', v_jc, v_totals);
  update public.estimates set status = 'converted', job_card_id = v_jc,
    decided_at = coalesce(decided_at, now()), updated_at = now()
  where id = v.id;
  update public.payments set job_card_id = v_jc
   where estimate_id = v.id and invoice_id is null and job_card_id is null;
  perform private.log(v.org_id, 'estimate.converted', 'estimate', v.id, v.number, jsonb_build_object('job_card', v_number));
  perform private.log(v.org_id, 'job_card.created', 'job_card', v_jc, v_number, jsonb_build_object('estimate', v.number));
  return v_jc;
end $$;

create or replace function public.create_invoice_from_estimate(p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_inv uuid;
  v_totals jsonb;
begin
  select * into v from public.estimates where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
  perform private.assert_perm(v.org_id, 'invoices.create');
  if v.status not in ('draft','sent','pending','approved') or v.job_card_id is not null or v.invoice_id is not null then
    raise exception using message = 'bsg.invalid_state', detail = v.status;
  end if;
  insert into public.invoices(org_id, branch_id, customer_id, vehicle_id, estimate_id, mileage, description, terms,
    discount_type, discount_value, created_by)
  values (v.org_id, v.branch_id, v.customer_id, v.vehicle_id, v.id, v.mileage, v.description,
    (select invoice_terms from public.organizations where id = v.org_id), v.discount_type, v.discount_value, auth.uid())
  returning id into v_inv;
  v_totals := private.write_lines('invoice', v_inv, v.org_id, private.lines_as_json('estimate', v.id),
    v.discount_type, v.discount_value);
  perform private.apply_totals('invoices', v_inv, v_totals);
  update public.estimates set status = 'converted', invoice_id = v_inv,
    decided_at = coalesce(decided_at, now()), updated_at = now()
  where id = v.id;
  update public.payments set invoice_id = v_inv where estimate_id = v.id and invoice_id is null;
  perform private.log(v.org_id, 'invoice.created', 'invoice', v_inv, 'Draft', jsonb_build_object('estimate', v.number));
  return v_inv;
end $$;

-- =============================================================================
-- Job cards
-- =============================================================================
create or replace function public.save_job_card(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_id uuid := (p ->> 'id')::uuid;
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_vehicle uuid := (p ->> 'vehicle_id')::uuid;
  v_tech uuid := (p ->> 'technician_id')::uuid;
  v_cur record;
  v_totals jsonb;
  v_number text;
begin
  perform private.assert_perm(v_org, 'job_cards.manage');
  if v_vehicle is null then raise exception using message = 'bsg.vehicle_required'; end if;
  perform private.check_parties(v_org, v_customer, v_vehicle);
  if v_tech is not null and not exists (select 1 from public.technicians where id = v_tech and org_id = v_org) then
    raise exception using message = 'bsg.not_found', detail = 'technician';
  end if;
  if v_id is null then
    v_number := private.next_number(v_org, 'job_card');
    insert into public.job_cards(org_id, branch_id, number, customer_id, vehicle_id, technician_id, mileage_in,
      complaint, diagnosis, work_done, internal_notes, promised_at, discount_type, discount_value, created_by)
    values (v_org, private.branch_or_default(v_org, (p ->> 'branch_id')::uuid), v_number, v_customer, v_vehicle,
      v_tech, (p ->> 'mileage_in')::int, nullif(p ->> 'complaint', ''), nullif(p ->> 'diagnosis', ''),
      nullif(p ->> 'work_done', ''), nullif(p ->> 'internal_notes', ''), (p ->> 'promised_at')::timestamptz,
      nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0), auth.uid())
    returning id into v_id;
    perform private.log(v_org, 'job_card.created', 'job_card', v_id, v_number, '{}');
  else
    select * into v_cur from public.job_cards where id = v_id and org_id = v_org for update;
    if v_cur.id is null then raise exception using message = 'bsg.not_found', detail = 'job_card'; end if;
    if v_cur.status = 'cancelled' or v_cur.invoice_id is not null then
      raise exception using message = 'bsg.invalid_state', detail = v_cur.status;
    end if;
    update public.job_cards set customer_id = v_customer, vehicle_id = v_vehicle, technician_id = v_tech,
      mileage_in = (p ->> 'mileage_in')::int, complaint = nullif(p ->> 'complaint', ''),
      diagnosis = nullif(p ->> 'diagnosis', ''), work_done = nullif(p ->> 'work_done', ''),
      internal_notes = nullif(p ->> 'internal_notes', ''), promised_at = (p ->> 'promised_at')::timestamptz,
      discount_type = nullif(p ->> 'discount_type', ''), discount_value = coalesce((p ->> 'discount_value')::numeric, 0)
    where id = v_id;
    perform private.log(v_org, 'job_card.updated', 'job_card', v_id, v_cur.number,
      jsonb_build_object('total_before', v_cur.total));
  end if;
  v_totals := private.write_lines('job_card', v_id, v_org, p -> 'lines',
    nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0));
  perform private.apply_totals('job_cards', v_id, v_totals);
  return v_id;
end $$;

-- Progress on the workshop floor. A mechanic may do this on the job cards
-- assigned to them; it never touches lines or amounts.
create or replace function public.update_job_card_progress(p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_manage boolean;
  v_status text := nullif(p ->> 'status', '');
begin
  select * into v from public.job_cards where id = (p ->> 'id')::uuid for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'job_card'; end if;
  if auth.uid() is null then raise exception using message = 'bsg.not_authenticated'; end if;
  v_manage := public.has_perm(v.org_id, 'job_cards.manage');
  if not v_manage and not public.is_my_job_card(v.id) then
    raise exception using message = 'bsg.permission_denied', detail = 'job_cards.progress', errcode = '42501';
  end if;
  if v.status = 'cancelled' then
    raise exception using message = 'bsg.invalid_state', detail = v.status;
  end if;
  if v_status is not null then
    if v_status not in ('open','in_progress','waiting_parts','ready','delivered','cancelled') then
      raise exception using message = 'bsg.validation', detail = 'status';
    end if;
    if v_status = 'cancelled' and (not v_manage or v.invoice_id is not null) then
      raise exception using message = 'bsg.invalid_state', detail = 'cancel';
    end if;
  end if;
  if p ? 'technician_id' and (p ->> 'technician_id')::uuid is distinct from v.technician_id then
    if not v_manage then
      raise exception using message = 'bsg.permission_denied', detail = 'job_cards.manage', errcode = '42501';
    end if;
    if (p ->> 'technician_id') is not null and not exists (
      select 1 from public.technicians where id = (p ->> 'technician_id')::uuid and org_id = v.org_id) then
      raise exception using message = 'bsg.not_found', detail = 'technician';
    end if;
  end if;
  update public.job_cards set
    status = coalesce(v_status, status),
    completed_at = case when v_status = 'ready' then coalesce(completed_at, now()) else completed_at end,
    delivered_at = case when v_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    diagnosis = case when p ? 'diagnosis' then nullif(p ->> 'diagnosis', '') else diagnosis end,
    work_done = case when p ? 'work_done' then nullif(p ->> 'work_done', '') else work_done end,
    internal_notes = case when p ? 'internal_notes' then nullif(p ->> 'internal_notes', '') else internal_notes end,
    technician_id = case when p ? 'technician_id' then (p ->> 'technician_id')::uuid else technician_id end,
    updated_at = now()
  where id = v.id;
  perform private.log(v.org_id,
    case when v_status is not null and v_status <> v.status then 'job_card.status_changed' else 'job_card.progress' end,
    'job_card', v.id, v.number,
    jsonb_build_object('from', v.status, 'to', coalesce(v_status, v.status)));
end $$;

create or replace function public.create_invoice_from_job_card(p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_inv uuid;
  v_totals jsonb;
begin
  select * into v from public.job_cards where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'job_card'; end if;
  perform private.assert_perm(v.org_id, 'invoices.create');
  if v.status = 'cancelled' or v.invoice_id is not null then
    raise exception using message = 'bsg.invalid_state', detail = v.status;
  end if;
  insert into public.invoices(org_id, branch_id, customer_id, vehicle_id, job_card_id, estimate_id, mileage,
    description, terms, discount_type, discount_value, created_by)
  values (v.org_id, v.branch_id, v.customer_id, v.vehicle_id, v.id, v.estimate_id, v.mileage_in,
    coalesce(v.work_done, v.complaint), (select invoice_terms from public.organizations where id = v.org_id),
    v.discount_type, v.discount_value, auth.uid())
  returning id into v_inv;
  v_totals := private.write_lines('invoice', v_inv, v.org_id, private.lines_as_json('job_card', v.id),
    v.discount_type, v.discount_value);
  perform private.apply_totals('invoices', v_inv, v_totals);
  update public.job_cards set invoice_id = v_inv, updated_at = now() where id = v.id;
  update public.payments set invoice_id = v_inv where job_card_id = v.id and invoice_id is null;
  perform private.log(v.org_id, 'invoice.created', 'invoice', v_inv, 'Draft', jsonb_build_object('job_card', v.number));
  return v_inv;
end $$;

-- =============================================================================
-- Invoices
-- =============================================================================
create or replace function private.issue_invoice(p_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  o record;
  v_number text;
  v_today date;
  l record;
begin
  select * into v from public.invoices where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  if v.status <> 'draft' then raise exception using message = 'bsg.invalid_state', detail = v.status; end if;
  if not exists (select 1 from public.doc_lines where invoice_id = v.id) then
    raise exception using message = 'bsg.invoice_empty';
  end if;
  select * into o from public.organizations where id = v.org_id;
  v_today := private.today(v.org_id);
  v_number := private.next_number(v.org_id, 'invoice');
  update public.invoices set status = 'issued', number = v_number, issue_date = v_today,
    due_date = v_today + o.default_payment_terms_days,
    customer_snapshot = private.customer_snapshot(v.customer_id),
    vehicle_snapshot = case when v.vehicle_id is not null then private.vehicle_snapshot(v.vehicle_id) end,
    org_snapshot = private.org_snapshot(v.org_id), vat_registered = o.vat_registered,
    issued_at = now(), issued_by = auth.uid(), updated_at = now()
  where id = v.id;
  for l in select part_id, quantity from public.doc_lines where invoice_id = v.id and part_id is not null loop
    perform private.move_stock(v.org_id, v.branch_id, l.part_id, -l.quantity, 'sale', 'invoice', v.id, v_number);
  end loop;
  if v.vehicle_id is not null and v.mileage is not null then
    update public.vehicles set mileage = v.mileage
     where id = v.vehicle_id and (mileage is null or mileage < v.mileage);
  end if;
  perform private.log(v.org_id, 'invoice.issued', 'invoice', v.id, v_number,
    jsonb_build_object('total', v.total, 'vat', v.vat_total));
  return v_number;
end $$;

create or replace function private.record_payment(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'payment');
  v_amount numeric := (p ->> 'amount')::numeric;
  v_method record;
  v_inv public.invoices%rowtype; v_jc public.job_cards%rowtype; v_est public.estimates%rowtype;
  v_invoice uuid; v_job uuid; v_estimate uuid; v_customer uuid; v_branch uuid;
  v_balance numeric;
  v_paid_at timestamptz := coalesce((p ->> 'paid_at')::timestamptz, now());
  v_number text;
  v_id uuid;
begin
  if v_kind not in ('payment','deposit') then
    raise exception using message = 'bsg.validation', detail = 'kind';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception using message = 'bsg.validation', detail = 'amount';
  end if;
  if v_paid_at > now() + interval '1 day' then
    raise exception using message = 'bsg.validation', detail = 'paid_at';
  end if;
  select id, name into v_method from public.payment_methods
   where id = (p ->> 'method_id')::uuid and org_id = v_org and active;
  if v_method.id is null then raise exception using message = 'bsg.not_found', detail = 'payment_method'; end if;

  if p ->> 'invoice_id' is not null then
    select * into v_inv from public.invoices where id = (p ->> 'invoice_id')::uuid and org_id = v_org for update;
    if v_inv.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
    if v_inv.status = 'issued' then
      v_kind := 'payment';
      select balance into v_balance from private.invoice_amounts(v_inv.id);
      if v_amount > v_balance then
        raise exception using message = 'bsg.amount_exceeds_balance', detail = greatest(v_balance, 0)::text;
      end if;
    elsif v_inv.status = 'draft' then
      v_kind := 'deposit';
    else
      raise exception using message = 'bsg.invalid_state', detail = v_inv.status;
    end if;
    v_invoice := v_inv.id; v_job := v_inv.job_card_id; v_estimate := v_inv.estimate_id;
    v_customer := v_inv.customer_id; v_branch := v_inv.branch_id;
  elsif p ->> 'job_card_id' is not null then
    select * into v_jc from public.job_cards where id = (p ->> 'job_card_id')::uuid and org_id = v_org for update;
    if v_jc.id is null then raise exception using message = 'bsg.not_found', detail = 'job_card'; end if;
    if v_jc.status = 'cancelled' then raise exception using message = 'bsg.invalid_state', detail = v_jc.status; end if;
    v_kind := 'deposit'; v_job := v_jc.id; v_estimate := v_jc.estimate_id;
    v_customer := v_jc.customer_id; v_branch := v_jc.branch_id; v_invoice := v_jc.invoice_id;
  elsif p ->> 'estimate_id' is not null then
    select * into v_est from public.estimates where id = (p ->> 'estimate_id')::uuid and org_id = v_org for update;
    if v_est.id is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
    if v_est.status = 'rejected' then raise exception using message = 'bsg.invalid_state', detail = v_est.status; end if;
    v_kind := 'deposit'; v_estimate := v_est.id; v_job := v_est.job_card_id;
    v_customer := v_est.customer_id; v_branch := v_est.branch_id; v_invoice := v_est.invoice_id;
    if v_invoice is null and v_job is not null then
      select invoice_id into v_invoice from public.job_cards where id = v_job;
    end if;
  else
    raise exception using message = 'bsg.validation', detail = 'target';
  end if;

  -- A deposit on a document that already has an ISSUED invoice is a payment on
  -- that invoice: say so rather than creating a deposit nobody will apply.
  if v_kind = 'deposit' and v_invoice is not null
     and (select status from public.invoices where id = v_invoice) <> 'draft' then
    raise exception using message = 'bsg.use_invoice_payment';
  end if;

  v_number := private.next_number(v_org, 'receipt');
  insert into public.payments(org_id, branch_id, number, kind, customer_id, invoice_id, estimate_id, job_card_id,
    amount, method_id, method_name, reference, paid_at, notes, received_by, received_by_name)
  values (v_org, v_branch, v_number, v_kind, v_customer, v_invoice, v_estimate, v_job, v_amount, v_method.id,
    v_method.name, nullif(btrim(p ->> 'reference'), ''), v_paid_at, nullif(btrim(p ->> 'notes'), ''),
    auth.uid(), private.actor_name(v_org))
  returning id into v_id;
  perform private.log(v_org, v_kind || '.recorded', 'payment', v_id, v_number,
    jsonb_build_object('amount', v_amount, 'method', v_method.name, 'invoice', v_inv.number,
      'job_card', v_jc.number, 'estimate', v_est.number));
  return v_id;
end $$;

-- Saves a draft invoice; optionally issues it and records a payment in the
-- same transaction (the "+ New Invoice" screen does all three at once).
create or replace function public.save_invoice(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_id uuid := (p ->> 'id')::uuid;
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_vehicle uuid := (p ->> 'vehicle_id')::uuid;
  v_cur record;
  v_totals jsonb;
  v_number text;
  v_payment uuid;
begin
  perform private.assert_perm(v_org, 'invoices.create');
  perform private.check_parties(v_org, v_customer, v_vehicle);
  if v_id is null then
    insert into public.invoices(org_id, branch_id, customer_id, vehicle_id, mileage, description, notes, terms,
      discount_type, discount_value, created_by)
    values (v_org, private.branch_or_default(v_org, (p ->> 'branch_id')::uuid), v_customer, v_vehicle,
      (p ->> 'mileage')::int, nullif(p ->> 'description', ''), nullif(p ->> 'notes', ''),
      coalesce(nullif(p ->> 'terms', ''), (select invoice_terms from public.organizations where id = v_org)),
      nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0), auth.uid())
    returning id into v_id;
    perform private.log(v_org, 'invoice.created', 'invoice', v_id, 'Draft', '{}');
  else
    select * into v_cur from public.invoices where id = v_id and org_id = v_org for update;
    if v_cur.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
    if v_cur.status <> 'draft' then raise exception using message = 'bsg.invoice_locked'; end if;
    if v_cur.job_card_id is not null and (v_customer <> v_cur.customer_id or v_vehicle is distinct from v_cur.vehicle_id) then
      raise exception using message = 'bsg.validation', detail = 'customer_locked_by_job_card';
    end if;
    update public.invoices set customer_id = v_customer, vehicle_id = v_vehicle,
      branch_id = private.branch_or_default(v_org, coalesce((p ->> 'branch_id')::uuid, v_cur.branch_id)),
      mileage = (p ->> 'mileage')::int, description = nullif(p ->> 'description', ''),
      notes = nullif(p ->> 'notes', ''), terms = nullif(p ->> 'terms', ''),
      discount_type = nullif(p ->> 'discount_type', ''), discount_value = coalesce((p ->> 'discount_value')::numeric, 0)
    where id = v_id;
    -- deposits follow the customer: none may point at a different one
    update public.payments set customer_id = v_customer where invoice_id = v_id;
    perform private.log(v_org, 'invoice.updated', 'invoice', v_id, 'Draft',
      jsonb_build_object('total_before', v_cur.total));
  end if;
  v_totals := private.write_lines('invoice', v_id, v_org, p -> 'lines',
    nullif(p ->> 'discount_type', ''), coalesce((p ->> 'discount_value')::numeric, 0));
  perform private.apply_totals('invoices', v_id, v_totals);

  if coalesce((p ->> 'issue')::boolean, false) then
    perform private.assert_perm(v_org, 'invoices.issue');
    v_number := private.issue_invoice(v_id);
  end if;
  if jsonb_typeof(p -> 'payment') = 'object' and coalesce((p -> 'payment' ->> 'amount')::numeric, 0) > 0 then
    if v_number is null then
      raise exception using message = 'bsg.validation', detail = 'payment_requires_issue';
    end if;
    perform private.assert_perm(v_org, 'payments.record');
    v_payment := private.record_payment((p -> 'payment') || jsonb_build_object('org_id', v_org, 'invoice_id', v_id, 'kind', 'payment'));
  end if;
  return jsonb_build_object('invoice_id', v_id, 'number', v_number, 'payment_id', v_payment);
end $$;

create or replace function public.issue_invoice(p_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invoices where id = p_id;
  if v_org is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  perform private.assert_perm(v_org, 'invoices.issue');
  return private.issue_invoice(p_id);
end $$;

create or replace function public.delete_invoice_draft(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
begin
  select * into v from public.invoices where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  perform private.assert_perm(v.org_id, 'invoices.create');
  if v.status <> 'draft' then raise exception using message = 'bsg.invoice_locked'; end if;
  if exists (select 1 from public.payments where invoice_id = v.id and voided_at is null
             and job_card_id is null and estimate_id is null) then
    raise exception using message = 'bsg.invoice_has_payments';
  end if;
  update public.payments set invoice_id = null where invoice_id = v.id;
  update public.job_cards set invoice_id = null, updated_at = now() where invoice_id = v.id;
  update public.estimates set invoice_id = null, status = 'approved', updated_at = now() where invoice_id = v.id;
  delete from public.invoices where id = v.id;
  perform private.log(v.org_id, 'invoice.draft_deleted', 'invoice', v.id, 'Draft', jsonb_build_object('total', v.total));
end $$;

-- Cancelling is only possible when nothing was paid on the invoice itself and
-- no credit note exists: otherwise the correction is a credit note. Deposits
-- that came from the job card or estimate go back to it, stock goes back to
-- the shelf, and the job card can be invoiced again.
create or replace function public.cancel_invoice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  l record;
begin
  select * into v from public.invoices where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  perform private.assert_perm(v.org_id, 'invoices.cancel');
  if v.status <> 'issued' then raise exception using message = 'bsg.invalid_state', detail = v.status; end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using message = 'bsg.validation', detail = 'reason';
  end if;
  if exists (select 1 from public.credit_notes where invoice_id = v.id) then
    raise exception using message = 'bsg.invoice_has_credit_notes';
  end if;
  if exists (select 1 from public.payments where invoice_id = v.id and voided_at is null
             and not (kind in ('deposit','refund') and (job_card_id is not null or estimate_id is not null))) then
    raise exception using message = 'bsg.invoice_has_payments';
  end if;
  update public.payments set invoice_id = null
   where invoice_id = v.id and voided_at is null and kind in ('deposit','refund')
     and (job_card_id is not null or estimate_id is not null);
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancel_reason = btrim(p_reason), updated_at = now()
  where id = v.id;
  for l in select part_id, quantity from public.doc_lines where invoice_id = v.id and part_id is not null loop
    perform private.move_stock(v.org_id, v.branch_id, l.part_id, l.quantity, 'sale_reversal', 'invoice', v.id,
      v.number, 'Invoice cancelled');
  end loop;
  update public.job_cards set invoice_id = null, updated_at = now() where invoice_id = v.id;
  update public.estimates set invoice_id = null, status = 'approved', updated_at = now()
   where invoice_id = v.id and job_card_id is null;
  perform private.log(v.org_id, 'invoice.cancelled', 'invoice', v.id, v.number,
    jsonb_build_object('reason', btrim(p_reason), 'total', v.total));
end $$;

create or replace function public.mark_invoice_sent(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
begin
  select * into v from public.invoices where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  perform private.assert_perm(v.org_id, 'invoices.view');
  if v.status <> 'issued' then raise exception using message = 'bsg.invalid_state', detail = v.status; end if;
  if v.sent_at is null then
    update public.invoices set sent_at = now() where id = v.id;
    perform private.log(v.org_id, 'invoice.sent', 'invoice', v.id, v.number, '{}');
  end if;
end $$;

-- =============================================================================
-- Payments, deposits, refunds
-- =============================================================================
create or replace function public.record_payment(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.assert_perm((p ->> 'org_id')::uuid, 'payments.record');
  return private.record_payment(p);
end $$;

create or replace function public.void_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
begin
  select * into v from public.payments where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found', detail = 'payment'; end if;
  perform private.assert_perm(v.org_id, 'payments.void');
  if v.voided_at is not null then raise exception using message = 'bsg.invalid_state', detail = 'voided'; end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using message = 'bsg.validation', detail = 'reason';
  end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(), voided_by_name = private.actor_name(v.org_id),
    void_reason = btrim(p_reason)
  where id = v.id;
  perform private.log(v.org_id, v.kind || '.voided', 'payment', v.id, v.number,
    jsonb_build_object('amount', v.amount, 'reason', btrim(p_reason)));
end $$;

create or replace function public.record_refund(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_amount numeric := (p ->> 'amount')::numeric;
  v_method record;
  v_inv public.invoices%rowtype;
  v_balance numeric;
  v_available numeric;
  v_customer uuid; v_branch uuid; v_invoice uuid; v_job uuid; v_estimate uuid; v_cn uuid;
  v_number text;
  v_id uuid;
begin
  perform private.assert_perm(v_org, 'refunds.record');
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception using message = 'bsg.validation', detail = 'amount';
  end if;
  select id, name into v_method from public.payment_methods
   where id = (p ->> 'method_id')::uuid and org_id = v_org and active;
  if v_method.id is null then raise exception using message = 'bsg.not_found', detail = 'payment_method'; end if;

  if p ->> 'invoice_id' is not null then
    select * into v_inv from public.invoices where id = (p ->> 'invoice_id')::uuid and org_id = v_org for update;
    if v_inv.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
    if v_inv.status <> 'issued' then raise exception using message = 'bsg.invalid_state', detail = v_inv.status; end if;
    select balance into v_balance from private.invoice_amounts(v_inv.id);
    if v_balance >= 0 or v_amount > -v_balance then
      raise exception using message = 'bsg.refund_exceeds_credit', detail = greatest(-v_balance, 0)::text;
    end if;
    v_invoice := v_inv.id; v_customer := v_inv.customer_id; v_branch := v_inv.branch_id;
    if p ->> 'credit_note_id' is not null then
      select id into v_cn from public.credit_notes where id = (p ->> 'credit_note_id')::uuid and invoice_id = v_inv.id;
      if v_cn is null then raise exception using message = 'bsg.not_found', detail = 'credit_note'; end if;
    end if;
  elsif p ->> 'job_card_id' is not null or p ->> 'estimate_id' is not null then
    -- Refund of a deposit that was never applied to an invoice (job not done).
    if p ->> 'job_card_id' is not null then
      select id, customer_id, branch_id, estimate_id into v_job, v_customer, v_branch, v_estimate
        from public.job_cards where id = (p ->> 'job_card_id')::uuid and org_id = v_org for update;
      if v_job is null then raise exception using message = 'bsg.not_found', detail = 'job_card'; end if;
      select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into v_available
        from public.payments where job_card_id = v_job and invoice_id is null and voided_at is null;
    else
      select id, customer_id, branch_id into v_estimate, v_customer, v_branch
        from public.estimates where id = (p ->> 'estimate_id')::uuid and org_id = v_org for update;
      if v_estimate is null then raise exception using message = 'bsg.not_found', detail = 'estimate'; end if;
      select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into v_available
        from public.payments where estimate_id = v_estimate and invoice_id is null and voided_at is null;
    end if;
    if v_amount > v_available then
      raise exception using message = 'bsg.refund_exceeds_credit', detail = greatest(v_available, 0)::text;
    end if;
  else
    raise exception using message = 'bsg.validation', detail = 'target';
  end if;

  v_number := private.next_number(v_org, 'refund');
  insert into public.payments(org_id, branch_id, number, kind, customer_id, invoice_id, estimate_id, job_card_id,
    credit_note_id, amount, method_id, method_name, reference, paid_at, notes, received_by, received_by_name)
  values (v_org, v_branch, v_number, 'refund', v_customer, v_invoice, v_estimate, v_job, v_cn, v_amount,
    v_method.id, v_method.name, nullif(btrim(p ->> 'reference'), ''),
    coalesce((p ->> 'paid_at')::timestamptz, now()), nullif(btrim(p ->> 'notes'), ''),
    auth.uid(), private.actor_name(v_org))
  returning id into v_id;
  perform private.log(v_org, 'refund.recorded', 'payment', v_id, v_number,
    jsonb_build_object('amount', v_amount, 'method', v_method.name, 'invoice', v_inv.number));
  return v_id;
end $$;

-- =============================================================================
-- Credit notes
-- =============================================================================
create or replace function public.create_credit_note(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv record;
  v_mode text := p ->> 'mode';
  v_reason text := nullif(btrim(p ->> 'reason'), '');
  v_restock boolean := coalesce((p ->> 'restock')::boolean, false);
  v_items jsonb := '[]';
  v_line jsonb;
  src record;
  q numeric; cq numeric; ct numeric; cv numeric; v_taxable numeric; v_vat numeric;
  v_sub numeric := 0; v_vat_total numeric := 0; v_total numeric;
  v_credited numeric;
  v_amount numeric; v_rate record;
  v_id uuid; v_number text;
  i int;
begin
  select * into v_inv from public.invoices where id = (p ->> 'invoice_id')::uuid for update;
  if v_inv.id is null then raise exception using message = 'bsg.not_found', detail = 'invoice'; end if;
  perform private.assert_perm(v_inv.org_id, 'credit_notes.create');
  if v_inv.status <> 'issued' then raise exception using message = 'bsg.invalid_state', detail = v_inv.status; end if;
  if v_reason is null then raise exception using message = 'bsg.validation', detail = 'reason'; end if;

  if v_mode = 'lines' then
    for v_line in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
      select * into src from public.doc_lines where id = (v_line ->> 'line_id')::uuid and invoice_id = v_inv.id;
      if src.id is null then raise exception using message = 'bsg.not_found', detail = 'line'; end if;
      q := (v_line ->> 'quantity')::numeric;
      if q is null or q <= 0 or q <> round(q, 2) then
        raise exception using message = 'bsg.validation', detail = 'quantity';
      end if;
      select coalesce(sum(quantity), 0), coalesce(sum(taxable), 0), coalesce(sum(vat), 0) into cq, ct, cv
        from public.doc_lines where source_line_id = src.id;
      if cq + q > src.quantity then
        raise exception using message = 'bsg.credit_exceeds_line', detail = src.description;
      end if;
      if cq + q = src.quantity then
        v_taxable := src.taxable - ct;
        v_vat := src.vat - cv;
      else
        v_taxable := round(src.taxable * q / src.quantity, 2);
        v_vat := round(src.vat * q / src.quantity, 2);
      end if;
      v_items := v_items || jsonb_build_object('src', src.id, 'kind', src.kind, 'part_id', src.part_id,
        'service_id', src.service_id, 'description', src.description, 'part_number', src.part_number,
        'quantity', q, 'unit_price', src.unit_price, 'tax_rate_id', src.tax_rate_id, 'tax_rate', src.tax_rate,
        'taxable', v_taxable, 'vat', v_vat);
      v_sub := v_sub + v_taxable;
      v_vat_total := v_vat_total + v_vat;
    end loop;
    if jsonb_array_length(v_items) = 0 then
      raise exception using message = 'bsg.validation', detail = 'lines';
    end if;
  elsif v_mode = 'amount' then
    v_amount := (p ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception using message = 'bsg.validation', detail = 'amount';
    end if;
    select id, rate into v_rate from public.tax_rates
     where org_id = v_inv.org_id
       and id = coalesce((p ->> 'tax_rate_id')::uuid,
                         (select id from public.tax_rates where org_id = v_inv.org_id and is_default));
    if not coalesce(v_inv.vat_registered, false) then
      select null::uuid as id, null::numeric as rate into v_rate;
    end if;
    v_taxable := round(v_amount / (1 + coalesce(v_rate.rate, 0) / 100), 2);
    v_vat := v_amount - v_taxable;
    v_items := jsonb_build_array(jsonb_build_object('src', null, 'kind', 'other', 'part_id', null,
      'service_id', null, 'description', v_reason, 'part_number', null, 'quantity', 1, 'unit_price', v_taxable,
      'tax_rate_id', v_rate.id, 'tax_rate', coalesce(v_rate.rate, 0), 'taxable', v_taxable, 'vat', v_vat));
    v_sub := v_taxable;
    v_vat_total := v_vat;
    v_restock := false;
  else
    raise exception using message = 'bsg.validation', detail = 'mode';
  end if;

  v_total := v_sub + v_vat_total;
  if v_total <= 0 then raise exception using message = 'bsg.validation', detail = 'amount'; end if;
  select coalesce(sum(total), 0) into v_credited from public.credit_notes where invoice_id = v_inv.id;
  if v_total > v_inv.total - v_credited then
    raise exception using message = 'bsg.credit_exceeds_invoice', detail = (v_inv.total - v_credited)::text;
  end if;

  v_number := private.next_number(v_inv.org_id, 'credit_note');
  insert into public.credit_notes(org_id, branch_id, number, invoice_id, customer_id, issue_date, reason, mode,
    restock, subtotal, vat_total, total, customer_snapshot, created_by)
  values (v_inv.org_id, v_inv.branch_id, v_number, v_inv.id, v_inv.customer_id, private.today(v_inv.org_id),
    v_reason, v_mode, v_restock, v_sub, v_vat_total, v_total, v_inv.customer_snapshot, auth.uid())
  returning id into v_id;

  for i in 0..jsonb_array_length(v_items) - 1 loop
    v_line := v_items -> i;
    insert into public.doc_lines(org_id, credit_note_id, source_line_id, position, kind, part_id, service_id,
      description, part_number, quantity, unit_price, discount_pct, tax_rate_id, tax_rate, gross, discount_amount,
      net, doc_discount, taxable, vat, total)
    values (v_inv.org_id, v_id, (v_line ->> 'src')::uuid, i + 1, v_line ->> 'kind', (v_line ->> 'part_id')::uuid,
      (v_line ->> 'service_id')::uuid, v_line ->> 'description', v_line ->> 'part_number',
      (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_price')::numeric, 0, (v_line ->> 'tax_rate_id')::uuid,
      (v_line ->> 'tax_rate')::numeric, (v_line ->> 'taxable')::numeric, 0, (v_line ->> 'taxable')::numeric, 0,
      (v_line ->> 'taxable')::numeric, (v_line ->> 'vat')::numeric,
      (v_line ->> 'taxable')::numeric + (v_line ->> 'vat')::numeric);
    if v_restock and v_line ->> 'part_id' is not null then
      perform private.move_stock(v_inv.org_id, v_inv.branch_id, (v_line ->> 'part_id')::uuid,
        (v_line ->> 'quantity')::numeric, 'sale_reversal', 'credit_note', v_id, v_number, v_reason);
    end if;
  end loop;

  perform private.log(v_inv.org_id, 'credit_note.created', 'credit_note', v_id, v_number,
    jsonb_build_object('invoice', v_inv.number, 'total', v_total, 'reason', v_reason, 'restock', v_restock));
  return v_id;
end $$;
