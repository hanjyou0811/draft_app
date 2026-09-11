-- Run once in the dedicated Supabase project's SQL Editor.
begin;
create table public.draft_rooms (
  id text primary key,
  version integer not null check (version >= 0),
  storage_version integer not null check (storage_version = 1),
  aggregate jsonb not null,
  constraint aggregate_metadata check (
    aggregate ? 'id' and aggregate ? 'version' and
    aggregate->>'id' = id and (aggregate->>'version')::integer = version
  )
);
alter table public.draft_rooms enable row level security;
revoke all on public.draft_rooms from public, anon, authenticated;
grant select, insert, update on public.draft_rooms to service_role;
commit;
