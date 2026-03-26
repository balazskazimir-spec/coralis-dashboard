create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  villa_id uuid references public.villas(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  thread_id uuid references public.message_threads(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  task_type text not null,
  description text not null,
  due_at timestamptz not null,
  priority text not null default 'Normal',
  status text not null default 'To do',
  assignee text,
  note text,
  source text not null default 'manual',
  auto_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_tasks_villa_id on public.staff_tasks(villa_id);
create index if not exists idx_staff_tasks_due_at on public.staff_tasks(due_at asc);
create index if not exists idx_staff_tasks_status on public.staff_tasks(status);

create table if not exists public.staff_issues (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  villa_id uuid references public.villas(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  thread_id uuid references public.message_threads(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  severity text not null default 'Normal',
  title text not null,
  summary text not null,
  opened_at timestamptz not null default now(),
  assignee text,
  status text not null default 'Open',
  source text not null default 'urgent follow-up',
  note text,
  auto_generated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_issues_villa_id on public.staff_issues(villa_id);
create index if not exists idx_staff_issues_opened_at on public.staff_issues(opened_at desc);
create index if not exists idx_staff_issues_status on public.staff_issues(status);

do $$
begin
  alter publication supabase_realtime add table public.staff_tasks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.staff_issues;
exception
  when duplicate_object then null;
end $$;
