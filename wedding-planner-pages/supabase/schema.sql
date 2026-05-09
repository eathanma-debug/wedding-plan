create extension if not exists pgcrypto;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'eathanma@gmail.com',
    '673112447@qq.com'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.wedding_settings (
  id text primary key default 'main' check (id = 'main'),
  engagement_date date not null default '2026-08-22',
  wedding_date date not null default '2027-06-01',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phase text not null default '订婚前' check (phase in ('订婚前', '订婚中', '婚前准备', '婚前1月', '婚礼当天')),
  due_date date,
  planned_amount numeric(12, 2) not null default 0 check (planned_amount >= 0),
  completed boolean not null default false,
  notes text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  tx_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category text not null check (length(trim(category)) > 0),
  remarks text not null default '',
  is_income boolean not null default false,
  task_id uuid references public.tasks(id) on delete set null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.wedding_settings (id, engagement_date, wedding_date)
values ('main', '2026-08-22', '2027-06-01')
on conflict (id) do nothing;

create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_completed_idx on public.tasks (completed);
create index if not exists transactions_tx_date_idx on public.transactions (tx_date desc);
create index if not exists transactions_task_id_idx on public.transactions (task_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.wedding_settings to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant execute on function public.is_allowed_user() to authenticated;

drop trigger if exists touch_wedding_settings_updated_at on public.wedding_settings;
create trigger touch_wedding_settings_updated_at
before update on public.wedding_settings
for each row execute function public.touch_updated_at();

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

drop trigger if exists touch_transactions_updated_at on public.transactions;
create trigger touch_transactions_updated_at
before update on public.transactions
for each row execute function public.touch_updated_at();

alter table public.wedding_settings enable row level security;
alter table public.tasks enable row level security;
alter table public.transactions enable row level security;

drop policy if exists wedding_settings_allowed_users on public.wedding_settings;
create policy wedding_settings_allowed_users on public.wedding_settings
for all
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

drop policy if exists tasks_allowed_users on public.tasks;
create policy tasks_allowed_users on public.tasks
for all
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

drop policy if exists transactions_allowed_users on public.transactions;
create policy transactions_allowed_users on public.transactions
for all
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));
