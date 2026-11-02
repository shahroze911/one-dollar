-- =====================================================================
-- Dollar POS — complete database setup (Supabase → SQL Editor → Run)
-- Safe to run on a fresh project AND to re-run over any earlier version
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

-- Cash-drawer shifts (one open at a time) and money moved in/out of the drawer
create table if not exists public.shifts (
  id               bigint generated always as identity primary key,
  opened_by        uuid,
  opened_by_email  text,
  opened_at        timestamptz not null default now(),
  opening_float    numeric(12,2) not null default 0 check (opening_float >= 0),
  closed_at        timestamptz,
  closed_by        uuid,
  closed_by_email  text,
  counted_cash     numeric(12,2),
  expected_cash    numeric(12,2),
  difference       numeric(12,2),
  close_note       text
);
create unique index if not exists one_open_shift on public.shifts ((true)) where closed_at is null;

create table if not exists public.cash_movements (
  id                bigint generated always as identity primary key,
  shift_id          bigint not null references public.shifts(id),
  kind              text   not null check (kind in ('in', 'out')),
  amount            numeric(12,2) not null check (amount > 0),
  reason            text   not null,
  created_by        uuid,
  created_by_email  text,
  created_at        timestamptz not null default now()
);
create index if not exists cash_mov_shift_idx on public.cash_movements (shift_id);

create table if not exists public.sales (
  id              bigint generated always as identity primary key,
  total           numeric(12,2) not null default 0,
  items_count     integer       not null default 0,
  payment_method  text          not null default 'cash',
  cash_received   numeric(12,2),
  change_given    numeric(12,2),
  voided          boolean       not null default false,
  voided_at       timestamptz,
  created_by      uuid,
  cashier         text,
  created_at      timestamptz   not null default now()
);
alter table public.sales add column if not exists cashier   text;
alter table public.sales add column if not exists subtotal  numeric(12,2) not null default 0;           -- after item discounts, before sale discount
alter table public.sales add column if not exists discount  numeric(12,2) not null default 0;           -- whole-sale discount (Rs)
alter table public.sales add column if not exists payments  jsonb         not null default '[]'::jsonb;  -- [{method, amount}] amounts applied to the bill
alter table public.sales add column if not exists shift_id  bigint;
alter table public.sales add column if not exists client_id    uuid;                          -- made by the till; makes a retried / offline sale safe to send twice
alter table public.sales add column if not exists offline      boolean       not null default false;  -- sold while the internet was down, synced later
alter table public.sales add column if not exists needs_review boolean       not null default false;  -- owner should look at it (see review_note)
alter table public.sales add column if not exists review_note  text;
create unique index if not exists sales_client_id_key on public.sales (client_id);
alter table public.sales drop constraint if exists sales_payment_method_check;
alter table public.sales add  constraint sales_payment_method_check check (payment_method in ('cash','card','wallet','split'));
create index if not exists sales_created_idx on public.sales (created_at desc);
create index if not exists sales_shift_idx   on public.sales (shift_id);

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
alter table public.sale_items add column if not exists discount numeric(10,2) not null default 0;  -- total discount on this line (Rs)
create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create table if not exists public.refunds (
  id          bigint generated always as identity primary key,
  sale_id     bigint not null references public.sales(id),
  amount      numeric(12,2) not null default 0,
  method      text   not null check (method in ('cash','card','wallet')),
  reason      text   not null,
  note        text,
  restock     boolean not null default true,
  shift_id    bigint,
  created_by  uuid,
  cashier     text,
  created_at  timestamptz not null default now()
);
create index if not exists refunds_sale_idx    on public.refunds (sale_id);
create index if not exists refunds_created_idx on public.refunds (created_at desc);

create table if not exists public.refund_items (
  id            bigint generated always as identity primary key,
  refund_id     bigint not null references public.refunds(id) on delete cascade,
  sale_item_id  bigint not null references public.sale_items(id),
  product_id    uuid   not null,
  name          text   not null,
  qty           integer not null check (qty > 0),
  amount        numeric(12,2) not null
);
create index if not exists refund_items_refund_idx   on public.refund_items (refund_id);
create index if not exists refund_items_saleitem_idx on public.refund_items (sale_item_id);

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

-- Shop details printed on receipts (readable by staff, changed only by the owner)
create table if not exists public.shop_settings (
  id           int primary key default 1 check (id = 1),
  shop_name    text not null default 'My Shop',
  address      text not null default '',
  phone        text not null default '',
  footer       text not null default 'Thank you for shopping with us!',
  paper_width  int  not null default 80 check (paper_width in (58, 80)),
  updated_at   timestamptz not null default now()
);
alter table public.shop_settings add column if not exists logo_path        text;
alter table public.shop_settings add column if not exists whatsapp         text not null default '';
alter table public.shop_settings add column if not exists instagram        text not null default '';
alter table public.shop_settings add column if not exists facebook         text not null default '';
alter table public.shop_settings add column if not exists tiktok           text not null default '';
alter table public.shop_settings add column if not exists website          text not null default '';
alter table public.shop_settings add column if not exists max_discount_pct int  not null default 10 check (max_discount_pct between 0 and 100);
alter table public.shop_settings add column if not exists hidden_pages     text not null default '';
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

drop function if exists public.save_settings(text, text, text, text, int);

create or replace function public.save_settings(
  p_name text, p_address text, p_phone text, p_footer text, p_paper int,
  p_logo text, p_whatsapp text, p_instagram text, p_facebook text, p_tiktok text, p_website text,
  p_max_discount int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  update public.shop_settings set
    shop_name        = coalesce(nullif(trim(p_name), ''), 'My Shop'),
    address          = coalesce(trim(p_address), ''),
    phone            = coalesce(trim(p_phone), ''),
    footer           = coalesce(trim(p_footer), ''),
    paper_width      = case when p_paper = 58 then 58 else 80 end,
    logo_path        = nullif(trim(coalesce(p_logo, '')), ''),
    whatsapp         = coalesce(trim(p_whatsapp), ''),
    instagram        = coalesce(trim(p_instagram), ''),
    facebook         = coalesce(trim(p_facebook), ''),
    tiktok           = coalesce(trim(p_tiktok), ''),
    website          = coalesce(trim(p_website), ''),
    max_discount_pct = least(100, greatest(0, coalesce(p_max_discount, 10))),
    updated_at       = now()
  where id = 1;
end $$;

-- Which sidebar pages to hide (owner only). Comma-separated page paths, e.g. '/stock,/custom-sale'.
create or replace function public.save_hidden_pages(p_hidden text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  update public.shop_settings set hidden_pages = coalesce(trim(p_hidden), ''), updated_at = now() where id = 1;
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

-- ---------- Checkout (atomic & race-safe) -----------------------------
-- p_items    : [{product_id, qty, price?, discount?}]   discount = total Rs off that line
-- p_payments : [{method: cash|card|wallet, amount}]     amounts TENDERED (cash may exceed the bill → change)
-- p_discount : Rs off the whole sale (after line discounts)
-- Rules enforced here, not in the browser:
--   * prices come from the database; only an unlocked owner may sell at another price
--   * total discount above the shop's limit (Settings) needs the owner password
--   * stock can't go negative; two tills can't oversell

drop function if exists public.checkout(jsonb, text, numeric);
drop function if exists public.checkout(jsonb, jsonb, numeric);

create or replace function public.checkout(
  p_items    jsonb,
  p_payments jsonb,
  p_discount numeric default 0,
  p_client_id uuid default null,          -- unique id made by the till; sending the same id again returns the same sale
  p_at       timestamptz default null,    -- when an OFFLINE sale really happened
  p_offline  boolean default false        -- true: goods already handed over, so record it even if checks fail (flagged for review)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_off       boolean := coalesce(p_offline, false);
  v_at        timestamptz;
  v_note      text := '';
  v_take      int;
  ex          public.sales%rowtype;
  v_sale_id   bigint;
  v_created   timestamptz;
  v_email     text := auth.jwt() ->> 'email';
  v_shift     bigint;
  v_gross     numeric(12,2) := 0;
  v_subtotal  numeric(12,2) := 0;
  v_line_disc numeric(12,2) := 0;
  v_sale_disc numeric(12,2) := round(coalesce(p_discount, 0), 2);
  v_total     numeric(12,2);
  v_count     int := 0;
  r           record;
  pay         record;
  v_prod      public.products%rowtype;
  v_price     numeric(10,2);
  v_max       int;
  v_pct       numeric;
  v_cash      numeric(12,2) := 0;
  v_card      numeric(12,2) := 0;
  v_wallet    numeric(12,2) := 0;
  v_noncash   numeric(12,2);
  v_cash_app  numeric(12,2);
  v_change    numeric(12,2) := 0;
  v_applied   jsonb := '[]'::jsonb;
  v_methods   int := 0;
  v_method    text := 'cash';
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Invalid payment';
  end if;

  select id into v_shift from public.shifts where closed_at is null;

  v_at := case when v_off and p_at is not null and p_at <= now() and p_at > now() - interval '14 days' then p_at else now() end;

  insert into public.sales(total, items_count, payment_method, created_by, cashier, shift_id, client_id, offline, created_at)
  values (0, 0, 'cash', auth.uid(), v_email, v_shift, p_client_id, v_off, v_at)
  on conflict (client_id) do nothing
  returning id, created_at into v_sale_id, v_created;

  if v_sale_id is null then
    -- this sale was already saved (retry after a dropped connection, or a repeated sync): return it, change nothing
    select * into ex from public.sales where client_id = p_client_id;
    return jsonb_build_object(
      'sale_id', ex.id, 'created_at', ex.created_at, 'cashier', ex.cashier,
      'items', ex.items_count, 'subtotal', ex.subtotal, 'discount', ex.discount, 'total', ex.total,
      'payment_method', ex.payment_method, 'payments', ex.payments,
      'cash_received', ex.cash_received, 'change_given', ex.change_given, 'duplicate', true
    );
  end if;

  for r in
    select (e->>'product_id')::uuid                         as product_id,
           (e->>'qty')::int                                 as qty,
           round((e->>'price')::numeric, 2)                 as price,
           round(coalesce((e->>'discount')::numeric, 0), 2) as discount
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if r.qty is null or r.qty <= 0 then raise exception 'Invalid quantity'; end if;

    select * into v_prod from public.products where id = r.product_id for update;
    if not found or not v_prod.active then
      raise exception 'A product in the cart is no longer available';
    end if;
    v_take := r.qty;
    if v_prod.stock < r.qty then
      if not v_off then
        raise exception 'Not enough stock for "%" (% left)', v_prod.name, v_prod.stock;
      end if;
      v_take := v_prod.stock;   -- offline sale: the goods are gone; take what is left and flag it
      v_note := v_note || format('Stock was short for "%s": sold %s, only %s were in the system. ', v_prod.name, r.qty, v_prod.stock);
    end if;

    v_price := coalesce(r.price, v_prod.price);
    if v_price < 0 then raise exception 'Invalid price'; end if;
    if v_price <> v_prod.price and not public.is_admin() then
      if not v_off then raise exception 'Owner password required to change a price'; end if;
      v_note := v_note || format('Price of "%s" was Rs %s on the till, list price is now Rs %s. ', v_prod.name, v_price, v_prod.price);
    end if;
    if r.discount < 0 or r.discount > v_price * r.qty then raise exception 'Invalid discount'; end if;

    update public.products set stock = stock - v_take where id = v_prod.id;

    insert into public.sale_items(sale_id, product_id, name, barcode, qty, unit_price, unit_cost, discount)
    values (v_sale_id, v_prod.id, v_prod.name, v_prod.barcode, r.qty, v_price, v_prod.cost, r.discount);

    insert into public.stock_movements(product_id, change, reason, sale_id, stock_after, created_by)
    values (v_prod.id, -v_take, 'sale', v_sale_id, v_prod.stock - v_take, auth.uid());

    v_gross     := v_gross + v_price * r.qty;
    v_subtotal  := v_subtotal + v_price * r.qty - r.discount;
    v_line_disc := v_line_disc + r.discount;
    v_count     := v_count + r.qty;
  end loop;

  if v_sale_disc < 0 or v_sale_disc > v_subtotal then raise exception 'Invalid discount'; end if;
  v_total := v_subtotal - v_sale_disc;

  -- discount limit: above it, only an unlocked owner can approve
  select max_discount_pct into v_max from public.shop_settings where id = 1;
  v_pct := case when v_gross > 0 then (v_line_disc + v_sale_disc) / v_gross * 100 else 0 end;
  if v_pct > coalesce(v_max, 10) + 0.0001 and not public.is_admin() then
    if not v_off then raise exception 'Discount above % percent needs the owner password', coalesce(v_max, 10); end if;
    v_note := v_note || format('Discount was %s%%, above the %s%% limit, and could not be approved offline. ', round(v_pct, 1), coalesce(v_max, 10));
  end if;

  -- payments (any mix of cash / card / wallet)
  for pay in
    select lower(e->>'method') as method, round(coalesce((e->>'amount')::numeric, 0), 2) as amount
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) e
  loop
    if pay.amount < 0 then raise exception 'Invalid payment amount'; end if;
    if    pay.method = 'cash'   then v_cash   := v_cash   + pay.amount;
    elsif pay.method = 'card'   then v_card   := v_card   + pay.amount;
    elsif pay.method = 'wallet' then v_wallet := v_wallet + pay.amount;
    else raise exception 'Invalid payment method';
    end if;
  end loop;

  v_noncash := v_card + v_wallet;
  if v_noncash > v_total then raise exception 'Card / wallet amount is more than the total'; end if;
  if v_cash + v_noncash < v_total then raise exception 'Payment is less than the total'; end if;
  v_cash_app := v_total - v_noncash;               -- the part of the bill paid in cash
  v_change   := v_cash + v_noncash - v_total;      -- always paid back out of cash

  if v_cash_app > 0 then v_applied := v_applied || jsonb_build_object('method', 'cash',   'amount', v_cash_app); v_methods := v_methods + 1; v_method := 'cash';   end if;
  if v_card     > 0 then v_applied := v_applied || jsonb_build_object('method', 'card',   'amount', v_card);     v_methods := v_methods + 1; v_method := 'card';   end if;
  if v_wallet   > 0 then v_applied := v_applied || jsonb_build_object('method', 'wallet', 'amount', v_wallet);   v_methods := v_methods + 1; v_method := 'wallet'; end if;
  if v_methods > 1 then v_method := 'split'; end if;

  update public.sales set
    subtotal       = v_subtotal,
    discount       = v_sale_disc,
    total          = v_total,
    items_count    = v_count,
    payment_method = v_method,
    payments       = v_applied,
    cash_received  = case when v_cash > 0 then v_cash end,
    change_given   = case when v_cash > 0 then v_change end,
    needs_review   = (v_note <> ''),
    review_note    = nullif(trim(v_note), '')
  where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'created_at', v_created, 'cashier', v_email,
    'items', v_count, 'subtotal', v_subtotal, 'discount', v_sale_disc, 'total', v_total,
    'payment_method', v_method, 'payments', v_applied,
    'cash_received', case when v_cash > 0 then v_cash end,
    'change_given',  case when v_cash > 0 then v_change end,
    'needs_review',  (v_note <> '')
  );
end $$;

-- ---------- Cash drawer: shifts ---------------------------------------
-- Expected cash = opening float + cash taken in sales − cash refunds + cash put in − cash taken out.
-- (Cash portion of a sale only; change given back is already excluded.)

create or replace function public.shift_cash(p_shift bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f numeric; cs numeric; cr numeric; ci numeric; co numeric;
begin
  select opening_float into f from public.shifts where id = p_shift;
  select coalesce(sum((p->>'amount')::numeric), 0) into cs
    from public.sales s, jsonb_array_elements(s.payments) p
    where s.shift_id = p_shift and not s.voided and p->>'method' = 'cash';
  select coalesce(sum(amount), 0) into cr
    from public.refunds where shift_id = p_shift and method = 'cash';
  select coalesce(sum(amount) filter (where kind = 'in'), 0),
         coalesce(sum(amount) filter (where kind = 'out'), 0)
    into ci, co from public.cash_movements where shift_id = p_shift;
  return jsonb_build_object(
    'opening_float', coalesce(f, 0), 'cash_sales', cs, 'cash_refunds', cr,
    'cash_in', ci, 'cash_out', co,
    'expected_cash', coalesce(f, 0) + cs - cr + ci - co
  );
end $$;

-- What the till screen shows. Cashiers don't see the expected cash (so they count blind);
-- an unlocked owner does.
create or replace function public.current_shift()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shifts%rowtype; v_cnt int; v_tot numeric; v_moves jsonb; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into s from public.shifts where closed_at is null;
  if not found then return null; end if;

  select count(*), coalesce(sum(total), 0) into v_cnt, v_tot
    from public.sales where shift_id = s.id and not voided;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'kind', kind, 'amount', amount, 'reason', reason, 'at', created_at, 'by', created_by_email
         ) order by created_at desc), '[]'::jsonb)
    into v_moves from public.cash_movements where shift_id = s.id;

  v_out := jsonb_build_object(
    'id', s.id, 'opened_at', s.opened_at, 'opened_by', s.opened_by_email,
    'opening_float', s.opening_float, 'sales_count', v_cnt, 'sales_total', v_tot, 'movements', v_moves
  );
  if public.is_admin() then v_out := v_out || public.shift_cash(s.id); end if;
  return v_out;
end $$;

create or replace function public.open_shift(p_float numeric)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_float is null or p_float < 0 then raise exception 'Enter the cash you are starting with'; end if;
  insert into public.shifts (opened_by, opened_by_email, opening_float)
  values (auth.uid(), auth.jwt() ->> 'email', round(p_float, 2))
  returning id into v;
  return v;
exception when unique_violation then
  raise exception 'A shift is already open';
end $$;

create or replace function public.add_cash_movement(p_kind text, p_amount numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('in', 'out') then raise exception 'Invalid movement'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Please give a reason'; end if;
  select id into v from public.shifts where closed_at is null;
  if v is null then raise exception 'Open a shift first'; end if;
  insert into public.cash_movements (shift_id, kind, amount, reason, created_by, created_by_email)
  values (v, p_kind, round(p_amount, 2), trim(p_reason), auth.uid(), auth.jwt() ->> 'email');
end $$;

-- Closing: you give the counted cash. If it differs from what the POS expects you must write why;
-- the first call then returns need_note = true (nothing is closed yet).
create or replace function public.close_shift(p_counted numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v bigint; calc jsonb; v_exp numeric; v_diff numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash you counted'; end if;
  select id into v from public.shifts where closed_at is null for update;
  if v is null then raise exception 'No shift is open'; end if;

  calc   := public.shift_cash(v);
  v_exp  := (calc->>'expected_cash')::numeric;
  v_diff := round(p_counted, 2) - v_exp;

  if v_diff <> 0 and length(trim(coalesce(p_note, ''))) = 0 then
    return jsonb_build_object('ok', false, 'need_note', true, 'expected', v_exp, 'counted', round(p_counted, 2), 'difference', v_diff);
  end if;

  update public.shifts set
    closed_at = now(), closed_by = auth.uid(), closed_by_email = auth.jwt() ->> 'email',
    counted_cash = round(p_counted, 2), expected_cash = v_exp, difference = v_diff,
    close_note = nullif(trim(coalesce(p_note, '')), '')
  where id = v;

  return jsonb_build_object('ok', true, 'expected', v_exp, 'counted', round(p_counted, 2),
                            'difference', v_diff, 'breakdown', calc);
end $$;

-- ---------- Refunds (owner password = manager approval) ---------------
-- p_items: [{sale_item_id, qty}]. Money back is worked out from what the customer really paid
-- (line discount and the share of any whole-sale discount are taken into account).

create or replace function public.refund_sale(
  p_sale_id bigint,
  p_items   jsonb,
  p_reason  text,
  p_note    text    default null,
  p_method  text    default 'cash',
  p_restock boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s          public.sales%rowtype;
  it         public.sale_items%rowtype;
  r          record;
  v_done     int;
  v_ratio    numeric;
  v_amt      numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_refund   bigint;
  v_created  timestamptz;
  v_shift    bigint;
  v_stock    int;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one item to return';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Please give a reason'; end if;
  if p_method not in ('cash', 'card', 'wallet') then raise exception 'Invalid refund method'; end if;

  select * into s from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.voided then raise exception 'This sale was voided'; end if;

  select id into v_shift from public.shifts where closed_at is null;
  v_ratio := case when s.subtotal > 0 then (s.subtotal - s.discount) / s.subtotal else 1 end;

  insert into public.refunds (sale_id, amount, method, reason, note, restock, shift_id, created_by, cashier)
  values (p_sale_id, 0, p_method, trim(p_reason), nullif(trim(coalesce(p_note, '')), ''),
          coalesce(p_restock, true), v_shift, auth.uid(), auth.jwt() ->> 'email')
  returning id, created_at into v_refund, v_created;

  for r in
    select (e->>'sale_item_id')::bigint as sale_item_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    if r.qty <= 0 then raise exception 'Invalid quantity'; end if;

    select * into it from public.sale_items where id = r.sale_item_id and sale_id = p_sale_id;
    if not found then raise exception 'That item is not on this sale'; end if;

    select coalesce(sum(qty), 0) into v_done from public.refund_items where sale_item_id = it.id;
    if v_done + r.qty > it.qty then
      raise exception 'Cannot return more than was sold of "%"', it.name;
    end if;

    v_amt := round(((it.qty * it.unit_price - it.discount) / it.qty) * v_ratio * r.qty, 2);

    insert into public.refund_items (refund_id, sale_item_id, product_id, name, qty, amount)
    values (v_refund, it.id, it.product_id, it.name, r.qty, v_amt);

    if coalesce(p_restock, true) then
      update public.products set stock = stock + r.qty where id = it.product_id returning stock into v_stock;
      insert into public.stock_movements (product_id, change, reason, note, sale_id, stock_after, created_by)
      values (it.product_id, r.qty, 'refund', 'Refund #' || v_refund, p_sale_id, v_stock, auth.uid());
    end if;

    v_total := v_total + v_amt;
  end loop;

  update public.refunds set amount = v_total where id = v_refund;
  return jsonb_build_object('refund_id', v_refund, 'amount', v_total, 'created_at', v_created);
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
  if exists (select 1 from public.refunds where sale_id = p_sale_id) then
    raise exception 'This sale already has a refund, so it cannot be voided';
  end if;

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
  v_today_total numeric; v_today_count int; v_today_items int; v_yest_total numeric; v_refunds numeric;
  v_week jsonb; v_top jsonb; v_low jsonb;
  v_low_count int; v_out_count int; v_cost_val numeric; v_retail_val numeric; v_profit numeric;
begin
  if not public.is_admin() then raise exception 'Owner password required'; end if;

  select coalesce(sum(total),0), count(*), coalesce(sum(items_count),0)
    into v_today_total, v_today_count, v_today_items
  from public.sales where not voided and created_at >= v_today_start;

  select coalesce(sum(total),0) into v_yest_total
  from public.sales where not voided and created_at >= v_yest_start and created_at < v_today_start;

  select coalesce(sum(amount),0) into v_refunds from public.refunds where created_at >= v_today_start;

  -- profit = (price − cost) × qty − item discounts − whole-sale discounts
  select coalesce(sum((si.unit_price - si.unit_cost) * si.qty - si.discount), 0) into v_profit
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where not s.voided and s.created_at >= v_today_start;
  v_profit := v_profit - (select coalesce(sum(discount), 0) from public.sales where not voided and created_at >= v_today_start);

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day::text, 'total', coalesce(s.total, 0)) order by d.day), '[]'::jsonb)
    into v_week
  from (select (v_today - 6 + g)::date as day from generate_series(0, 6) g) d
  left join (
    select (created_at at time zone p_tz)::date as day, sum(total) as total
    from public.sales where not voided and created_at >= v_week_start
    group by 1
  ) s on s.day = d.day;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top from (
    select si.name, sum(si.qty)::int as qty, sum(si.qty * si.unit_price - si.discount) as revenue
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
    'today_total', v_today_total, 'yesterday_total', v_yest_total, 'today_refunds', v_refunds,
    'today_count', v_today_count, 'today_items', v_today_items,
    'today_profit', v_profit, 'week', v_week, 'top_products', v_top, 'low_stock', v_low,
    'low_stock_count', v_low_count, 'out_of_stock_count', v_out_count,
    'stock_cost_value', v_cost_val, 'stock_retail_value', v_retail_val
  );
end $$;

-- ---------- Security: Row Level Security + privileges -----------------
-- Cashier (signed in, owner mode locked): read the product list (no cost price), sell, hold,
--   run the cash drawer (open / move cash / close).
-- Owner (signed in + owner password): records, stock, refunds, voids, settings, dashboard.
-- Signed-out visitors: nothing.

alter table public.products        enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;
alter table public.shop_settings   enable row level security;
alter table public.refunds         enable row level security;
alter table public.refund_items    enable row level security;
alter table public.shifts          enable row level security;
alter table public.cash_movements  enable row level security;
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

drop policy if exists "admin read refunds"       on public.refunds;
drop policy if exists "admin read refund_items"  on public.refund_items;
drop policy if exists "admin read shifts"        on public.shifts;
drop policy if exists "admin read cash movements" on public.cash_movements;
create policy "admin read refunds"        on public.refunds        for select to authenticated using (public.is_admin());
create policy "admin read refund_items"   on public.refund_items   for select to authenticated using (public.is_admin());
create policy "admin read shifts"         on public.shifts         for select to authenticated using (public.is_admin());
create policy "admin read cash movements" on public.cash_movements for select to authenticated using (public.is_admin());

drop policy if exists "staff read settings" on public.shop_settings;
create policy "staff read settings" on public.shop_settings for select to authenticated using (true);

revoke all on public.products, public.sales, public.sale_items, public.stock_movements,
              public.shop_settings, public.refunds, public.refund_items, public.shifts,
              public.cash_movements, public.admin_secret, public.admin_sessions from anon;
revoke all on public.admin_secret, public.admin_sessions from authenticated;
revoke insert, update, delete on public.sales, public.sale_items, public.stock_movements,
                                 public.shop_settings, public.refunds, public.refund_items,
                                 public.shifts, public.cash_movements from authenticated;
-- Products: read-only for the browser, and the cost price column is NOT readable there.
revoke all on public.products from authenticated;
grant select (id, barcode, name, price, stock, low_stock_threshold, active, image_path, created_at, updated_at)
  on public.products to authenticated;
-- (all writes go through the functions below)

revoke execute on function public.shift_cash(bigint) from public, anon, authenticated;  -- internal helper

do $$
declare f text;
begin
  foreach f in array array[
    'is_admin()', 'admin_status()', 'unlock_admin(text)', 'set_admin_password(text,text)',
    'lock_admin()',
    'save_settings(text,text,text,text,int,text,text,text,text,text,text,int)',
    'save_hidden_pages(text)',
    'admin_products()',
    'save_product(uuid,text,text,numeric,numeric,int,boolean,text,int)',
    'checkout(jsonb,jsonb,numeric,uuid,timestamptz,boolean)',
    'refund_sale(bigint,jsonb,text,text,text,boolean)',
    'current_shift()', 'open_shift(numeric)', 'add_cash_movement(text,numeric,text)', 'close_shift(numeric,text)',
    'adjust_stock(uuid,int,text,text)', 'void_sale(bigint)', 'dashboard_stats(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- Pictures & logo (Storage) ---------------------------------
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

-- make the API pick up the new/changed functions straight away
notify pgrst, 'reload schema';
