-- Run steps:
-- 1) Open Supabase Dashboard > SQL Editor > New query.
-- 2) Paste this entire file and click Run.
-- 3) Refresh /admin after the query succeeds. Re-running is safe.
-- This installs the size schema/RLS and atomic admin save functions.

alter table public.products
  add column if not exists sale_type text not null default 'weight';

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
    select 1 from pg_constraint
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

create or replace function public.save_product_with_sizes(product_data jsonb, sizes_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
  v_size_ids uuid[] := '{}'::uuid[];
  v_existing_count integer;
  v_size_count integer;
  v_unique_name_count integer;
  v_sale_type text;
  v_price numeric(10,2);
  v_item jsonb;
  v_size_id uuid;
  v_sort_order integer;
  v_name text;
  v_size_price numeric(10,2);
begin
  if auth.uid() is null or not public.is_shop_admin() then
    raise exception 'Only shop admins can save products and sizes' using errcode = '42501';
  end if;
  if jsonb_typeof(product_data) <> 'object' then
    raise exception 'Product data must be a JSON object';
  end if;

  v_product_id := nullif(product_data ->> 'id', '')::uuid;
  v_sale_type := coalesce(nullif(product_data ->> 'sale_type', ''), 'weight');
  if v_sale_type not in ('weight', 'size', 'piece') then
    raise exception 'Invalid product sale type';
  end if;

  if v_sale_type = 'size' then
    if jsonb_typeof(sizes_data) <> 'array' then
      raise exception 'Sizes must be a JSON array';
    end if;
    select count(*), count(distinct lower(btrim(value ->> 'name')))
      into v_size_count, v_unique_name_count
      from jsonb_array_elements(sizes_data);
    if v_size_count < 2 then
      raise exception 'At least two sizes are required';
    end if;
    if v_size_count <> v_unique_name_count then
      raise exception 'Size names must be non-empty and unique';
    end if;

    for v_item in select value from jsonb_array_elements(sizes_data)
    loop
      v_name := btrim(coalesce(v_item ->> 'name', ''));
      if v_name = '' or nullif(v_item ->> 'price', '') is null then
        raise exception 'Each size requires a name and a price';
      end if;
      v_size_price := (v_item ->> 'price')::numeric(10,2);
      if v_size_price < 0 then
        raise exception 'Size prices cannot be negative';
      end if;
    end loop;

    select coalesce(array_agg((value ->> 'id')::uuid), '{}'::uuid[])
      into v_size_ids
      from jsonb_array_elements(sizes_data)
      where nullif(value ->> 'id', '') is not null;

    if cardinality(v_size_ids) <> (
      select count(distinct value ->> 'id')
      from jsonb_array_elements(sizes_data)
      where nullif(value ->> 'id', '') is not null
    ) then
      raise exception 'A size id was supplied more than once';
    end if;

    if cardinality(v_size_ids) > 0 then
      select count(*) into v_existing_count
      from public.product_sizes
      where product_id = v_product_id and id = any(v_size_ids);
      if v_existing_count <> cardinality(v_size_ids) then
        raise exception 'One or more sizes do not belong to this product';
      end if;
    end if;
    select min((value ->> 'price')::numeric(10,2))
      into v_price from jsonb_array_elements(sizes_data);
  else
    v_price := (product_data ->> 'price')::numeric(10,2);
    if v_price < 0 then
      raise exception 'Product price cannot be negative';
    end if;
  end if;

  if v_product_id is null then
    insert into public.products (
      slug, category_id, name, description, price, discount_price, sale_type,
      unit, quantity_step, image_url, is_available, is_featured, sort_order, updated_at
    ) values (
      product_data ->> 'slug',
      (product_data ->> 'category_id')::uuid,
      btrim(product_data ->> 'name'),
      coalesce(product_data ->> 'description', ''),
      v_price,
      nullif(product_data ->> 'discount_price', '')::numeric(10,2),
      v_sale_type,
      coalesce(nullif(product_data ->> 'unit', ''), case when v_sale_type = 'weight' then 'kg' else 'piece' end),
      case when v_sale_type = 'weight' then 0.25 else 1 end,
      coalesce(product_data ->> 'image_url', ''),
      coalesce((product_data ->> 'is_available')::boolean, true),
      coalesce((product_data ->> 'is_featured')::boolean, false),
      coalesce((product_data ->> 'sort_order')::integer, 0),
      now()
    ) returning id into v_product_id;
  else
    update public.products
    set slug = product_data ->> 'slug',
        category_id = (product_data ->> 'category_id')::uuid,
        name = btrim(product_data ->> 'name'),
        description = coalesce(product_data ->> 'description', ''),
        price = v_price,
        discount_price = nullif(product_data ->> 'discount_price', '')::numeric(10,2),
        sale_type = v_sale_type,
        unit = coalesce(nullif(product_data ->> 'unit', ''), case when v_sale_type = 'weight' then 'kg' else 'piece' end),
        quantity_step = case when v_sale_type = 'weight' then 0.25 else 1 end,
        image_url = coalesce(product_data ->> 'image_url', ''),
        is_available = coalesce((product_data ->> 'is_available')::boolean, true),
        is_featured = coalesce((product_data ->> 'is_featured')::boolean, false),
        sort_order = coalesce((product_data ->> 'sort_order')::integer, 0),
        updated_at = now()
    where id = v_product_id;
    if not found then
      raise exception 'Product % was not found', v_product_id;
    end if;
  end if;

  if v_sale_type = 'size' then
    delete from public.product_sizes
    where product_id = v_product_id
      and not (id = any(v_size_ids));

    update public.product_sizes
    set name = '__saving_' || gen_random_uuid()::text || '_' || id::text
    where product_id = v_product_id and id = any(v_size_ids);

    for v_item, v_sort_order in
      select value, ordinality::integer
      from jsonb_array_elements(sizes_data) with ordinality
    loop
      v_size_id := nullif(v_item ->> 'id', '')::uuid;
      v_name := btrim(v_item ->> 'name');
      v_size_price := (v_item ->> 'price')::numeric(10,2);
      if v_size_id is null then
        insert into public.product_sizes (product_id, name, price, sort_order, is_available)
        values (
          v_product_id, v_name, v_size_price, v_sort_order,
          coalesce((v_item ->> 'is_available')::boolean, true)
        );
      else
        update public.product_sizes
        set name = v_name,
            price = v_size_price,
            sort_order = v_sort_order,
            is_available = coalesce((v_item ->> 'is_available')::boolean, true)
        where id = v_size_id and product_id = v_product_id;
      end if;
    end loop;
  else
    delete from public.product_sizes where product_id = v_product_id;
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.save_product_with_sizes(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_product_with_sizes(jsonb, jsonb) to authenticated;

create or replace function public.update_size_prices(size_price_updates jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  size_id uuid;
  size_price numeric(10,2);
begin
  if auth.uid() is null or not public.is_shop_admin() then
    raise exception 'Only shop admins can update size prices' using errcode = '42501';
  end if;
  if jsonb_typeof(size_price_updates) <> 'array' then
    raise exception 'Size price updates must be a JSON array';
  end if;
  for item in select value from jsonb_array_elements(size_price_updates)
  loop
    size_id := (item ->> 'id')::uuid;
    size_price := (item ->> 'price')::numeric(10,2);
    if size_price < 0 then
      raise exception 'Size price cannot be negative';
    end if;
    update public.product_sizes set price = size_price where id = size_id;
    if not found then
      raise exception 'Product size % was not found', size_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.update_size_prices(jsonb) from public, anon, authenticated;
grant execute on function public.update_size_prices(jsonb) to authenticated;

-- Check RLS configuration:
-- select relrowsecurity from pg_class where oid = 'public.product_sizes'::regclass;
-- select policyname, roles, cmd, qual, with_check
-- from pg_policies where schemaname = 'public' and tablename = 'product_sizes';
