create table if not exists public.invoice_configs (
  id text primary key,
  minimum_amount numeric not null default 10000000,
  updated_by_user_id text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.invoice_configs (id, minimum_amount)
values ('default', 10000000)
on conflict (id) do nothing;

create table if not exists public.investor_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  villa_id uuid references public.villas(id) on delete set null,
  villa_name text not null,
  period_key text not null,
  period_label text not null,
  covered_range_label text not null,
  created_at timestamptz not null default now(),
  due_date date not null,
  total_amount numeric not null default 0,
  ready_amount numeric not null default 0,
  review_amount numeric not null default 0,
  workflow_status text not null default 'Ready',
  payment_status text not null default 'Unpaid',
  paid_at timestamptz,
  creation_mode text not null default 'auto',
  created_by_user_id text,
  created_by_name text not null,
  threshold_applied numeric not null default 0,
  forced boolean not null default false
);

create index if not exists idx_investor_invoices_villa_id on public.investor_invoices(villa_id);
create index if not exists idx_investor_invoices_created_at on public.investor_invoices(created_at desc);
create index if not exists idx_investor_invoices_payment_status on public.investor_invoices(payment_status);

create table if not exists public.investor_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.investor_invoices(id) on delete cascade,
  line_item_key text not null unique,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  submission_id uuid references public.expense_submissions(id) on delete set null,
  villa_id uuid references public.villas(id) on delete set null,
  villa_name text not null,
  expense_date date not null,
  category text not null,
  amount numeric not null,
  vendor text,
  note text,
  submitted_by text not null,
  expense_status text not null,
  receipt_name text,
  receipt_data_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_investor_invoice_items_invoice_id on public.investor_invoice_items(invoice_id);
create index if not exists idx_investor_invoice_items_villa_id on public.investor_invoice_items(villa_id);
create index if not exists idx_investor_invoice_items_expense_date on public.investor_invoice_items(expense_date desc);

do $$
begin
  alter publication supabase_realtime add table public.invoice_configs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.investor_invoices;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.investor_invoice_items;
exception
  when duplicate_object then null;
end $$;
