create extension if not exists pg_cron;
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  title text not null check(length(title) between 1 and 200),
  kind text not null check(kind in ('calendar.sync','planner.week','fitness.sync','life.organize','projects.sync')),
  payload jsonb not null default '{}' check(jsonb_typeof(payload)='object' and octet_length(payload::text)<65536),
  interval_minutes integer not null check(interval_minutes between 5 and 10080),
  next_run_at timestamptz not null,
  enabled boolean not null default true,
  last_materialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schedules_due_idx on public.schedules(next_run_at) where enabled;
alter table public.schedules enable row level security;
revoke all on public.schedules from public,anon,authenticated;
grant select,insert,update on public.schedules to authenticated;
create policy schedules_owner_read on public.schedules for select to authenticated using(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));
create policy schedules_owner_insert on public.schedules for insert to authenticated with check(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));
create policy schedules_owner_update on public.schedules for update to authenticated using(owner_id=(select auth.uid()) and (select public.is_workspace_owner())) with check(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));
create trigger touch_updated_at before update on public.schedules for each row execute function private.touch_updated_at();

create function private.materialize_schedules() returns integer language plpgsql security definer set search_path='' as $$
declare item public.schedules; inserted integer:=0; target_time timestamptz; occurrence timestamptz; begin
  for item in select * from public.schedules where enabled and next_run_at<=now() order by next_run_at limit 100 for update skip locked loop
    occurrence=item.next_run_at;
    target_time=occurrence+make_interval(mins=>(floor(extract(epoch from (now()-occurrence))/(60*item.interval_minutes))::integer+1)*item.interval_minutes);
    update public.schedules set next_run_at=target_time,last_materialized_at=now() where id=item.id;
    if coalesce((select (data->>'paused')::boolean from public.policies where owner_id=item.owner_id),true) then continue; end if;
    -- Stale plans are recalculated from current state only when the owner schedules another run.
    if item.kind='planner.week' and occurrence<now()-interval '1 day' then continue; end if;
    insert into public.jobs(owner_id,kind,payload,idempotency_key)
      values(item.owner_id,item.kind,item.payload,'schedule:'||item.id||':'||to_char(occurrence at time zone 'UTC','YYYYMMDDHH24MISS'))
      on conflict(owner_id,idempotency_key) do nothing;
    inserted=inserted+1;
  end loop;
  return inserted;
end; $$;
revoke all on function private.materialize_schedules() from public,anon,authenticated;
select cron.schedule('assistant-os-materialize','* * * * *','select private.materialize_schedules();');
