create table if not exists public.management_fee_configs (
  villa_id uuid primary key references public.villas(id) on delete cascade,
  fee_type text not null default 'none',
  percentage_rate numeric not null default 0,
  fixed_amount numeric not null default 0,
  updated_by_user_id text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_management_fee_configs_fee_type on public.management_fee_configs(fee_type);

do $$
begin
  alter publication supabase_realtime add table public.management_fee_configs;
exception
  when duplicate_object then null;
end $$;
