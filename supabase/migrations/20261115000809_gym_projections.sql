create table public.gym_profiles (
  owner_id uuid primary key references auth.users(id),
  workout_count integer not null default 0,
  routine_count integer not null default 0,
  bodyweight_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create table public.gym_state_changes (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  rev bigint not null,
  wid uuid not null,
  created_at timestamptz not null default now(),
  unique(owner_id,rev)
);
create index gym_changes_owner_idx on public.gym_state_changes(owner_id,rev desc);
alter table public.gym_profiles enable row level security;
alter table public.gym_state_changes enable row level security;
revoke all on public.gym_profiles,public.gym_state_changes from public,anon,authenticated;
grant select on public.gym_profiles,public.gym_state_changes to authenticated;
create policy gym_profiles_owner_read on public.gym_profiles for select to authenticated using(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));
create policy gym_changes_owner_read on public.gym_state_changes for select to authenticated using(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));

create function private.project_gym_state() returns trigger language plpgsql set search_path='' as $$
declare w integer; r integer; b integer; begin
  w=case when jsonb_typeof(new.state->'workouts')='array' then jsonb_array_length(new.state->'workouts') else 0 end;
  r=case when jsonb_typeof(new.state->'routines')='array' then jsonb_array_length(new.state->'routines') else 0 end;
  b=case when jsonb_typeof(new.state->'bodyweight')='array' then jsonb_array_length(new.state->'bodyweight') else 0 end;
  insert into public.gym_profiles(owner_id,workout_count,routine_count,bodyweight_count,updated_at)
    values(new.owner_id,w,r,b,now())
    on conflict(owner_id) do update set workout_count=excluded.workout_count,routine_count=excluded.routine_count,bodyweight_count=excluded.bodyweight_count,updated_at=excluded.updated_at;
  insert into public.gym_state_changes(owner_id,rev,wid) values(new.owner_id,new.rev,new.wid) on conflict(owner_id,rev) do nothing;
  return new;
end; $$;
create trigger project_gym_state after insert or update on public.gym_state for each row execute function private.project_gym_state();
