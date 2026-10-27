-- =====================================================================
-- Dollar POS — complete database setup (Supabase → SQL Editor → Run)
-- Safe to run on a fresh project AND to re-run over the earlier version
-- (it upgrades in place: nothing is deleted, your data is kept).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------------------------------------------------

create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  barcode              text unique,
  name                 text not null check (length(trim(name)) > 0),
  price                numeric(10,2) not null default 0 check (price >= 0),
  cost                 numeric(10,2) not null default 0 check (cost  >= 0),
  stock                integer       not null default 0 check (stock >= 0),
  low_stock_threshold  integer       not null default 5 check (low_stock_threshold >= 0),
  active               boolean       not null default true,
  image_path           text,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);
alter table public.products add column if not exists image_path text;
alter table public.products alter column price set default 0;
create index if not exists products_name_idx on public.products (lower(name));

create table if not exists public.sales (
  id              bigint generated always as identity primary key,
  total           numeric(12,2) not null default 0,
  items_count     integer       not null default 0,
  payment_method  text          not null default 'cash' check (payment_method in ('cash','card')),
  cash_received   numeric(12,2),
  change_given    numeric(12,2),
  voided          boolean       not null default false,
  voided_at       timestamptz,
  created_by      uuid,
  cashier         text,
  created_at      timestamptz   not null default now()
);
alter table public.sales add column if not exists cashier text;
create index if not exists sales_created_idx on public.sales (created_at desc);

create table if not exists public.sale_items (
  id          bigint generated always as identity primary key,
  sale_id     bigint  not null references public.sales(id) on delete cascade,
  product_id  uuid    not null references public.products(id),
  name        text    not null,
  barcode     text,
  qty         integer not null check (qty > 0),
  unit_price  numeric(10,2) not null,
  unit_cost   numeric(10,2) not null default 0
);
create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create table if not exists public.stock_movements (
  id           bigint generated always as identity primary key,
  product_id   uuid    not null references public.products(id) on delete cascade,
  change       integer not null,
  reason       text    not null,
  note         text,
  sale_id      bigint,
  stock_after  integer,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists stock_mov_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_mov_created_idx on public.stock_movements (created_at desc);

-- Shop details printed on receipts (readable by staff, changed only by owner)
create table if not exists public.shop_settings (
  id           int primary key default 1 check (id = 1),
  shop_name    text not null default 'My Shop',
  address      text not null default '',
  phone        text not null default '',
  footer       text not null default 'Thank you for shopping with us!',
  paper_width  int  not null default 80 check (paper_width in (58, 80)),
  updated_at   timestamptz not null default now()
);
insert into public.shop_settings (id) values (1) on conflict do nothing;

-- Owner password (stored as a bcrypt hash; no one can read this table directly)
create table if not exists public.admin_secret (
  id            int primary key default 1 check (id = 1),
  hash          text,
  failed        int not null default 0,
  locked_until  timestamptz
);
insert into public.admin_secret (id) values (1) on conflict do nothing;

-- Who has currently unlocked owner mode, and until when
create table if not exists public.admin_sessions (
  user_id         uuid primary key,
  unlocked_until  timestamptz not null
);

-- ---------- Triggers --------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create or replace function public.log_initial_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stock > 0 then
    insert into public.stock_movements(product_id, change, reason, stock_after, created_by)
    values (new.id, new.stock, 'initial', new.stock, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists products_initial_stock on public.products;
create trigger products_initial_stock after insert on public.products
  for each row execute function public.log_initial_stock();

-- ---------- Owner mode (password) -------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_sessions
    where user_id = auth.uid() and unlocked_until > now()
  );
$$;

create or replace function public.admin_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_has    boolean;
  v_locked timestamptz;
  v_until  timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select hash is not null, locked_until into v_has, v_locked from public.admin_secret where id = 1;
  select unlocked_until into v_until from public.admin_sessions
    where user_id = auth.uid() and unlocked_until > now();
  return jsonb_build_object(
    'has_password', coalesce(v_has, false),
    'unlocked',     v_until is not null,
    'seconds_left', case when v_until is null then 0 else extract(epoch from v_until - now())::int end,
    'locked_for',   case when v_locked is not null and v_locked > now() then extract(epoch from v_locked - now())::int else 0 end
  );
end $$;

-- 5 wrong tries → locked for 5 minutes. Returns a result (instead of raising)
-- so the failed-attempt counter is actually saved.
create or replace function public.unlock_admin(p_password text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.admin_secret%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into s from public.admin_secret where id = 1 for update;

  if s.hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_password');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'wait', extract(epoch from s.locked_until - now())::int);
  end if;

  if s.hash = extensions.crypt(coalesce(p_password, ''), s.hash) then
    update public.admin_secret set failed = 0, locked_until = null where id = 1;
    insert into public.admin_sessions (user_id, unlocked_until)
    values (auth.uid(), now() + interval '60 minutes')
    on conflict (user_id) do update set unlocked_until = excluded.unlocked_until;
    return jsonb_build_object('ok', true);
  end if;

  update public.admin_secret set
    locked_until = case when failed + 1 >= 5 then now() + interval '5 minutes' end,
    failed       = case when failed + 1 >= 5 then 0 else failed + 1 end
  where id = 1;
  return jsonb_build_object('ok', false, 'error', 'wrong', 'left', greatest(0, 4 - s.failed));
end $$;

-- First time: anyone signed in can create the password (do it right after setup).
-- Afterwards: only an unlocked owner who knows the current password can change it.
create or replace function public.set_admin_password(p_new text, p_current text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.admin_secret%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into s from public.admin_secret where id = 1 for update;

  if length(coalesce(p_new, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'short');
  end if;

  if s.hash is not null then
    if not public.is_admin() then
      return jsonb_build_object('ok', false, 'error', 'locked_out');
    end if;
    if s.hash <> extensions.crypt(coalesce(p_current, ''), s.hash) then
      return jsonb_build_object('ok', false, 'error', 'wrong');
    end if;
  end if;

  update public.admin_secret
    set hash = extensions.crypt(p_new, extensions.gen_salt('bf')), failed = 0, locked_until = null
  where id = 1;

  -- everyone else must re-enter the new password
  delete from public.admin_sessions where user_id <> auth.uid();
  insert into public.admin_sessions (user_id, unlocked_until)
  values (auth.uid(), now() + interval '60 minutes')
  on conflict (user_id) do update set unlocked_until = excluded.unlocked_until;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lock_admin()
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.admin_sessions where user_id = auth.uid();
end $$;

-- ---------- Owner-only data functions ---------------------------------

create or replace function public.save_settings(
  p_name text, p_address text, p_phone text, p_footer text, p_paper int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  update public.shop_settings set
    shop_name   = coalesce(nullif(trim(p_name), ''), 'My Shop'),
    address     = coalesce(trim(p_address), ''),
    phone       = coalesce(trim(p_phone), ''),
    footer      = coalesce(trim(p_footer), ''),
    paper_width = case when p_paper = 58 then 58 else 80 end,
    updated_at  = now()
  where id = 1;
end $$;

-- Full product list INCLUDING cost price (cost is hidden from the cashier screen)
create or replace function public.admin_products()
returns setof public.products
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  return query select * from public.products order by name, id;
end $$;

create or replace function public.save_product(
  p_id          uuid,
  p_barcode     text,
  p_name        text,
  p_price       numeric,
  p_cost        numeric,
  p_low         int,
  p_active      boolean,
  p_image_path  text,
  p_stock       int default 0
) returns public.products
language plpgsql security definer set search_path = public as $$
declare r public.products;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Product name is required'; end if;
  if coalesce(p_price, -1) < 0 then raise exception 'Enter a valid price'; end if;

  if p_id is null then
    insert into public.products
      (barcode, name, price, cost, stock, low_stock_threshold, active, image_path)
    values
      (nullif(trim(coalesce(p_barcode, '')), ''), trim(p_name), p_price, coalesce(p_cost, 0),
       greatest(coalesce(p_stock, 0), 0), coalesce(p_low, 5), coalesce(p_active, true), p_image_path)
    returning * into r;
  else
    update public.products set
      barcode             = nullif(trim(coalesce(p_barcode, '')), ''),
      name                = trim(p_name),
      price               = p_price,
      cost                = coalesce(p_cost, 0),
      low_stock_threshold = coalesce(p_low, 5),
      active              = coalesce(p_active, true),
      image_path          = p_image_path
    where id = p_id
    returning * into r;
    if not found then raise exception 'Product not found'; end if;
  end if;
  return r;
exception when unique_violation then
  raise exception 'That barcode already belongs to another product';
end $$;

-- ---------- Checkout (cashier can use; atomic & race-safe) ------------

create or replace function public.checkout(
  p_items         jsonb,
  p_payment       text    default 'cash',
  p_cash_received numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sale_id bigint;
  v_created timestamptz;
  v_email   text := auth.jwt() ->> 'email';
  v_total   numeric(12,2) := 0;
  v_count   int := 0;
  r         record;
  v_prod    public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if p_payment not in ('cash','card') then raise exception 'Invalid payment method'; end if;

  insert into public.sales(total, items_count, payment_method, created_by, cashier)
  values (0, 0, p_payment, auth.uid(), v_email)
  returning id, created_at into v_sale_id, v_created;

  for r in
    select (e->>'product_id')::uuid as product_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    if r.qty <= 0 then raise exception 'Invalid quantity'; end if;

    select * into v_prod from public.products where id = r.product_id for update;
    if not found or not v_prod.active then
      raise exception 'A product in the cart is no longer available';
    end if;
    if v_prod.stock < r.qty then
      raise exception 'Not enough stock for "%" (% left)', v_prod.name, v_prod.stock;
    end if;

    update public.products set stock = stock - r.qty where id = v_prod.id;

    insert into public.sale_items(sale_id, product_id, name, barcode, qty, unit_price, unit_cost)
    values (v_sale_id, v_prod.id, v_prod.name, v_prod.barcode, r.qty, v_prod.price, v_prod.cost);

    insert into public.stock_movements(product_id, change, reason, sale_id, stock_after, created_by)
    values (v_prod.id, -r.qty, 'sale', v_sale_id, v_prod.stock - r.qty, auth.uid());

    v_total := v_total + v_prod.price * r.qty;
    v_count := v_count + r.qty;
  end loop;

  if p_payment = 'cash' and p_cash_received is not null and p_cash_received < v_total then
    raise exception 'Cash received is less than the total';
  end if;

  update public.sales set
    total         = v_total,
    items_count   = v_count,
    cash_received = case when p_payment = 'cash' then coalesce(p_cash_received, v_total) end,
    change_given  = case when p_payment = 'cash' then coalesce(p_cash_received, v_total) - v_total end
  where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'total', v_total, 'items', v_count,
    'created_at', v_created, 'cashier', v_email
  );
end $$;

-- ---------- Stock / void / dashboard (owner only) ---------------------

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_change     int,
  p_reason     text default 'correction',
  p_note       text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_stock int;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  if p_change = 0 then raise exception 'Change cannot be zero'; end if;

  select stock into v_stock from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_stock + p_change < 0 then
    raise exception 'Stock cannot go below zero (current: %)', v_stock;
  end if;

  update public.products set stock = stock + p_change where id = p_product_id;

  insert into public.stock_movements(product_id, change, reason, note, stock_after, created_by)
  values (p_product_id, p_change, coalesce(nullif(trim(p_reason), ''), 'correction'), p_note, v_stock + p_change, auth.uid());

  return v_stock + p_change;
end $$;

create or replace function public.void_sale(p_sale_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sale  public.sales%rowtype;
  it      record;
  v_stock int;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.voided then raise exception 'Sale is already voided'; end if;

  for it in
    select product_id, sum(qty)::int as qty
    from public.sale_items where sale_id = p_sale_id
    group by 1 order by 1
  loop
    update public.products set stock = stock + it.qty
    where id = it.product_id
    returning stock into v_stock;

    insert into public.stock_movements(product_id, change, reason, sale_id, stock_after, created_by)
    values (it.product_id, it.qty, 'void', p_sale_id, v_stock, auth.uid());
  end loop;

  update public.sales set voided = true, voided_at = now() where id = p_sale_id;
end $$;

create or replace function public.dashboard_stats(p_tz text default 'UTC')
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_today       date        := (now() at time zone p_tz)::date;
  v_today_start timestamptz := (((now() at time zone p_tz)::date)::timestamp) at time zone p_tz;
  v_yest_start  timestamptz := ((((now() at time zone p_tz)::date - 1))::timestamp) at time zone p_tz;
  v_week_start  timestamptz := ((((now() at time zone p_tz)::date - 6))::timestamp) at time zone p_tz;
  v_today_total numeric; v_today_count int; v_today_items int; v_yest_total numeric;
  v_week jsonb; v_top jsonb; v_low jsonb;
  v_low_count int; v_out_count int; v_cost_val numeric; v_retail_val numeric; v_profit numeric;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;

  select coalesce(sum(total),0), count(*), coalesce(sum(items_count),0)
    into v_today_total, v_today_count, v_today_items
  from public.sales where not voided and created_at >= v_today_start;

  select coalesce(sum(total),0) into v_yest_total
  from public.sales where not voided and created_at >= v_yest_start and created_at < v_today_start;

  select coalesce(sum((si.unit_price - si.unit_cost) * si.qty), 0) into v_profit
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where not s.voided and s.created_at >= v_today_start;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day::text, 'total', coalesce(s.total, 0)) order by d.day), '[]'::jsonb)
    into v_week
  from (select (v_today - 6 + g)::date as day from generate_series(0, 6) g) d
  left join (
    select (created_at at time zone p_tz)::date as day, sum(total) as total
    from public.sales where not voided and created_at >= v_week_start
    group by 1
  ) s on s.day = d.day;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top from (
    select si.name, sum(si.qty)::int as qty, sum(si.qty * si.unit_price) as revenue
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where not s.voided and s.created_at >= v_week_start
    group by si.name order by sum(si.qty) desc limit 5
  ) t;

  select count(*) filter (where stock > 0 and stock <= low_stock_threshold),
         count(*) filter (where stock = 0),
         coalesce(sum(stock * cost), 0),
         coalesce(sum(stock * price), 0)
    into v_low_count, v_out_count, v_cost_val, v_retail_val
  from public.products where active;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_low from (
    select id, name, barcode, stock, low_stock_threshold
    from public.products
    where active and stock <= low_stock_threshold
    order by stock asc, name asc limit 8
  ) t;

  return jsonb_build_object(
    'today_total', v_today_total, 'yesterday_total', v_yest_total,
    'today_count', v_today_count, 'today_items', v_today_items,
    'today_profit', v_profit, 'week', v_week, 'top_products', v_top, 'low_stock', v_low,
    'low_stock_count', v_low_count, 'out_of_stock_count', v_out_count,
    'stock_cost_value', v_cost_val, 'stock_retail_value', v_retail_val
  );
end $$;

-- ---------- Security: Row Level Security + privileges -----------------
-- Cashier (signed in, owner mode locked): can read the product list (no cost
--   price), sell items, print the receipt of the sale just made.
-- Owner (signed in + owner password): everything else.
-- Signed-out visitors: nothing.

alter table public.products        enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;
alter table public.shop_settings   enable row level security;
alter table public.admin_secret    enable row level security;   -- no policies = unreadable
alter table public.admin_sessions  enable row level security;   -- no policies = unreadable

drop policy if exists "staff read products"   on public.products;
drop policy if exists "staff insert products" on public.products;
drop policy if exists "staff update products" on public.products;
create policy "staff read products" on public.products for select to authenticated using (true);

drop policy if exists "staff read sales"      on public.sales;
drop policy if exists "staff read sale_items" on public.sale_items;
drop policy if exists "staff read movements"  on public.stock_movements;
drop policy if exists "admin read sales"      on public.sales;
drop policy if exists "admin read sale_items" on public.sale_items;
drop policy if exists "admin read movements"  on public.stock_movements;
create policy "admin read sales"      on public.sales           for select to authenticated using (public.is_admin());
create policy "admin read sale_items" on public.sale_items      for select to authenticated using (public.is_admin());
create policy "admin read movements"  on public.stock_movements for select to authenticated using (public.is_admin());

drop policy if exists "staff read settings" on public.shop_settings;
create policy "staff read settings" on public.shop_settings for select to authenticated using (true);

revoke all on public.products, public.sales, public.sale_items, public.stock_movements,
              public.shop_settings, public.admin_secret, public.admin_sessions from anon;
revoke all on public.admin_secret, public.admin_sessions from authenticated;
revoke insert, update, delete on public.sales, public.sale_items, public.stock_movements,
                                 public.shop_settings from authenticated;
-- Products: read-only for the browser, and the cost price column is NOT readable there.
revoke all on public.products from authenticated;
grant select (id, barcode, name, price, stock, low_stock_threshold, active, image_path, created_at, updated_at)
  on public.products to authenticated;
-- (all writes go through save_product / adjust_stock / checkout / void_sale)

do $$
declare f text;
begin
  foreach f in array array[
    'is_admin()', 'admin_status()', 'unlock_admin(text)', 'set_admin_password(text,text)',
    'lock_admin()', 'save_settings(text,text,text,text,int)', 'admin_products()',
    'save_product(uuid,text,text,numeric,numeric,int,boolean,text,int)',
    'checkout(jsonb,text,numeric)', 'adjust_stock(uuid,int,text,text)',
    'void_sale(bigint)', 'dashboard_stats(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- Product pictures (Storage) --------------------------------
-- Public-read bucket (pictures aren't secret); only an unlocked owner can upload/replace/delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner upload product images" on storage.objects;
drop policy if exists "owner update product images" on storage.objects;
drop policy if exists "owner delete product images" on storage.objects;
create policy "owner upload product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "owner update product images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy "owner delete product images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
