-- Run this file once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  image_url text not null default '',
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  discount_price numeric(10,2) check (discount_price is null or (discount_price >= 0 and discount_price < price)),
  unit text not null check (unit in ('kg', 'piece', 'pack')),
  quantity_step numeric(6,2) not null default 0.5 check (quantity_step > 0),
  image_url text not null default '',
  is_available boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.is_shop_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_shop_admin() from public;
grant execute on function public.is_shop_admin() to anon, authenticated;

alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.settings enable row level security;

grant select on public.categories, public.products, public.settings to anon, authenticated;
grant insert, update, delete on public.categories, public.products, public.settings to authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories" on public.categories
  for select to anon, authenticated using (true);
drop policy if exists "Admins can insert categories" on public.categories;
create policy "Admins can insert categories" on public.categories
  for insert to authenticated with check (public.is_shop_admin());
drop policy if exists "Admins can update categories" on public.categories;
create policy "Admins can update categories" on public.categories
  for update to authenticated using (public.is_shop_admin()) with check (public.is_shop_admin());
drop policy if exists "Admins can delete categories" on public.categories;
create policy "Admins can delete categories" on public.categories
  for delete to authenticated using (public.is_shop_admin());

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products" on public.products
  for select to anon, authenticated using (true);
drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products" on public.products
  for insert to authenticated with check (public.is_shop_admin());
drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products" on public.products
  for update to authenticated using (public.is_shop_admin()) with check (public.is_shop_admin());
drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products" on public.products
  for delete to authenticated using (public.is_shop_admin());

drop policy if exists "Public can read settings" on public.settings;
create policy "Public can read settings" on public.settings
  for select to anon, authenticated using (true);
drop policy if exists "Admins can insert settings" on public.settings;
create policy "Admins can insert settings" on public.settings
  for insert to authenticated with check (public.is_shop_admin());
drop policy if exists "Admins can update settings" on public.settings;
create policy "Admins can update settings" on public.settings
  for update to authenticated using (public.is_shop_admin()) with check (public.is_shop_admin());
drop policy if exists "Admins can delete settings" on public.settings;
create policy "Admins can delete settings" on public.settings
  for delete to authenticated using (public.is_shop_admin());

drop policy if exists "Admins can read their own admin record" on public.admin_users;
create policy "Admins can read their own admin record" on public.admin_users
  for select to authenticated using (user_id = auth.uid());

create or replace function public.update_product_prices(price_updates jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  product_id uuid;
  product_price numeric(10,2);
begin
  if not public.is_shop_admin() then
    raise exception 'Only shop admins can update prices';
  end if;
  if jsonb_typeof(price_updates) <> 'array' then
    raise exception 'Price updates must be a JSON array';
  end if;
  for item in select value from jsonb_array_elements(price_updates)
  loop
    product_id := (item ->> 'id')::uuid;
    product_price := (item ->> 'price')::numeric;
    if product_price < 0 then
      raise exception 'Price cannot be negative';
    end if;
    update public.products
      set price = product_price, updated_at = now()
      where id = product_id;
    if not found then
      raise exception 'Product % was not found', product_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.update_product_prices(jsonb) from public;
grant execute on function public.update_product_prices(jsonb) to authenticated;

create or replace function public.update_category_order(category_order jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  category_id uuid;
  category_sort_order integer;
begin
  if not public.is_shop_admin() then
    raise exception 'Only shop admins can reorder categories';
  end if;
  if jsonb_typeof(category_order) <> 'array' then
    raise exception 'Category order must be a JSON array';
  end if;
  for item in select value from jsonb_array_elements(category_order)
  loop
    category_id := (item ->> 'id')::uuid;
    category_sort_order := (item ->> 'sort_order')::integer;
    if category_sort_order < 0 then
      raise exception 'Category order cannot be negative';
    end if;
    update public.categories
      set sort_order = category_sort_order, updated_at = now()
      where id = category_id;
    if not found then
      raise exception 'Category % was not found', category_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.update_category_order(jsonb) from public;
grant execute on function public.update_category_order(jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'product-images');
drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_shop_admin());
drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_shop_admin())
  with check (bucket_id = 'product-images' and public.is_shop_admin());
drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_shop_admin());

insert into public.categories (slug, name, image_url, sort_order) values
  ('beef', 'كندوز وبتلو', 'categories/cat-beef.jpg', 1),
  ('lamb', 'ضاني', 'categories/cat-lamb.jpg', 2),
  ('minced', 'مفروم وكفتة', 'categories/cat-minced.jpg', 3),
  ('processed', 'سجق ومصنعات', 'categories/cat-processed.jpg', 4),
  ('offal', 'كبدة وكوارع', 'categories/cat-offal.jpg', 5),
  ('offers', 'عروض وشنط', 'categories/cat-beef.jpg', 6)
on conflict (slug) do update set
  name = excluded.name,
  image_url = excluded.image_url,
  sort_order = excluded.sort_order;

insert into public.products
  (slug, category_id, name, description, price, unit, quantity_step, image_url, is_featured, sort_order)
values
  ('beef-cubes', (select id from public.categories where slug = 'beef'), 'مكعبات كندوز', 'مكعبات جاهزة للطبيخ', 350, 'kg', 0.5, 'products/beef-cubes.jpg', true, 1),
  ('beef-steak', (select id from public.categories where slug = 'beef'), 'ستيك كندوز', 'شرائح متساوية، على طلبك', 420, 'kg', 0.5, 'products/beef-steak.jpg', true, 2),
  ('beef-shank', (select id from public.categories where slug = 'beef'), 'موزة كندوز', 'مناسبة للفتة والطواجن', 330, 'kg', 0.5, 'products/beef-shank.jpg', false, 3),
  ('veal', (select id from public.categories where slug = 'beef'), 'بتلو صافي', 'طري وخفيف', 390, 'kg', 0.5, 'products/veal.jpg', false, 4),
  ('lamb-chops', (select id from public.categories where slug = 'lamb'), 'ريش ضاني', 'تقطيع وتجهيز حسب رغبتك', 520, 'kg', 0.5, 'products/lamb-chops.jpg', true, 5),
  ('lamb-leg', (select id from public.categories where slug = 'lamb'), 'فخدة ضاني', 'كاملة أو مقطعة', 480, 'kg', 0.5, 'products/lamb-leg.jpg', false, 6),
  ('lamb-cubes', (select id from public.categories where slug = 'lamb'), 'مكعبات ضاني', 'للطواجن والمشاوي', 460, 'kg', 0.5, 'products/lamb-cubes.jpg', false, 7),
  ('lamb-mince', (select id from public.categories where slug = 'lamb'), 'مفروم ضاني', 'فرم حسب الطلب', 440, 'kg', 0.5, 'products/lamb-mince.jpg', false, 8),
  ('minced-beef', (select id from public.categories where slug = 'minced'), 'لحم مفروم', 'درجة الفرم على طلبك', 320, 'kg', 0.5, 'products/minced-beef.jpg', true, 9),
  ('kofta', (select id from public.categories where slug = 'minced'), 'كفتة متبلة', 'خلطة بيتية جاهزة للشوي', 280, 'kg', 0.5, 'products/kofta.jpg', true, 10),
  ('burger', (select id from public.categories where slug = 'minced'), 'برجر لحمة', 'قطع جاهزة للتسوية', 300, 'kg', 0.5, 'products/burger.jpg', false, 11),
  ('hawawshi', (select id from public.categories where slug = 'minced'), 'خلطة حواوشي', 'متبلة وجاهزة للحشو', 290, 'kg', 0.5, 'products/hawawshi.jpg', false, 12),
  ('sausage', (select id from public.categories where slug = 'processed'), 'سجق بلدي', 'تتبيلة شرقي', 300, 'kg', 0.5, 'products/sausage.jpg', true, 13),
  ('liver-sausage', (select id from public.categories where slug = 'processed'), 'سجق بالكبدة', 'متجهز للطبيخ', 310, 'kg', 0.5, 'products/liver-sausage.jpg', false, 14),
  ('burger-pack', (select id from public.categories where slug = 'processed'), 'برجر بيتي (القطعة)', 'قطعة جاهزة للشوي', 35, 'piece', 1, 'products/burger-pack.jpg', false, 15),
  ('liver', (select id from public.categories where slug = 'offal'), 'كبدة بلدي', 'شرائح أو مكعبات', 290, 'kg', 0.5, 'products/liver.jpg', true, 16),
  ('kidney', (select id from public.categories where slug = 'offal'), 'كلاوي', 'تنظيف وتجهيز حسب الطلب', 220, 'kg', 0.5, 'products/kidney.jpg', false, 17),
  ('tripe', (select id from public.categories where slug = 'offal'), 'كرشة منظفة', 'تنظيف وتجهيز', 180, 'kg', 0.5, 'products/tripe.jpg', false, 18),
  ('box-family', (select id from public.categories where slug = 'offers'), 'شنطة العيلة (عينة)', 'تشكيلة متنوعة — سعر تجريبي', 950, 'pack', 1, 'products/box-family.jpg', true, 19),
  ('grill-box', (select id from public.categories where slug = 'offers'), 'شنطة المشاوي (عينة)', 'تشكيلة مشاوي — سعر تجريبي', 1100, 'pack', 1, 'products/grill-box.jpg', false, 20),
  ('weekly-box', (select id from public.categories where slug = 'offers'), 'شنطة الأسبوع (عينة)', 'تشكيلة للبيت — سعر تجريبي', 1200, 'pack', 1, 'products/weekly-box.jpg', false, 21)
on conflict (slug) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  unit = excluded.unit,
  quantity_step = excluded.quantity_step,
  image_url = excluded.image_url,
  is_featured = excluded.is_featured,
  sort_order = excluded.sort_order;

insert into public.settings (key, value) values (
  'shop',
  jsonb_build_object(
    'shop_name', 'جزارة فرج عبدالمقصود',
    'whatsapp', '201552288154',
    'phone', '',
    'address', 'أضف عنوان المحل، المنطقة، المحافظة',
    'map_url', 'https://maps.google.com/?q=butcher+shop+Egypt',
    'working_hours', 'يومياً من 10 صباحاً حتى 11 مساءً',
    'welcome_message', 'أهلاً بيكم في جزارة فرج عبدالمقصود',
    'minimum_order', 0,
    'order_paused', false,
    'delivery_areas', jsonb_build_array(
      jsonb_build_object('name', 'المنطقة الأولى (مثال)', 'fee', 30),
      jsonb_build_object('name', 'المنطقة الثانية (مثال)', 'fee', 45)
    )
  )
)
on conflict (key) do nothing;
