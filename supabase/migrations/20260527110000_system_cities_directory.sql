-- Kazakhstan city directory for organization profiles.
-- Existing free-text organization cities are migrated into managed system records.

create table if not exists public.system_cities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_system_cities_normalized_name
  on public.system_cities (lower(btrim(name)));

drop trigger if exists set_system_cities_updated_at on public.system_cities;
create trigger set_system_cities_updated_at before update on public.system_cities
for each row execute function public.set_updated_at();

alter table public.companies
  add column if not exists city_id uuid references public.system_cities(id) on delete restrict;

-- Official city names from KATO NK RK 11-2025, updated on 2026-03-16.
insert into public.system_cities (name)
values
  ('Абай'),
  ('Акколь'),
  ('Аксай'),
  ('Аксу'),
  ('Актау'),
  ('Актобе'),
  ('Алатау'),
  ('Алга'),
  ('Алматы'),
  ('Алтай'),
  ('Аральск'),
  ('Аркалык'),
  ('Арысь'),
  ('Астана'),
  ('Атбасар'),
  ('Атырау'),
  ('Аягоз'),
  ('Байконыр'),
  ('Балхаш'),
  ('Булаево'),
  ('Державинск'),
  ('Ерейментау'),
  ('Есик'),
  ('Есиль'),
  ('Жанаозен'),
  ('Жанатас'),
  ('Жаркент'),
  ('Жезказган'),
  ('Жем'),
  ('Жетысай'),
  ('Житикара'),
  ('Зайсан'),
  ('Казалинск'),
  ('Кандыагаш'),
  ('Караганда'),
  ('Каражал'),
  ('Каратау'),
  ('Каркаралинск'),
  ('Каскелен'),
  ('Кентау'),
  ('Кокшетау'),
  ('Костанай'),
  ('Косшы'),
  ('Кульсары'),
  ('Курчатов'),
  ('Кызылорда'),
  ('Қонаев'),
  ('Ленгер'),
  ('Лисаковск'),
  ('Макинск'),
  ('Мамлютка'),
  ('Павлодар'),
  ('Петропавловск'),
  ('Приозерск'),
  ('Риддер'),
  ('Рудный'),
  ('Сарань'),
  ('Саркан'),
  ('Сарыагаш'),
  ('Сатпаев'),
  ('Семей'),
  ('Сергеевка'),
  ('Серебрянск'),
  ('Степногорск'),
  ('Степняк'),
  ('Тайынша'),
  ('Талгар'),
  ('Талдыкорган'),
  ('Тараз'),
  ('Текели'),
  ('Темир'),
  ('Темиртау'),
  ('Тобыл'),
  ('Туркестан'),
  ('Уральск'),
  ('Усть-Каменогорск'),
  ('Ушарал'),
  ('Уштобе'),
  ('Форт-Шевченко'),
  ('Хромтау'),
  ('Шалкар'),
  ('Шар'),
  ('Шардара'),
  ('Шахтинск'),
  ('Шемонаиха'),
  ('Шу'),
  ('Шымкент'),
  ('Щучинск'),
  ('Экибастуз'),
  ('Эмба')
on conflict do nothing;

insert into public.system_cities (name)
select distinct on (lower(btrim(city))) btrim(city)
from public.companies
where nullif(btrim(city), '') is not null
order by lower(btrim(city)), btrim(city)
on conflict do nothing;

update public.companies company
set city_id = city.id
from public.system_cities city
where company.city_id is null
  and nullif(btrim(company.city), '') is not null
  and lower(btrim(company.city)) = lower(btrim(city.name));

alter table public.companies drop column if exists city;

create index if not exists idx_companies_city_id on public.companies(city_id);

alter table public.system_cities enable row level security;

create policy "authenticated users can read system cities"
on public.system_cities for select
to authenticated
using (true);

-- Backoffice writes use the server-only service-role client after platform role checks.
