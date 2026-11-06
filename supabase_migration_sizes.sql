-- Idempotent product sale modes and size variants migration.
-- Safe to run on the existing shop database; existing products default to weight.

alter table public.products
  add column if not exists sale_type text not null default 'weight';

update public.products
set sale_type = 'weight'
where sale_type is null;

alter table public.products
  alter column sale_type set default 'weight',
  alter column sale_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_sale_type_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_sale_type_check
      check (sale_type in ('weight', 'size', 'piece'));
  end if;
end;
$$;

update public.products
set quantity_step = 0.25
where sale_type = 'weight'
  and quantity_step is distinct from 0.25;

create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  sort_order integer not null default 0,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_sizes_product_id_name_key unique (product_id, name)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_sizes_product_id_name_key'
      and conrelid = 'public.product_sizes'::regclass
  ) then
    alter table public.product_sizes
      add constraint product_sizes_product_id_name_key unique (product_id, name);
  end if;
end;
$$;

create index if not exists product_sizes_product_order_idx
  on public.product_sizes (product_id, sort_order);

alter table public.product_sizes enable row level security;

grant select on public.product_sizes to anon, authenticated;
grant insert, update, delete on public.product_sizes to authenticated;

drop policy if exists "Public can read product sizes" on public.product_sizes;
create policy "Public can read product sizes" on public.product_sizes
  for select to anon, authenticated using (true);

drop policy if exists "Admins can insert product sizes" on public.product_sizes;
create policy "Admins can insert product sizes" on public.product_sizes
  for insert to authenticated with check (public.is_shop_admin());

drop policy if exists "Admins can update product sizes" on public.product_sizes;
create policy "Admins can update product sizes" on public.product_sizes
  for update to authenticated using (public.is_shop_admin())
  with check (public.is_shop_admin());

drop policy if exists "Admins can delete product sizes" on public.product_sizes;
create policy "Admins can delete product sizes" on public.product_sizes
  for delete to authenticated using (public.is_shop_admin());

create or replace function public.update_size_prices(size_price_updates jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  size_id uuid;
  size_price numeric(10,2);
begin
  if not public.is_shop_admin() then
    raise exception 'Only shop admins can update size prices';
  end if;
  if jsonb_typeof(size_price_updates) <> 'array' then
    raise exception 'Size price updates must be a JSON array';
  end if;
  for item in select value from jsonb_array_elements(size_price_updates)
  loop
    size_id := (item ->> 'id')::uuid;
    size_price := (item ->> 'price')::numeric;
    if size_price < 0 then
      raise exception 'Size price cannot be negative';
    end if;
    update public.product_sizes
      set price = size_price
      where id = size_id;
    if not found then
      raise exception 'Product size % was not found', size_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.update_size_prices(jsonb) from public;
grant execute on function public.update_size_prices(jsonb) to authenticated;

-- Clearly marked demo product: three independently priced hawawshi sizes.
insert into public.products (
  slug, category_id, name, description, price, unit, quantity_step,
  image_url, is_available, is_featured, sort_order, sale_type
)
select
  'hawawshi-size-demo',
  category.id,
  'حواوشي',
  'صنف تجريبي — أسعار وأحجام للعرض',
  60,
  'piece',
  1,
  'products/hawawshi.jpg',
  true,
  true,
  22,
  'size'
from public.categories as category
where category.slug = 'minced'
on conflict (slug) do nothing;

insert into public.product_sizes (product_id, name, price, sort_order, is_available)
select product.id, variants.name, variants.price, variants.sort_order, true
from public.products as product
cross join (values
  ('صغير', 35::numeric, 1),
  ('وسط', 48::numeric, 2),
  ('كبير', 60::numeric, 3)
) as variants(name, price, sort_order)
where product.slug = 'hawawshi-size-demo'
on conflict (product_id, name) do nothing;
