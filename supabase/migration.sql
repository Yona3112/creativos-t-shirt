-- ============================================================================
-- MIGRACIÓN SUPABASE: CAMISAS GIFT SHOP — CREATIVOS GIFT SHOP (HONDURAS)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- IMPORTANTE: usar un proyecto Supabase NUEVO / dedicado (las tablas products,
-- customers y orders chocarían con las del POS anterior).
-- ============================================================================

create extension if not exists "pgcrypto";

create sequence if not exists public.orders_folio_seq
  start with 11001
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

-- 1. Tabla de sincronización instantánea en tiempo real (Teléfono <-> Taller)
create table if not exists public.app_state_sync (
  id int primary key default 1 check (id = 1),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state_sync enable row level security;
drop policy if exists "Acceso sincronizacion tienda" on public.app_state_sync;
create policy "Acceso sincronizacion tienda" on public.app_state_sync
  for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state_sync'
  ) then
    alter publication supabase_realtime add table public.app_state_sync;
  end if;
end $$;

-- 1b. Fotos de diseño (separadas del estado para no inflar el tráfico Realtime).
--     NO se publica en Realtime: cada dispositivo la descarga solo cuando la necesita.
create table if not exists public.design_photos (
  id text primary key,
  data text not null,
  created_at timestamptz not null default now()
);

alter table public.design_photos enable row level security;
drop policy if exists "Acceso fotos diseno" on public.design_photos;
create policy "Acceso fotos diseno" on public.design_photos
  for all using (true) with check (true);

-- 2. Tablas relacionales principales
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  design text not null default '',
  fabric text not null default 'Algodón',
  gramaje int not null default 150,
  corte text not null default 'Unisex',
  base_cost numeric(10,2) not null default 0.00,
  price numeric(10,2) not null default 300.00,
  campaign text default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color_name text not null,
  color_hex text not null,
  size text not null,
  sku text unique not null,
  stock int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 5,
  created_at timestamptz not null default now()
);

create unique index if not exists variants_unique
  on public.variants(product_id, color_hex, size);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Casa',
  recipient text not null,
  line1 text not null,
  city text not null default 'La Entrada',
  department text not null default 'Copán',
  country text not null default 'HN',
  reference text,
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  folio bigint unique not null default nextval('public.orders_folio_seq'),
  customer_id uuid references public.customers(id),
  address_id uuid references public.addresses(id),
  status text not null default 'en_produccion'
    check (status in ('borrador','en_produccion','enviado','entregado','cancelado')),
  work_type text not null default 'DTF Frontal',
  design_photo text,
  subtotal numeric(10,2) not null default 0.00,
  discount numeric(10,2) not null default 0.00,
  shipping numeric(10,2) not null default 110.00,
  total numeric(10,2) not null default 0.00,
  deposit_paid numeric(10,2) not null default 0.00,
  balance_due numeric(10,2) not null default 0.00,
  currency char(3) not null default 'HNL',
  payment_method text not null default 'Transferencia BAC',
  notes text,
  tracking_carrier text,
  tracking_number text,
  tracking_url text,
  whatsapp_sent_at timestamptz,
  whatsapp_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid references public.variants(id),
  qty int not null check (qty > 0),
  unit_price numeric(10,2) not null,
  line_total numeric(10,2) not null,
  design_photo text
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references public.variants(id) on delete restrict,
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('compra','venta','ajuste','devolucion','cancelacion','merma')),
  order_id uuid references public.orders(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

-- 3. Seeds limpios: 4 marcas activas con stock inicial en 0
insert into public.products (id, name, base_cost, price, active)
values
  ('11111111-1111-4111-8111-111111111101', 'Bella+Canvas', 150.00, 300.00, true),
  ('11111111-1111-4111-8111-111111111102', 'Next Apparel', 145.00, 300.00, true),
  ('11111111-1111-4111-8111-111111111103', 'Pacer', 115.00, 300.00, true),
  ('11111111-1111-4111-8111-111111111104', 'HN', 95.00, 300.00, true)
on conflict (name) do nothing;
