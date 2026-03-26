create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  villa_id uuid references public.villas(id) on delete cascade,
  guest_name text not null,
  platform text not null default 'Direct',
  status text not null default 'Needs reply',
  tag text not null default 'general',
  notes text,
  unread boolean not null default false,
  guest_history integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_message_threads_villa_id on public.message_threads(villa_id);
create index if not exists idx_message_threads_last_message_at on public.message_threads(last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_thread_id on public.messages(thread_id);
create index if not exists idx_messages_sent_at on public.messages(sent_at asc);

do $$
begin
  alter publication supabase_realtime add table public.message_threads;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;
