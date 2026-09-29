-- =============================================================================
-- BS Garage — documents: estimates, job cards, invoices, credit notes, lines,
-- payments (payments, deposits, refunds). Totals engine.
-- =============================================================================

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  status text not null default 'draft'
    check (status in ('draft','sent','pending','approved','rejected','converted')),
  customer_id uuid not null,
  vehicle_id uuid,
  issue_date date not null,
  valid_until date,
  mileage int check (mileage is null or mileage >= 0),
  description text,
  notes text,
  terms text,
  discount_type text check (discount_type is null or discount_type in ('percent','amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  subtotal numeric(14,2) not null default 0,
  doc_discount numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  sent_at timestamptz,
  decided_at timestamptz,
  job_card_id uuid,
  invoice_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles(org_id, id)
);
create index estimates_org_status on public.estimates(org_id, status, issue_date desc);
create index estimates_vehicle on public.estimates(org_id, vehicle_id);
create index estimates_customer on public.estimates(org_id, customer_id);

create table public.job_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_parts','ready','delivered','cancelled')),
  estimate_id uuid,
  customer_id uuid not null,
  vehicle_id uuid not null,
  technician_id uuid,
  mileage_in int check (mileage_in is null or mileage_in >= 0),
  complaint text,
  diagnosis text,
  work_done text,
  internal_notes text,
  received_at timestamptz not null default now(),
  promised_at timestamptz,
  completed_at timestamptz,
  delivered_at timestamptz,
  discount_type text check (discount_type is null or discount_type in ('percent','amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  subtotal numeric(14,2) not null default 0,
  doc_discount numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  invoice_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles(org_id, id),
  foreign key (org_id, technician_id) references public.technicians(org_id, id),
  foreign key (org_id, estimate_id) references public.estimates(org_id, id)
);
create index job_cards_org_status on public.job_cards(org_id, status);
create index job_cards_vehicle on public.job_cards(org_id, vehicle_id);
create index job_cards_customer on public.job_cards(org_id, customer_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text,
  status text not null default 'draft' check (status in ('draft','issued','cancelled')),
  customer_id uuid not null,
  vehicle_id uuid,
  job_card_id uuid,
  estimate_id uuid,
  issue_date date,
  due_date date,
  mileage int check (mileage is null or mileage >= 0),
  description text,
  notes text,
  terms text,
  discount_type text check (discount_type is null or discount_type in ('percent','amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  subtotal numeric(14,2) not null default 0,
  doc_discount numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  vat_registered boolean,
  customer_snapshot jsonb,
  vehicle_snapshot jsonb,
  org_snapshot jsonb,
  sent_at timestamptz,
  issued_at timestamptz,
  issued_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  check (status = 'draft' or (number is not null and issue_date is not null and customer_snapshot is not null)),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, vehicle_id) references public.vehicles(org_id, id),
  foreign key (org_id, job_card_id) references public.job_cards(org_id, id),
  foreign key (org_id, estimate_id) references public.estimates(org_id, id)
);
create index invoices_org_status on public.invoices(org_id, status, issue_date desc);
create index invoices_vehicle on public.invoices(org_id, vehicle_id);
create index invoices_customer on public.invoices(org_id, customer_id);

alter table public.estimates add foreign key (org_id, job_card_id) references public.job_cards(org_id, id);
alter table public.estimates add foreign key (org_id, invoice_id) references public.invoices(org_id, id);
alter table public.job_cards add foreign key (org_id, invoice_id) references public.invoices(org_id, id);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  invoice_id uuid not null,
  customer_id uuid not null,
  issue_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  mode text not null check (mode in ('lines','amount')),
  restock boolean not null default false,
  subtotal numeric(14,2) not null,
  vat_total numeric(14,2) not null,
  total numeric(14,2) not null check (total > 0),
  customer_snapshot jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, invoice_id) references public.invoices(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id)
);
create index credit_notes_invoice on public.credit_notes(org_id, invoice_id);

create table public.doc_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id uuid,
  job_card_id uuid,
  invoice_id uuid,
  credit_note_id uuid,
  position int not null,
  kind text not null check (kind in ('part','labor','service','other')),
  part_id uuid,
  service_id uuid,
  technician_id uuid,
  source_line_id uuid references public.doc_lines(id),
  description text not null check (length(btrim(description)) between 1 and 500),
  part_number text,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate_id uuid,
  tax_rate numeric(5,2) not null default 0,
  gross numeric(14,2) not null,
  discount_amount numeric(14,2) not null,
  net numeric(14,2) not null,
  doc_discount numeric(14,2) not null,
  taxable numeric(14,2) not null,
  vat numeric(14,2) not null,
  total numeric(14,2) not null,
  check (num_nonnulls(estimate_id, job_card_id, invoice_id, credit_note_id) = 1),
  foreign key (org_id, estimate_id) references public.estimates(org_id, id) on delete cascade,
  foreign key (org_id, job_card_id) references public.job_cards(org_id, id) on delete cascade,
  foreign key (org_id, invoice_id) references public.invoices(org_id, id) on delete cascade,
  foreign key (org_id, credit_note_id) references public.credit_notes(org_id, id) on delete cascade,
  foreign key (org_id, part_id) references public.parts(org_id, id),
  foreign key (org_id, service_id) references public.services(org_id, id),
  foreign key (org_id, technician_id) references public.technicians(org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates(org_id, id)
);
create index doc_lines_estimate on public.doc_lines(estimate_id) where estimate_id is not null;
create index doc_lines_job_card on public.doc_lines(job_card_id) where job_card_id is not null;
create index doc_lines_invoice on public.doc_lines(invoice_id) where invoice_id is not null;
create index doc_lines_credit_note on public.doc_lines(credit_note_id) where credit_note_id is not null;
create index doc_lines_source on public.doc_lines(source_line_id) where source_line_id is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  kind text not null check (kind in ('payment','deposit','refund')),
  customer_id uuid not null,
  invoice_id uuid,
  estimate_id uuid,
  job_card_id uuid,
  credit_note_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  method_id uuid,
  method_name text not null,
  reference text,
  paid_at timestamptz not null default now(),
  notes text,
  received_by uuid,
  received_by_name text,
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (kind <> 'payment' or invoice_id is not null),
  check (kind <> 'deposit' or num_nonnulls(invoice_id, estimate_id, job_card_id) >= 1),
  check (kind <> 'refund' or num_nonnulls(invoice_id, estimate_id, job_card_id) >= 1),
  check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, customer_id) references public.customers(org_id, id),
  foreign key (org_id, invoice_id) references public.invoices(org_id, id),
  foreign key (org_id, estimate_id) references public.estimates(org_id, id),
  foreign key (org_id, job_card_id) references public.job_cards(org_id, id),
  foreign key (org_id, credit_note_id) references public.credit_notes(org_id, id),
  foreign key (org_id, method_id) references public.payment_methods(org_id, id)
);
create index payments_invoice on public.payments(org_id, invoice_id);
create index payments_job_card on public.payments(org_id, job_card_id);
create index payments_estimate on public.payments(org_id, estimate_id);
create index payments_customer on public.payments(org_id, customer_id);
create index payments_paid_at on public.payments(org_id, paid_at desc);
create unique index payments_org_number on public.payments(org_id, number);

-- An issued invoice is immutable. Only these columns may still change:
-- sent_at (sending), and the cancellation columns.
create or replace function private.guard_issued_invoice()
returns trigger language plpgsql as $$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if old.status = 'cancelled' then
    raise exception using message = 'bsg.invoice_locked';
  end if;
  if (to_jsonb(new) - array['sent_at','status','cancelled_at','cancelled_by','cancel_reason','updated_at'])
     is distinct from (to_jsonb(old) - array['sent_at','status','cancelled_at','cancelled_by','cancel_reason','updated_at'])
     or new.status not in ('issued','cancelled') then
    raise exception using message = 'bsg.invoice_locked';
  end if;
  return new;
end $$;
create trigger invoices_guard before update on public.invoices
  for each row execute function private.guard_issued_invoice();

create or replace function private.guard_issued_lines()
returns trigger language plpgsql as $$
declare
  v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
  v_status text;
begin
  if v_inv is not null then
    select status into v_status from public.invoices where id = v_inv;
    if v_status is not null and v_status <> 'draft' then
      raise exception using message = 'bsg.invoice_locked';
    end if;
  end if;
  if tg_op = 'DELETE' and old.credit_note_id is not null then
    raise exception using message = 'bsg.credit_note_locked';
  end if;
  return coalesce(new, old);
end $$;
create trigger doc_lines_guard before insert or update or delete on public.doc_lines
  for each row execute function private.guard_issued_lines();

-- -----------------------------------------------------------------------------
-- Totals engine (see src/lib/totals.ts — the two must stay identical)
-- -----------------------------------------------------------------------------
create or replace function private.allocate(p_amount numeric, p_weights numeric[])
returns numeric[] language plpgsql immutable as $$
declare
  n int := coalesce(array_length(p_weights, 1), 0);
  s numeric := 0;
  base numeric[] := '{}';
  v_left numeric;
  i int;
  r record;
begin
  if n = 0 then
    return '{}';
  end if;
  for i in 1..n loop
    s := s + p_weights[i];
  end loop;
  if s = 0 or p_amount = 0 then
    return array_fill(0::numeric, array[n]);
  end if;
  v_left := p_amount;
  for i in 1..n loop
    base[i] := div(p_amount * p_weights[i], s);
    v_left := v_left - base[i];
  end loop;
  for r in
    select ord::int as idx
    from unnest(p_weights) with ordinality as t(w, ord)
    order by mod(p_amount * w, s) desc, ord asc
  loop
    exit when v_left <= 0;
    base[r.idx] := base[r.idx] + 1;
    v_left := v_left - 1;
  end loop;
  return base;
end $$;

create or replace function private.calc_totals(
  p_lines jsonb, p_discount_type text, p_discount_value numeric, p_vat_registered boolean
) returns jsonb language plpgsql immutable as $$
declare
  n int := coalesce(jsonb_array_length(p_lines), 0);
  gross numeric[] := '{}'; disc numeric[] := '{}'; net numeric[] := '{}'; rate numeric[] := '{}';
  alloc numeric[]; taxable numeric[] := '{}'; vat numeric[] := '{}';
  l jsonb; q numeric; pr numeric; dbp numeric; rbp numeric;
  subtotal numeric := 0; dd numeric := 0; pbp numeric; amt numeric;
  rates numeric[] := '{}'; r numeric; idx int[]; w numeric[]; parts numeric[]; gt numeric; gv numeric;
  breakdown jsonb := '[]'; out_lines jsonb := '[]';
  vat_total numeric := 0; gross_total numeric := 0; disc_total numeric := 0;
  i int; k int;
begin
  for i in 1..n loop
    l := p_lines -> (i - 1);
    q := round(greatest(coalesce((l ->> 'quantity')::numeric, 0), 0) * 100);
    pr := round(greatest(coalesce((l ->> 'unit_price')::numeric, 0), 0) * 100);
    dbp := round(least(100, greatest(0, coalesce((l ->> 'discount_pct')::numeric, 0))) * 100);
    rbp := case when p_vat_registered then round(greatest(0, coalesce((l ->> 'tax_rate')::numeric, 0)) * 100) else 0 end;
    gross[i] := div(2 * q * pr + 100, 200);
    disc[i] := div(2 * gross[i] * dbp + 10000, 20000);
    net[i] := gross[i] - disc[i];
    rate[i] := rbp;
    subtotal := subtotal + net[i];
    gross_total := gross_total + gross[i];
    disc_total := disc_total + disc[i];
  end loop;

  if p_discount_type = 'percent' then
    pbp := round(least(100, greatest(0, coalesce(p_discount_value, 0))) * 100);
    dd := div(2 * subtotal * pbp + 10000, 20000);
  elsif p_discount_type = 'amount' then
    amt := round(greatest(0, coalesce(p_discount_value, 0)) * 100);
    dd := least(amt, subtotal);
  end if;

  alloc := private.allocate(dd, net);
  for i in 1..n loop
    taxable[i] := net[i] - alloc[i];
    vat[i] := 0;
    if not (rate[i] = any(rates)) then
      rates := rates || rate[i];
    end if;
  end loop;

  foreach r in array rates loop
    idx := '{}'; w := '{}'; gt := 0;
    for i in 1..n loop
      if rate[i] = r then
        idx := idx || i;
        w := w || taxable[i];
        gt := gt + taxable[i];
      end if;
    end loop;
    gv := div(2 * gt * r + 10000, 20000);
    parts := private.allocate(gv, w);
    for k in 1..array_length(idx, 1) loop
      vat[idx[k]] := parts[k];
    end loop;
    vat_total := vat_total + gv;
    breakdown := breakdown || jsonb_build_object(
      'rate', round(r / 100.0, 2), 'taxable', round(gt / 100.0, 2), 'vat', round(gv / 100.0, 2));
  end loop;

  for i in 1..n loop
    out_lines := out_lines || jsonb_build_object(
      'gross', round(gross[i] / 100.0, 2),
      'discount', round(disc[i] / 100.0, 2),
      'net', round(net[i] / 100.0, 2),
      'doc_discount', round(alloc[i] / 100.0, 2),
      'taxable', round(taxable[i] / 100.0, 2),
      'vat', round(vat[i] / 100.0, 2),
      'total', round((taxable[i] + vat[i]) / 100.0, 2));
  end loop;

  return jsonb_build_object(
    'lines', out_lines,
    'gross', round(gross_total / 100.0, 2),
    'line_discounts', round(disc_total / 100.0, 2),
    'subtotal', round(subtotal / 100.0, 2),
    'doc_discount', round(dd / 100.0, 2),
    'taxable', round((subtotal - dd) / 100.0, 2),
    'vat_total', round(vat_total / 100.0, 2),
    'total', round((subtotal - dd + vat_total) / 100.0, 2),
    'vat_breakdown', breakdown);
end $$;

-- Validates and (re)writes the lines of a draft document, returns its totals.
-- Lines reference the org's own parts, services, technicians and tax rates only.
create or replace function private.write_lines(
  p_parent text, p_parent_id uuid, p_org uuid, p_lines jsonb, p_discount_type text, p_discount_value numeric
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_vat_reg boolean;
  v_default_rate record;
  v_norm jsonb := '[]';
  v_line jsonb;
  v_pos int := 0;
  v_kind text; v_qty numeric; v_price numeric; v_disc numeric;
  v_part record; v_service record; v_rate record; v_tech uuid;
  v_desc text;
  v_totals jsonb;
  v_amounts jsonb;
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' then
    raise exception using message = 'bsg.validation', detail = 'lines';
  end if;
  if p_discount_type is not null and p_discount_type not in ('percent','amount') then
    raise exception using message = 'bsg.validation', detail = 'discount_type';
  end if;
  if p_discount_type = 'percent' and (p_discount_value < 0 or p_discount_value > 100) then
    raise exception using message = 'bsg.validation', detail = 'discount_value';
  end if;
  select vat_registered into v_vat_reg from public.organizations where id = p_org;
  select id, rate into v_default_rate from public.tax_rates where org_id = p_org and is_default;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    v_pos := v_pos + 1;
    v_kind := coalesce(v_line ->> 'kind', 'other');
    if v_kind not in ('part','labor','service','other') then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos || ': kind';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;
    v_disc := coalesce((v_line ->> 'discount_pct')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 2) then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos || ': quantity';
    end if;
    if v_price is null or v_price < 0 or v_price <> round(v_price, 2) then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos || ': unit_price';
    end if;
    if v_disc < 0 or v_disc > 100 or v_disc <> round(v_disc, 2) then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos || ': discount_pct';
    end if;

    select null::uuid as id, null::text as name, null::text as part_number, null::uuid as tax_rate_id into v_part;
    select null::uuid as id, null::text as name, null::uuid as tax_rate_id into v_service;
    v_tech := null;
    if v_line ->> 'part_id' is not null then
      select id, name, part_number, tax_rate_id into v_part from public.parts
       where id = (v_line ->> 'part_id')::uuid and org_id = p_org;
      if v_part.id is null then
        raise exception using message = 'bsg.not_found', detail = 'part';
      end if;
    end if;
    if v_line ->> 'service_id' is not null then
      select id, name, tax_rate_id into v_service from public.services
       where id = (v_line ->> 'service_id')::uuid and org_id = p_org;
      if v_service.id is null then
        raise exception using message = 'bsg.not_found', detail = 'service';
      end if;
    end if;
    if v_line ->> 'technician_id' is not null then
      select id into v_tech from public.technicians
       where id = (v_line ->> 'technician_id')::uuid and org_id = p_org;
      if v_tech is null then
        raise exception using message = 'bsg.not_found', detail = 'technician';
      end if;
    end if;
    select id, rate into v_rate from public.tax_rates
     where org_id = p_org and id = coalesce((v_line ->> 'tax_rate_id')::uuid, v_part.tax_rate_id,
       v_service.tax_rate_id, v_default_rate.id);
    if (v_line ->> 'tax_rate_id') is not null and v_rate.id is null then
      raise exception using message = 'bsg.not_found', detail = 'tax_rate';
    end if;

    v_desc := coalesce(nullif(btrim(v_line ->> 'description'), ''), v_part.name, v_service.name);
    if v_desc is null then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos || ': description';
    end if;

    v_norm := v_norm || jsonb_build_object(
      'kind', v_kind, 'part_id', v_part.id, 'service_id', v_service.id, 'technician_id', v_tech,
      'description', v_desc,
      'part_number', coalesce(nullif(btrim(v_line ->> 'part_number'), ''), v_part.part_number),
      'quantity', v_qty, 'unit_price', v_price, 'discount_pct', v_disc,
      'tax_rate_id', v_rate.id, 'tax_rate', case when v_vat_reg then coalesce(v_rate.rate, 0) else 0 end);
  end loop;

  v_totals := private.calc_totals(v_norm, p_discount_type, p_discount_value, v_vat_reg);

  if p_parent = 'estimate' then delete from public.doc_lines where estimate_id = p_parent_id;
  elsif p_parent = 'job_card' then delete from public.doc_lines where job_card_id = p_parent_id;
  elsif p_parent = 'invoice' then delete from public.doc_lines where invoice_id = p_parent_id;
  else raise exception using message = 'bsg.validation', detail = 'parent';
  end if;

  for i in 1..jsonb_array_length(v_norm) loop
    v_line := v_norm -> (i - 1);
    v_amounts := v_totals -> 'lines' -> (i - 1);
    insert into public.doc_lines(org_id, estimate_id, job_card_id, invoice_id, position, kind, part_id, service_id,
      technician_id, description, part_number, quantity, unit_price, discount_pct, tax_rate_id, tax_rate,
      gross, discount_amount, net, doc_discount, taxable, vat, total)
    values (p_org,
      case when p_parent = 'estimate' then p_parent_id end,
      case when p_parent = 'job_card' then p_parent_id end,
      case when p_parent = 'invoice' then p_parent_id end,
      i, v_line ->> 'kind', (v_line ->> 'part_id')::uuid, (v_line ->> 'service_id')::uuid,
      (v_line ->> 'technician_id')::uuid, v_line ->> 'description', v_line ->> 'part_number',
      (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_price')::numeric, (v_line ->> 'discount_pct')::numeric,
      (v_line ->> 'tax_rate_id')::uuid, (v_line ->> 'tax_rate')::numeric,
      (v_amounts ->> 'gross')::numeric, (v_amounts ->> 'discount')::numeric, (v_amounts ->> 'net')::numeric,
      (v_amounts ->> 'doc_discount')::numeric, (v_amounts ->> 'taxable')::numeric, (v_amounts ->> 'vat')::numeric,
      (v_amounts ->> 'total')::numeric);
  end loop;
  return v_totals;
end $$;

-- Copies the lines of one document to another (estimate → job card → invoice).
-- Amounts are recomputed by write_lines so the target is always consistent.
create or replace function private.lines_as_json(p_parent text, p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind, 'part_id', part_id, 'service_id', service_id, 'technician_id', technician_id,
    'description', description, 'part_number', part_number, 'quantity', quantity, 'unit_price', unit_price,
    'discount_pct', discount_pct, 'tax_rate_id', tax_rate_id) order by position), '[]')
  from public.doc_lines
  where case p_parent when 'estimate' then estimate_id when 'job_card' then job_card_id
    when 'invoice' then invoice_id end = p_id
$$;

-- -----------------------------------------------------------------------------
-- Balances
-- -----------------------------------------------------------------------------
create or replace function private.invoice_amounts(p_invoice uuid)
returns table(total numeric, credited numeric, paid numeric, refunded numeric, balance numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.total,
    coalesce((select sum(cn.total) from public.credit_notes cn where cn.invoice_id = i.id), 0),
    coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
      and p.kind in ('payment','deposit')), 0),
    coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
      and p.kind = 'refund'), 0),
    i.total
      - coalesce((select sum(cn.total) from public.credit_notes cn where cn.invoice_id = i.id), 0)
      - coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
          and p.kind in ('payment','deposit')), 0)
      + coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
          and p.kind = 'refund'), 0)
  from public.invoices i where i.id = p_invoice
$$;

-- -----------------------------------------------------------------------------
-- RLS: documents are readable according to permissions; never writable
-- directly (all writes go through the functions of the next migration).
-- -----------------------------------------------------------------------------
create or replace function public.is_my_job_card(p_job_card uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.job_cards jc join public.technicians t on t.id = jc.technician_id
    where jc.id = p_job_card and t.user_id = auth.uid() and t.active
      and public.has_perm(jc.org_id, 'job_cards.progress')
  )
$$;

alter table public.estimates enable row level security;
alter table public.job_cards enable row level security;
alter table public.invoices enable row level security;
alter table public.credit_notes enable row level security;
alter table public.doc_lines enable row level security;
alter table public.payments enable row level security;

revoke all on public.estimates, public.job_cards, public.invoices, public.credit_notes, public.doc_lines,
  public.payments from anon, authenticated;
grant select on public.estimates, public.job_cards, public.invoices, public.credit_notes, public.doc_lines,
  public.payments to authenticated;

create policy estimates_select on public.estimates for select to authenticated
  using (public.has_perm(org_id, 'estimates.view'));
create policy job_cards_select on public.job_cards for select to authenticated
  using (public.has_perm(org_id, 'job_cards.view') or public.is_my_job_card(id));
create policy invoices_select on public.invoices for select to authenticated
  using (public.has_perm(org_id, 'invoices.view'));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (public.has_perm(org_id, 'invoices.view'));
create policy payments_select on public.payments for select to authenticated
  using (public.has_perm(org_id, 'invoices.view'));
create policy doc_lines_select on public.doc_lines for select to authenticated
  using (
    (invoice_id is not null and public.has_perm(org_id, 'invoices.view'))
    or (credit_note_id is not null and public.has_perm(org_id, 'invoices.view'))
    or (estimate_id is not null and public.has_perm(org_id, 'estimates.view'))
    or (job_card_id is not null and (public.has_perm(org_id, 'job_cards.view') or public.is_my_job_card(job_card_id)))
  );

-- -----------------------------------------------------------------------------
-- Read views (security_invoker: the caller's RLS applies to every table)
-- -----------------------------------------------------------------------------
create view public.v_invoices with (security_invoker = true) as
with amounts as (
  select i.id,
    coalesce((select sum(cn.total) from public.credit_notes cn where cn.invoice_id = i.id), 0) as credited,
    coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
      and p.kind in ('payment','deposit')), 0) as paid,
    coalesce((select sum(p.amount) from public.payments p where p.invoice_id = i.id and p.voided_at is null
      and p.kind = 'refund'), 0) as refunded,
    (now() at time zone o.timezone)::date as today
  from public.invoices i join public.organizations o on o.id = i.org_id
)
select i.*,
  c.display_name as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
  c.email as customer_email, c.type as customer_type,
  v.plate_emirate, v.plate_code, v.plate_number, v.make, v.model, v.year as vehicle_year, v.vin,
  jc.number as job_card_number,
  a.credited, a.paid, a.refunded,
  i.total - a.credited - a.paid + a.refunded as balance,
  case
    when i.status = 'cancelled' then 'cancelled'
    when i.status = 'draft' then 'draft'
    when i.total - a.credited - a.paid + a.refunded < 0 then 'refund_due'
    when i.total - a.credited - a.paid + a.refunded = 0 then 'paid'
    when i.due_date < a.today then 'overdue'
    when a.paid - a.refunded > 0 then 'partially_paid'
    when i.sent_at is not null then 'sent'
    else 'unpaid'
  end as display_status,
  case when i.status = 'issued' and i.total - a.credited - a.paid + a.refunded > 0 and i.due_date < a.today
    then a.today - i.due_date else 0 end as days_overdue
from public.invoices i
join amounts a on a.id = i.id
left join public.customers c on c.id = i.customer_id
left join public.vehicles v on v.id = i.vehicle_id
left join public.job_cards jc on jc.id = i.job_card_id;

create view public.v_estimates with (security_invoker = true) as
select e.*,
  c.display_name as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
  c.email as customer_email,
  v.plate_emirate, v.plate_code, v.plate_number, v.make, v.model, v.year as vehicle_year,
  case when e.status in ('draft','sent','pending') and e.valid_until < (now() at time zone o.timezone)::date
    then 'expired' else e.status end as display_status,
  coalesce((select sum(case when p.kind = 'refund' then -p.amount else p.amount end) from public.payments p
    where p.estimate_id = e.id and p.voided_at is null and p.kind in ('deposit','refund')), 0) as deposits
from public.estimates e
join public.organizations o on o.id = e.org_id
left join public.customers c on c.id = e.customer_id
left join public.vehicles v on v.id = e.vehicle_id;

create view public.v_job_cards with (security_invoker = true) as
select jc.*,
  c.display_name as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
  v.plate_emirate, v.plate_code, v.plate_number, v.make, v.model, v.year as vehicle_year, v.vin,
  t.name as technician_name,
  e.number as estimate_number,
  (jc.promised_at is not null and jc.promised_at < now() and jc.status in ('open','in_progress','waiting_parts'))
    as is_delayed,
  coalesce((select sum(case when p.kind = 'refund' then -p.amount else p.amount end) from public.payments p
    where p.job_card_id = jc.id and p.voided_at is null and p.kind in ('deposit','refund')), 0) as deposits
from public.job_cards jc
left join public.customers c on c.id = jc.customer_id
left join public.vehicles v on v.id = jc.vehicle_id
left join public.technicians t on t.id = jc.technician_id
left join public.estimates e on e.id = jc.estimate_id;

create view public.v_payments with (security_invoker = true) as
select p.*, c.display_name as customer_name, c.phone as customer_phone, c.whatsapp as customer_whatsapp,
  c.email as customer_email,
  i.number as invoice_number, e.number as estimate_number, jc.number as job_card_number,
  cn.number as credit_note_number
from public.payments p
left join public.customers c on c.id = p.customer_id
left join public.invoices i on i.id = p.invoice_id
left join public.estimates e on e.id = p.estimate_id
left join public.job_cards jc on jc.id = p.job_card_id
left join public.credit_notes cn on cn.id = p.credit_note_id;

create view public.v_credit_notes with (security_invoker = true) as
select cn.*, c.display_name as customer_name, i.number as invoice_number
from public.credit_notes cn
left join public.customers c on c.id = cn.customer_id
left join public.invoices i on i.id = cn.invoice_id;

revoke all on public.v_invoices, public.v_estimates, public.v_job_cards, public.v_payments, public.v_credit_notes from anon;
grant select on public.v_invoices, public.v_estimates, public.v_job_cards, public.v_payments, public.v_credit_notes
  to authenticated;
