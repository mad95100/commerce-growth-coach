-- =============================================================================
-- BS Garage — catalog (parts, services), stock, suppliers, purchase orders
-- =============================================================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  contact_name text,
  phone text,
  email text,
  address text,
  trn text,
  payment_terms text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create trigger suppliers_touch before update on public.suppliers
  for each row execute function private.touch_updated_at();

create table public.parts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null check (length(btrim(sku)) between 1 and 64),
  part_number text,
  oem_ref text,
  name text not null check (length(btrim(name)) between 1 and 200),
  brand text,
  category text,
  description text,
  unit text not null default 'pcs' check (length(unit) between 1 and 12),
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  tax_rate_id uuid,
  min_stock numeric(12,2) not null default 0 check (min_stock >= 0),
  location text,
  barcode text,
  supplier_id uuid,
  track_stock boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates(org_id, id),
  foreign key (org_id, supplier_id) references public.suppliers(org_id, id)
);
create unique index parts_org_sku on public.parts(org_id, upper(sku));
create unique index parts_org_barcode on public.parts(org_id, barcode) where barcode is not null and barcode <> '';
create index parts_org_part_number on public.parts(org_id, upper(part_number));
create trigger parts_touch before update on public.parts
  for each row execute function private.touch_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text,
  name text not null check (length(btrim(name)) between 1 and 200),
  category text,
  description text,
  pricing text not null default 'fixed' check (pricing in ('fixed','hourly')),
  price numeric(12,2) not null default 0 check (price >= 0),
  labor_rate numeric(12,2) check (labor_rate is null or labor_rate >= 0),
  duration_hours numeric(6,2) check (duration_hours is null or duration_hours > 0),
  tax_rate_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates(org_id, id),
  check (pricing = 'fixed' or (labor_rate is not null and duration_hours is not null))
);
create trigger services_touch before update on public.services
  for each row execute function private.touch_updated_at();

create table public.stock_levels (
  org_id uuid not null references public.organizations(id) on delete cascade,
  part_id uuid not null,
  branch_id uuid not null,
  quantity numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (part_id, branch_id),
  foreign key (org_id, part_id) references public.parts(org_id, id),
  foreign key (org_id, branch_id) references public.branches(org_id, id)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  part_id uuid not null,
  quantity numeric(12,2) not null check (quantity <> 0),
  balance_after numeric(12,2) not null,
  kind text not null check (kind in ('stock_in','stock_out','adjustment','count','sale','sale_reversal','purchase_receipt')),
  unit_cost numeric(12,2),
  reference_type text,
  reference_id uuid,
  reference_number text,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  foreign key (org_id, part_id) references public.parts(org_id, id),
  foreign key (org_id, branch_id) references public.branches(org_id, id)
);
create index stock_movements_part on public.stock_movements(org_id, part_id, created_at desc);

create table public.supplier_parts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  part_id uuid not null,
  supplier_sku text,
  price numeric(12,2) check (price is null or price >= 0),
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, part_id),
  foreign key (org_id, supplier_id) references public.suppliers(org_id, id) on delete cascade,
  foreign key (org_id, part_id) references public.parts(org_id, id) on delete cascade
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  number text not null,
  supplier_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft','ordered','partially_received','received','cancelled')),
  order_date date,
  expected_date date,
  notes text,
  subtotal numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, number),
  foreign key (org_id, branch_id) references public.branches(org_id, id),
  foreign key (org_id, supplier_id) references public.suppliers(org_id, id)
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  position int not null,
  part_id uuid,
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  tax_rate numeric(5,2) not null default 0,
  received_quantity numeric(12,2) not null default 0 check (received_quantity >= 0),
  net numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  foreign key (org_id, purchase_order_id) references public.purchase_orders(org_id, id) on delete cascade,
  foreign key (org_id, part_id) references public.parts(org_id, id)
);

-- -----------------------------------------------------------------------------
-- Stock movement: the ONLY way stock quantities change.
-- -----------------------------------------------------------------------------
create or replace function private.move_stock(
  p_org uuid, p_branch uuid, p_part uuid, p_qty numeric, p_kind text,
  p_ref_type text default null, p_ref_id uuid default null, p_ref_number text default null,
  p_note text default null, p_unit_cost numeric default null
) returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_track boolean;
  v_balance numeric;
begin
  select track_stock into v_track from public.parts where id = p_part and org_id = p_org;
  if v_track is null then
    raise exception using message = 'bsg.not_found', detail = 'part';
  end if;
  if not v_track or p_qty = 0 then
    return null;
  end if;
  insert into public.stock_levels(org_id, part_id, branch_id, quantity)
  values (p_org, p_part, p_branch, p_qty)
  on conflict (part_id, branch_id) do update
    set quantity = public.stock_levels.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_balance;
  insert into public.stock_movements(org_id, branch_id, part_id, quantity, balance_after, kind, unit_cost,
    reference_type, reference_id, reference_number, note, created_by, created_by_name)
  values (p_org, p_branch, p_part, p_qty, v_balance, p_kind, p_unit_cost, p_ref_type, p_ref_id, p_ref_number,
    p_note, auth.uid(), private.actor_name(p_org));
  return v_balance;
end $$;

create or replace function private.branch_or_default(p_org uuid, p_branch uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if p_branch is not null then
    select id into v from public.branches where id = p_branch and org_id = p_org and active;
    if v is null then
      raise exception using message = 'bsg.not_found', detail = 'branch';
    end if;
    return v;
  end if;
  select id into v from public.branches where org_id = p_org and is_default;
  if v is null then
    select id into v from public.branches where org_id = p_org and active order by created_at limit 1;
  end if;
  return v;
end $$;

-- Manual stock operations: receive, remove, adjust by a delta, or record a
-- physical count (sets the quantity; the movement records the difference).
create or replace function public.adjust_stock(p jsonb)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_branch uuid;
  v_part uuid := (p ->> 'part_id')::uuid;
  v_kind text := p ->> 'kind';
  v_qty numeric := (p ->> 'quantity')::numeric;
  v_current numeric;
  v_delta numeric;
  v_name text;
  v_balance numeric;
begin
  perform private.assert_perm(v_org, 'stock.adjust');
  v_branch := private.branch_or_default(v_org, (p ->> 'branch_id')::uuid);
  select name into v_name from public.parts where id = v_part and org_id = v_org;
  if v_name is null then
    raise exception using message = 'bsg.not_found', detail = 'part';
  end if;
  if v_qty is null or v_qty <> round(v_qty, 2) then
    raise exception using message = 'bsg.validation', detail = 'quantity';
  end if;
  if v_kind = 'count' then
    if v_qty < 0 then
      raise exception using message = 'bsg.validation', detail = 'quantity';
    end if;
    select coalesce(quantity, 0) into v_current from public.stock_levels where part_id = v_part and branch_id = v_branch;
    v_delta := v_qty - coalesce(v_current, 0);
  elsif v_kind = 'stock_in' then
    if v_qty <= 0 then raise exception using message = 'bsg.validation', detail = 'quantity'; end if;
    v_delta := v_qty;
  elsif v_kind = 'stock_out' then
    if v_qty <= 0 then raise exception using message = 'bsg.validation', detail = 'quantity'; end if;
    v_delta := -v_qty;
  elsif v_kind = 'adjustment' then
    if v_qty = 0 then raise exception using message = 'bsg.validation', detail = 'quantity'; end if;
    v_delta := v_qty;
  else
    raise exception using message = 'bsg.validation', detail = 'kind';
  end if;
  if v_delta = 0 then
    select quantity into v_balance from public.stock_levels where part_id = v_part and branch_id = v_branch;
    return coalesce(v_balance, 0);
  end if;
  v_balance := private.move_stock(v_org, v_branch, v_part, v_delta, v_kind, null, null, null,
    nullif(btrim(p ->> 'note'), ''), (p ->> 'unit_cost')::numeric);
  perform private.log(v_org, 'stock.' || v_kind, 'part', v_part, v_name,
    jsonb_build_object('quantity', v_delta, 'balance_after', v_balance, 'note', p ->> 'note'));
  return v_balance;
end $$;

-- Price changes and new parts/services are audited.
create or replace function private.audit_catalog()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_entity text := case tg_table_name when 'parts' then 'part' else 'service' end;
  v_changed jsonb := '{}';
  k text;
begin
  if tg_op = 'INSERT' then
    perform private.log(new.org_id, v_entity || '.created', v_entity, new.id, new.name, '{}');
    return new;
  end if;
  for k in select unnest(case tg_table_name
      when 'parts' then array['selling_price','purchase_price','tax_rate_id']
      else array['price','labor_rate','duration_hours','pricing','tax_rate_id'] end) loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if v_changed <> '{}' then
    perform private.log(new.org_id, v_entity || '.price_changed', v_entity, new.id, new.name, v_changed);
  end if;
  v_changed := '{}';
  for k in select key from jsonb_each(to_jsonb(new)) loop
    if k not in ('updated_at','selling_price','purchase_price','price','labor_rate','duration_hours','pricing','tax_rate_id')
       and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if v_changed <> '{}' then
    perform private.log(new.org_id, v_entity || '.updated', v_entity, new.id, new.name, v_changed);
  end if;
  return new;
end $$;
create trigger parts_audit after insert or update on public.parts
  for each row execute function private.audit_catalog();
create trigger services_audit after insert or update on public.services
  for each row execute function private.audit_catalog();

create or replace function private.audit_supplier()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform private.log(new.org_id, 'supplier.created', 'supplier', new.id, new.name, '{}');
  end if;
  return new;
end $$;
create trigger suppliers_audit after insert on public.suppliers
  for each row execute function private.audit_supplier();

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------
create or replace function public.save_purchase_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_id uuid := (p ->> 'id')::uuid;
  v_status text;
  v_line jsonb;
  v_pos int := 0;
  v_part record;
  v_qty numeric; v_cost numeric; v_rate numeric; v_net numeric; v_vat numeric;
  v_sub numeric := 0; v_vat_total numeric := 0;
  v_vat_reg boolean;
begin
  perform private.assert_perm(v_org, 'purchases.manage');
  if not exists (select 1 from public.suppliers where id = (p ->> 'supplier_id')::uuid and org_id = v_org) then
    raise exception using message = 'bsg.not_found', detail = 'supplier';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception using message = 'bsg.validation', detail = 'lines';
  end if;
  select vat_registered into v_vat_reg from public.organizations where id = v_org;

  if v_id is null then
    insert into public.purchase_orders(org_id, branch_id, number, supplier_id, order_date, expected_date, notes, created_by)
    values (v_org, private.branch_or_default(v_org, (p ->> 'branch_id')::uuid), private.next_number(v_org, 'purchase_order'),
      (p ->> 'supplier_id')::uuid, coalesce((p ->> 'order_date')::date, private.today(v_org)),
      (p ->> 'expected_date')::date, nullif(p ->> 'notes', ''), auth.uid())
    returning id into v_id;
    perform private.log(v_org, 'purchase_order.created', 'purchase_order', v_id,
      (select number from public.purchase_orders where id = v_id), '{}');
  else
    select status into v_status from public.purchase_orders where id = v_id and org_id = v_org for update;
    if v_status is null then raise exception using message = 'bsg.not_found'; end if;
    if v_status <> 'draft' then raise exception using message = 'bsg.invalid_state', detail = v_status; end if;
    update public.purchase_orders set supplier_id = (p ->> 'supplier_id')::uuid,
      branch_id = private.branch_or_default(v_org, (p ->> 'branch_id')::uuid),
      order_date = coalesce((p ->> 'order_date')::date, order_date), expected_date = (p ->> 'expected_date')::date,
      notes = nullif(p ->> 'notes', ''), updated_at = now()
    where id = v_id;
    delete from public.purchase_order_lines where purchase_order_id = v_id;
    perform private.log(v_org, 'purchase_order.updated', 'purchase_order', v_id,
      (select number from public.purchase_orders where id = v_id), '{}');
  end if;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_pos := v_pos + 1;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_cost := coalesce((v_line ->> 'unit_cost')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 2) or v_cost < 0 or v_cost <> round(v_cost, 2) then
      raise exception using message = 'bsg.validation', detail = 'line ' || v_pos;
    end if;
    select null::uuid as id, null::text as name, null::numeric as rate into v_part;
    if v_line ->> 'part_id' is not null then
      select p2.id, p2.name, coalesce(tr.rate, dtr.rate, 0) as rate into v_part
      from public.parts p2
      left join public.tax_rates tr on tr.id = p2.tax_rate_id
      left join public.tax_rates dtr on dtr.org_id = v_org and dtr.is_default
      where p2.id = (v_line ->> 'part_id')::uuid and p2.org_id = v_org;
      if v_part.id is null then raise exception using message = 'bsg.not_found', detail = 'part'; end if;
    end if;
    v_rate := case when v_vat_reg then coalesce(v_part.rate,
      (select rate from public.tax_rates where org_id = v_org and is_default), 0) else 0 end;
    v_net := round(v_qty * v_cost, 2);
    v_vat := round(v_net * v_rate / 100, 2);
    v_sub := v_sub + v_net;
    v_vat_total := v_vat_total + v_vat;
    insert into public.purchase_order_lines(org_id, purchase_order_id, position, part_id, description, quantity,
      unit_cost, tax_rate, net, vat, total)
    values (v_org, v_id, v_pos, v_part.id,
      coalesce(nullif(btrim(v_line ->> 'description'), ''), v_part.name, 'Item'), v_qty, v_cost, v_rate,
      v_net, v_vat, v_net + v_vat);
  end loop;

  update public.purchase_orders set subtotal = v_sub, vat_total = v_vat_total, total = v_sub + v_vat_total
  where id = v_id;
  return v_id;
end $$;

create or replace function public.set_purchase_order_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
begin
  select * into v from public.purchase_orders where id = p_id for update;
  if v.id is null then raise exception using message = 'bsg.not_found'; end if;
  perform private.assert_perm(v.org_id, 'purchases.manage');
  if not (
    (v.status = 'draft' and p_status in ('ordered','cancelled'))
    or (v.status = 'ordered' and p_status in ('cancelled','draft'))
  ) then
    raise exception using message = 'bsg.invalid_state', detail = v.status || '→' || p_status;
  end if;
  update public.purchase_orders set status = p_status, updated_at = now(),
    order_date = case when p_status = 'ordered' then coalesce(order_date, private.today(v.org_id)) else order_date end
  where id = p_id;
  perform private.log(v.org_id, 'purchase_order.' || p_status, 'purchase_order', p_id, v.number, '{}');
end $$;

-- Receiving goods: stock in at the ordered cost, latest cost becomes the
-- part's purchase price and the supplier's price for that part.
create or replace function public.receive_purchase_order(p jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_line jsonb;
  l record;
  v_qty numeric;
  v_all boolean;
  v_any boolean := false;
begin
  select * into v from public.purchase_orders where id = (p ->> 'id')::uuid for update;
  if v.id is null then raise exception using message = 'bsg.not_found'; end if;
  perform private.assert_perm(v.org_id, 'purchases.manage');
  if v.status not in ('ordered','partially_received') then
    raise exception using message = 'bsg.invalid_state', detail = v.status;
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    select * into l from public.purchase_order_lines
     where id = (v_line ->> 'line_id')::uuid and purchase_order_id = v.id for update;
    if l.id is null then raise exception using message = 'bsg.not_found', detail = 'line'; end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty = 0 then continue; end if;
    if v_qty < 0 or v_qty <> round(v_qty, 2) or l.received_quantity + v_qty > l.quantity then
      raise exception using message = 'bsg.receive_exceeds_ordered', detail = l.description;
    end if;
    update public.purchase_order_lines set received_quantity = received_quantity + v_qty where id = l.id;
    v_any := true;
    if l.part_id is not null then
      perform private.move_stock(v.org_id, v.branch_id, l.part_id, v_qty, 'purchase_receipt',
        'purchase_order', v.id, v.number, null, l.unit_cost);
      update public.parts set purchase_price = l.unit_cost where id = l.part_id and purchase_price <> l.unit_cost;
      insert into public.supplier_parts(org_id, supplier_id, part_id, price, updated_at)
      values (v.org_id, v.supplier_id, l.part_id, l.unit_cost, now())
      on conflict (supplier_id, part_id) do update set price = excluded.price, updated_at = now();
    end if;
  end loop;
  if not v_any then
    raise exception using message = 'bsg.validation', detail = 'lines';
  end if;
  select bool_and(received_quantity >= quantity) into v_all from public.purchase_order_lines where purchase_order_id = v.id;
  update public.purchase_orders set status = case when v_all then 'received' else 'partially_received' end,
    updated_at = now() where id = v.id;
  perform private.log(v.org_id, 'purchase_order.received', 'purchase_order', v.id, v.number, p -> 'lines');
end $$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.parts enable row level security;
alter table public.services enable row level security;
alter table public.stock_levels enable row level security;
alter table public.stock_movements enable row level security;
alter table public.supplier_parts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

revoke all on public.suppliers, public.parts, public.services, public.stock_levels, public.stock_movements,
  public.supplier_parts, public.purchase_orders, public.purchase_order_lines from anon, authenticated;
grant select on public.suppliers, public.parts, public.services, public.stock_levels, public.stock_movements,
  public.supplier_parts, public.purchase_orders, public.purchase_order_lines to authenticated;

grant insert (org_id, name, contact_name, phone, email, address, trn, payment_terms, notes, active),
  update (name, contact_name, phone, email, address, trn, payment_terms, notes, active)
  on public.suppliers to authenticated;
grant insert (org_id, sku, part_number, oem_ref, name, brand, category, description, unit, purchase_price,
  selling_price, tax_rate_id, min_stock, location, barcode, supplier_id, track_stock, active),
  update (sku, part_number, oem_ref, name, brand, category, description, unit, purchase_price,
  selling_price, tax_rate_id, min_stock, location, barcode, supplier_id, track_stock, active)
  on public.parts to authenticated;
grant insert (org_id, code, name, category, description, pricing, price, labor_rate, duration_hours, tax_rate_id, active),
  update (code, name, category, description, pricing, price, labor_rate, duration_hours, tax_rate_id, active)
  on public.services to authenticated;
grant insert (org_id, supplier_id, part_id, supplier_sku, price, lead_time_days),
  update (supplier_sku, price, lead_time_days), delete on public.supplier_parts to authenticated;

create policy suppliers_select on public.suppliers for select to authenticated using (public.has_perm(org_id, 'suppliers.view'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.has_perm(org_id, 'suppliers.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_perm(org_id, 'suppliers.manage')) with check (public.has_perm(org_id, 'suppliers.manage'));

create policy parts_select on public.parts for select to authenticated using (public.has_perm(org_id, 'catalog.view'));
create policy parts_insert on public.parts for insert to authenticated with check (public.has_perm(org_id, 'catalog.manage'));
create policy parts_update on public.parts for update to authenticated
  using (public.has_perm(org_id, 'catalog.manage')) with check (public.has_perm(org_id, 'catalog.manage'));

create policy services_select on public.services for select to authenticated using (public.has_perm(org_id, 'catalog.view'));
create policy services_insert on public.services for insert to authenticated with check (public.has_perm(org_id, 'catalog.manage'));
create policy services_update on public.services for update to authenticated
  using (public.has_perm(org_id, 'catalog.manage')) with check (public.has_perm(org_id, 'catalog.manage'));

create policy stock_levels_select on public.stock_levels for select to authenticated using (public.has_perm(org_id, 'stock.view'));
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.has_perm(org_id, 'stock.view'));

create policy supplier_parts_select on public.supplier_parts for select to authenticated using (public.has_perm(org_id, 'suppliers.view'));
create policy supplier_parts_insert on public.supplier_parts for insert to authenticated with check (public.has_perm(org_id, 'suppliers.manage'));
create policy supplier_parts_update on public.supplier_parts for update to authenticated
  using (public.has_perm(org_id, 'suppliers.manage')) with check (public.has_perm(org_id, 'suppliers.manage'));
create policy supplier_parts_delete on public.supplier_parts for delete to authenticated using (public.has_perm(org_id, 'suppliers.manage'));

create policy purchase_orders_select on public.purchase_orders for select to authenticated using (public.has_perm(org_id, 'suppliers.view'));
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated using (public.has_perm(org_id, 'suppliers.view'));

-- A read-friendly stock view (RLS of the underlying tables applies).
create view public.v_stock with (security_invoker = true) as
select p.org_id, p.id as part_id, b.id as branch_id, b.name as branch_name, p.sku, p.part_number, p.oem_ref,
  p.name, p.brand, p.category, p.location, p.barcode, p.unit, p.min_stock, p.purchase_price, p.selling_price,
  p.active, p.track_stock,
  coalesce(sl.quantity, 0) as quantity,
  (p.track_stock and coalesce(sl.quantity, 0) <= p.min_stock) as is_low
from public.parts p
join public.branches b on b.org_id = p.org_id and b.active
left join public.stock_levels sl on sl.part_id = p.id and sl.branch_id = b.id;
revoke all on public.v_stock from anon;
grant select on public.v_stock to authenticated;
