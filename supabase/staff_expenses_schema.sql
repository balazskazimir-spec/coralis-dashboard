create table if not exists public.expense_submissions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null unique references public.expenses(id) on delete cascade,
  villa_id uuid references public.villas(id) on delete cascade,
  expense_date date not null,
  category text not null,
  amount numeric not null,
  vendor text,
  note text,
  submitted_by text not null,
  status text not null default 'Submitted',
  receipt_name text,
  receipt_data_url text,
  flagged_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expense_submissions_expense_date on public.expense_submissions(expense_date desc);
create index if not exists idx_expense_submissions_status on public.expense_submissions(status);
create index if not exists idx_expense_submissions_villa_id on public.expense_submissions(villa_id);

do $$
begin
  alter publication supabase_realtime add table public.expense_submissions;
exception
  when duplicate_object then null;
end $$;
