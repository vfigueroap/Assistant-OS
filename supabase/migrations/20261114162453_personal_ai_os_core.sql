-- Personal AI OS: cloud domain state; agents use scoped RPCs, never a service key.
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

create table private.workspace_owners (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null unique references auth.users(id), created_at timestamptz not null default now()
);
create table private.workers (
  worker_user_id uuid primary key references auth.users(id),
  owner_id uuid not null references auth.users(id), label text not null default 'HP',
  scopes text[] not null default '{}', enabled boolean not null default true,
  last_seen_at timestamptz, created_at timestamptz not null default now()
);
create index workers_owner_idx on private.workers(owner_id);

create function private.is_workspace_owner() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.workspace_owners where owner_id=auth.uid());
$$;
create function public.is_workspace_owner() returns boolean language sql stable security invoker set search_path='' as $$ select private.is_workspace_owner(); $$;

create table public.records (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('task','goal','project','note','event','course','topic','assessment','study_session','training_plan','health_metric','contact','decision')),
  title text not null check(length(title) between 1 and 1000), data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
  status text not null default 'active', due_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(id,owner_id)
);
create index records_owner_kind_idx on public.records(owner_id,kind,updated_at desc) where deleted_at is null;
create index records_due_idx on public.records(owner_id,due_at) where deleted_at is null and due_at is not null;
create table public.documents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  title text not null, file_name text, mime text not null default 'application/pdf',
  bucket text not null default 'personal-files', storage_path text, local_path text,
  sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'), size_bytes bigint check(size_bytes>=0),
  status text not null default 'uploaded' check(status in ('uploaded','processing','indexed','failed','archived')),
  data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id), check(storage_path is null or split_part(storage_path,'/',1)=owner_id::text)
);
create index documents_owner_idx on public.documents(owner_id,created_at desc);
create unique index documents_hash_idx on public.documents(owner_id,sha256) where sha256 is not null;
create table public.fragments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), document_id uuid not null,
  position integer not null check(position>=0), locator jsonb not null default '{}', text text not null,
  embedding extensions.vector, embedding_model text, source_sha256 text, created_at timestamptz not null default now(),
  foreign key(document_id,owner_id) references public.documents(id,owner_id) on delete cascade,
  unique(document_id,position)
);
create index fragments_owner_document_idx on public.fragments(owner_id,document_id);
create index fragments_fts_idx on public.fragments using gin(to_tsvector('simple',text));

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null, currency text not null default 'CLP' check(currency ~ '^[A-Z]{3}$'),
  kind text not null default 'manual', opening_balance_minor bigint not null default 0,
  data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.financial_evidence (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), title text not null,
  source text not null default 'upload', external_id text,
  sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'), mime text not null default 'application/pdf',
  bucket text not null default 'personal-files', storage_path text, size_bytes bigint check(size_bytes>=0),
  status text not null default 'uploaded' check(status in ('uploaded','processing','extracted','needs_review','failed','archived')),
  data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id), unique(owner_id,source,external_id),
  check(storage_path is null or split_part(storage_path,'/',1)=owner_id::text)
);
create unique index evidence_hash_idx on public.financial_evidence(owner_id,sha256) where sha256 is not null;
create table public.transactions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), account_id uuid, evidence_id uuid,
  amount_minor bigint check(amount_minor>=0 and amount_minor<=9007199254740991), currency text not null default 'CLP' check(currency ~ '^[A-Z]{3}$'),
  direction text not null default 'expense' check(direction in ('expense','income','refund','transfer')),
  kind text not null default 'purchase' check(kind in ('purchase','income','refund','transfer','card_payment','fee')),
  settlement_status text not null default 'unknown' check(settlement_status in ('unknown','pending','posted','reversed')),
  merchant text, description text not null default '', category text, occurred_at timestamptz,
  status text not null default 'draft' check(status in ('draft','confirmed','void')),
  confidence numeric check(confidence between 0 and 1), data jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(account_id,owner_id) references public.financial_accounts(id,owner_id),
  foreign key(evidence_id,owner_id) references public.financial_evidence(id,owner_id),
  unique(evidence_id), check(status<>'confirmed' or (amount_minor is not null and occurred_at is not null))
);
create index transactions_owner_date_idx on public.transactions(owner_id,occurred_at desc);
create table public.budgets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), title text not null,
  amount_minor bigint not null check(amount_minor>=0 and amount_minor<=9007199254740991), currency text not null default 'CLP' check(currency ~ '^[A-Z]{3}$'),
  category text, month date, period_start date not null, period_end date not null, data jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(period_end>=period_start)
);
create index budgets_owner_idx on public.budgets(owner_id,period_start);
create table public.workspace_settings (
  owner_id uuid not null references auth.users(id), key text not null, value jsonb not null default '{}', updated_at timestamptz not null default now(),
  primary key(owner_id,key)
);
create table public.policies (
  owner_id uuid primary key references auth.users(id), version bigint not null default 1,
  data jsonb not null default '{"paused":true,"autonomy_level":2,"monthly_budget_usd":10}', updated_at timestamptz not null default now()
);
create table public.actions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), operation text not null,
  payload jsonb not null, resource jsonb not null default '{}', payload_hash text not null,
  policy_version bigint not null, status text not null default 'proposed' check(status in ('proposed','approved','running','succeeded','unknown','failed','rejected','expired')),
  expires_at timestamptz not null, result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create index actions_owner_idx on public.actions(owner_id,created_at desc);
create table public.approvals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), action_id uuid not null,
  payload_hash text not null, policy_version bigint not null, status text not null check(status in ('approved','rejected','revoked')),
  approved_at timestamptz not null default now(), expires_at timestamptz not null,
  foreign key(action_id,owner_id) references public.actions(id,owner_id), unique(action_id,payload_hash)
);
create index approvals_owner_idx on public.approvals(owner_id,approved_at desc);
create table public.jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('document.extract','finance.extract','calendar.sync','calendar.apply','planner.week','fitness.sync','life.organize','projects.sync')),
  payload jsonb not null default '{}', status text not null default 'queued' check(status in ('queued','running','succeeded','failed','cancelled','unknown')),
  idempotency_key text not null, available_at timestamptz not null default now(), attempt integer not null default 0, max_attempts integer not null default 5,
  worker_id uuid, lease_token uuid, lease_until timestamptz, heartbeat_at timestamptz, result jsonb, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
  unique(owner_id,idempotency_key), check(jsonb_typeof(payload)='object')
);
create index jobs_pending_idx on public.jobs(available_at,created_at) where status in ('queued','running');
create index jobs_owner_idx on public.jobs(owner_id,created_at desc);
create table public.captures (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), source text not null,
  external_id text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), data jsonb not null, job_id uuid references public.jobs(id),
  document_id uuid references public.documents(id), evidence_id uuid references public.financial_evidence(id), created_at timestamptz not null default now(),
  unique(owner_id,source,external_id), unique(owner_id,sha256)
);
create table public.gym_state (
  owner_id uuid primary key references auth.users(id), state jsonb not null default '{}', rev bigint not null default 0,
  wid uuid not null default gen_random_uuid(), updated_at timestamptz not null default now()
);
create table public.gym_snapshots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  purpose text not null check(purpose in ('upload','download')), base_rev bigint, base_wid uuid, stamped boolean not null default false,
  parts integer not null check(parts between 1 and 32), bytes integer not null check(bytes between 0 and 8388608), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  state_rev bigint, state_wid uuid, created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '1 hour'), committed boolean not null default false,
  unique(id,owner_id)
);
create table public.gym_snapshot_chunks (
  snapshot_id uuid not null, index integer not null check(index>=0 and index<32), data text not null check(length(data)<=349528), owner_id uuid not null,
  primary key(snapshot_id,index), foreign key(snapshot_id,owner_id) references public.gym_snapshots(id,owner_id) on delete cascade
);
create index gym_snapshots_owner_idx on public.gym_snapshots(owner_id,expires_at);

create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
do $$ declare t text; begin
  foreach t in array array['records','documents','financial_accounts','financial_evidence','transactions','budgets','workspace_settings','policies','actions','jobs'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
  end loop;
end; $$;

-- All public domain tables are deny-by-default for anonymous and machine identities.
do $$ declare t text; begin
  foreach t in array array['records','documents','fragments','financial_accounts','financial_evidence','transactions','budgets','workspace_settings','policies','actions','approvals','jobs','captures','gym_state','gym_snapshots','gym_snapshot_chunks'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select public.is_workspace_owner()))',t);
  end loop;
  foreach t in array array['records','documents','financial_accounts','financial_evidence','transactions','budgets','gym_snapshots','gym_snapshot_chunks'] loop
    execute format('grant insert,update on table public.%I to authenticated',t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id=(select auth.uid()) and (select public.is_workspace_owner()))',t);
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id=(select auth.uid()) and (select public.is_workspace_owner())) with check (owner_id=(select auth.uid()) and (select public.is_workspace_owner()))',t);
  end loop;
end; $$;

create function private.require_owner() returns uuid language plpgsql stable security definer set search_path='' as $$
begin if not private.is_workspace_owner() then raise exception 'Workspace owner authorization required' using errcode='42501'; end if; return auth.uid(); end; $$;
create function private.require_worker(p_scope text default null) returns private.workers language plpgsql security definer set search_path='' as $$
declare w private.workers; begin
  select * into w from private.workers where worker_user_id=auth.uid() and enabled;
  if w.worker_user_id is null or not exists(select 1 from private.workspace_owners where owner_id=w.owner_id) or (p_scope is not null and not p_scope=any(w.scopes)) then
    raise exception 'Worker scope is not authorized' using errcode='42501'; end if;
  update private.workers set last_seen_at=now() where worker_user_id=w.worker_user_id; return w;
end; $$;
create function private.require_lease(p_job_id uuid,p_lease_token uuid) returns public.jobs language plpgsql security definer set search_path='' as $$
declare j public.jobs; w private.workers; begin
  w=private.require_worker();
  select * into j from public.jobs where id=p_job_id and owner_id=w.owner_id for update;
  if j.id is null or j.status<>'running' or j.worker_id<>w.worker_user_id or j.lease_token is distinct from p_lease_token or j.lease_until<=now() or not j.kind=any(w.scopes) then
    raise exception 'Job lease is invalid or expired' using errcode='42501'; end if;
  if coalesce((select (data->>'paused')::boolean from public.policies where owner_id=w.owner_id),true) then raise exception 'Execution is paused' using errcode='42501'; end if;
  return j;
end; $$;

create function private.bootstrap_owner(p_owner_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing uuid; begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' and session_user<>'postgres' then raise exception 'Service role required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_owner_id) then raise exception 'Auth user does not exist'; end if;
  perform pg_advisory_xact_lock(12061992);
  select owner_id into existing from private.workspace_owners where singleton;
  if existing is not null and existing<>p_owner_id then raise exception 'Workspace already has an owner' using errcode='42501'; end if;
  insert into private.workspace_owners(owner_id) values(p_owner_id) on conflict(singleton) do nothing;
  insert into public.policies(owner_id) values(p_owner_id) on conflict do nothing;
  insert into public.workspace_settings(owner_id,key,value) values(p_owner_id,'preferences','{"timezone":"America/Santiago","currency":"CLP","quiet_hours":{"start":"22:00","end":"08:00"}}') on conflict do nothing;
  insert into public.gym_state(owner_id) values(p_owner_id) on conflict do nothing;
  return jsonb_build_object('owner_id',p_owner_id,'configured',true);
end; $$;
create function public.bootstrap_owner(p_owner_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.bootstrap_owner(p_owner_id); $$;
revoke all on function public.bootstrap_owner(uuid) from public,anon,authenticated;
grant execute on function public.bootstrap_owner(uuid),private.bootstrap_owner(uuid) to service_role;

create function private.register_worker(p_worker_user_id uuid,p_scopes text[],p_label text default 'HP') returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; valid text[]:=array['document.extract','finance.extract','calendar.sync','calendar.apply','planner.week','fitness.sync','life.organize','projects.sync','ingest.gmail','ingest.telegram']; begin
  select owner_id into owner from private.workspace_owners where singleton;
  if owner is null or p_worker_user_id=owner or not exists(select 1 from auth.users where id=p_worker_user_id) then raise exception 'Dedicated worker Auth identity required'; end if;
  if cardinality(p_scopes)=0 or not p_scopes<@valid then raise exception 'Invalid worker scopes'; end if;
  insert into private.workers(worker_user_id,owner_id,scopes,label) values(p_worker_user_id,owner,p_scopes,left(p_label,100))
    on conflict(worker_user_id) do update set owner_id=excluded.owner_id,scopes=excluded.scopes,label=excluded.label,enabled=true;
  return jsonb_build_object('worker_id',p_worker_user_id,'owner_id',owner,'scopes',p_scopes,'enabled',true);
end; $$;
create function public.register_worker(p_worker_user_id uuid,p_scopes text[],p_label text default 'HP') returns jsonb language sql security invoker set search_path='' as $$ select private.register_worker(p_worker_user_id,p_scopes,p_label); $$;
revoke all on function public.register_worker(uuid,text[],text) from public,anon,authenticated;
grant execute on function public.register_worker(uuid,text[],text),private.register_worker(uuid,text[],text) to service_role;

create function private.get_workspace_settings() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); p public.policies; s jsonb; begin
  select * into p from public.policies where owner_id=owner;
  select coalesce(jsonb_object_agg(key,value),'{}') into s from public.workspace_settings where owner_id=owner;
  return jsonb_build_object('settings',s,'policy',p.data||jsonb_build_object('version',p.version),'paused',coalesce((p.data->>'paused')::boolean,true));
end; $$;
create function public.get_workspace_settings() returns jsonb language sql security invoker set search_path='' as $$ select private.get_workspace_settings(); $$;
create function private.set_workspace_settings(p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); item record; begin
  if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>65536 then raise exception 'Settings must be a small JSON object'; end if;
  for item in select * from jsonb_each(p_settings) loop
    if item.key not in ('preferences','calendar','notifications','goals','integrations','finance','study','fitness') then raise exception 'Unknown settings key: %',item.key; end if;
    insert into public.workspace_settings(owner_id,key,value) values(owner,item.key,item.value) on conflict(owner_id,key) do update set value=excluded.value;
  end loop;
  return private.get_workspace_settings();
end; $$;
create function public.set_workspace_settings(p_settings jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.set_workspace_settings(p_settings); $$;
create function private.set_execution_paused(p_paused boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); v bigint; begin
  if p_paused is null then raise exception 'Paused must be a boolean'; end if;
  update public.policies set data=jsonb_set(data,'{paused}',to_jsonb(p_paused)),version=version+1 where owner_id=owner returning version into v;
  return jsonb_build_object('paused',p_paused,'policy_version',v);
end; $$;
create function public.set_execution_paused(p_paused boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.set_execution_paused(p_paused); $$;

create function private.enqueue_job(p_kind text,p_payload jsonb,p_idempotency_key text) returns public.jobs language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); j public.jobs; begin
  if p_kind='calendar.apply' then raise exception 'Calendar writes must originate from an approved action' using errcode='42501'; end if;
  if p_kind not in ('document.extract','finance.extract','calendar.sync','planner.week','fitness.sync','life.organize','projects.sync') or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>131072 or length(p_idempotency_key) not between 1 and 200 then raise exception 'Invalid job request'; end if;
  if p_kind='document.extract' and not exists(select 1 from public.documents where id=(p_payload->>'document_id')::uuid and owner_id=owner) then raise exception 'Document not found'; end if;
  if p_kind='finance.extract' and not exists(select 1 from public.financial_evidence where id=(p_payload->>'evidence_id')::uuid and owner_id=owner) then raise exception 'Evidence not found'; end if;
  insert into public.jobs(owner_id,kind,payload,idempotency_key) values(owner,p_kind,p_payload,p_idempotency_key) on conflict(owner_id,idempotency_key) do nothing returning * into j;
  if j.id is null then select * into j from public.jobs where owner_id=owner and idempotency_key=p_idempotency_key;
    if j.kind<>p_kind or j.payload<>p_payload then raise exception 'Idempotency key was already used for a different request' using errcode='23505'; end if;
  end if; return j;
end; $$;
create function public.enqueue_job(p_kind text,p_payload jsonb,p_idempotency_key text) returns public.jobs language sql security invoker set search_path='' as $$ select private.enqueue_job(p_kind,p_payload,p_idempotency_key); $$;

create function private.claim_jobs(p_limit integer default 1) returns setof public.jobs language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker(); begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'Claim limit must be 1 to 5'; end if;
  if coalesce((select (data->>'paused')::boolean from public.policies where owner_id=w.owner_id),true) then return; end if;
  -- Never automatically repeat an external effect whose completion became uncertain.
  update public.jobs set status='unknown',error='Lease expired during an external write; reconcile before retry',finished_at=now() where owner_id=w.owner_id and kind='calendar.apply' and status='running' and lease_until<=now();
  update public.actions set status='unknown' where owner_id=w.owner_id and status='running' and id in(select (payload->>'action_id')::uuid from public.jobs where owner_id=w.owner_id and kind='calendar.apply' and status='unknown');
  update public.jobs set status='failed',error='Maximum attempts exceeded',finished_at=now() where owner_id=w.owner_id and status in ('queued','running') and attempt>=max_attempts and (lease_until is null or lease_until<=now());
  return query update public.jobs j set status='running',attempt=j.attempt+1,worker_id=w.worker_user_id,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',heartbeat_at=now()
    where j.id in(select q.id from public.jobs q where q.owner_id=w.owner_id and q.kind=any(w.scopes) and q.attempt<q.max_attempts and q.available_at<=now() and (q.status='queued' or(q.status='running' and q.lease_until<=now())) order by q.available_at,q.created_at limit p_limit for update skip locked) returning j.*;
end; $$;
create function public.claim_jobs(p_limit integer default 1) returns setof public.jobs language sql security invoker set search_path='' as $$ select * from private.claim_jobs(p_limit); $$;
create function private.heartbeat_job(p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs:=private.require_lease(p_job_id,p_lease_token); expiry timestamptz; begin
  update public.jobs set lease_until=now()+interval '5 minutes',heartbeat_at=now() where id=j.id returning lease_until into expiry;
  return jsonb_build_object('ok',true,'lease_until',expiry);
end; $$;
create function public.heartbeat_job(p_job_id uuid,p_lease_token uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.heartbeat_job(p_job_id,p_lease_token); $$;

create function private.get_job_context(p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs:=private.require_lease(p_job_id,p_lease_token); result jsonb:=jsonb_build_object('job',to_jsonb(j)); begin
  if j.kind='document.extract' then result=result||jsonb_build_object('document',(select to_jsonb(d) from public.documents d where d.id=(j.payload->>'document_id')::uuid and owner_id=j.owner_id));
  elsif j.kind='finance.extract' then result=result||jsonb_build_object('evidence',(select to_jsonb(e) from public.financial_evidence e where e.id=(j.payload->>'evidence_id')::uuid and owner_id=j.owner_id));
  elsif j.kind in ('planner.week','calendar.sync','fitness.sync','life.organize','projects.sync') then
    result=result||jsonb_build_object('records',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from public.records where owner_id=j.owner_id and deleted_at is null and kind in ('task','goal','project','event','assessment','training_plan','course','topic') order by updated_at desc limit 500) r));
  end if;
  -- Only reviewed settings; no OAuth secrets are stored in this table.
  return result||jsonb_build_object('settings',(select coalesce(jsonb_object_agg(key,value),'{}') from public.workspace_settings where owner_id=j.owner_id and key in ('preferences','calendar','study','fitness','goals')));
end; $$;
create function public.get_job_context(p_job_id uuid,p_lease_token uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.get_job_context(p_job_id,p_lease_token); $$;

create function private.complete_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs:=private.require_lease(p_job_id,p_lease_token); item jsonb; idx integer:=0; target uuid; state text:='succeeded'; evidence public.financial_evidence; begin
  if jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>3000000 then raise exception 'Result must be a JSON object below 3 MB'; end if;
  if j.kind='document.extract' then
    target=(j.payload->>'document_id')::uuid;
    if not exists(select 1 from public.documents where id=target and owner_id=j.owner_id) then raise exception 'Job document missing'; end if;
    if jsonb_typeof(p_result->'fragments') is distinct from 'array' or jsonb_array_length(p_result->'fragments')>3000 then raise exception 'Invalid fragments'; end if;
    delete from public.fragments where document_id=target and owner_id=j.owner_id;
    for item in select * from jsonb_array_elements(p_result->'fragments') loop
      if jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text') not between 1 and 30000 or jsonb_typeof(item->'locator') is distinct from 'object' then raise exception 'Invalid fragment'; end if;
      insert into public.fragments(owner_id,document_id,position,locator,text,source_sha256) select j.owner_id,target,idx,item->'locator',item->>'text',sha256 from public.documents where id=target and owner_id=j.owner_id; idx=idx+1;
    end loop;
    update public.documents set status='indexed',data=data||jsonb_build_object('summary',p_result->'summary','warnings',coalesce(p_result->'warnings','[]'),'indexed_at',now()) where id=target and owner_id=j.owner_id;
  elsif j.kind='finance.extract' then
    select * into evidence from public.financial_evidence where id=(j.payload->>'evidence_id')::uuid and owner_id=j.owner_id;
    if evidence.id is null then raise exception 'Job evidence missing'; end if;
    if p_result ? 'amount_minor' and (jsonb_typeof(p_result->'amount_minor')<>'number' or (p_result->>'amount_minor')::numeric<>trunc((p_result->>'amount_minor')::numeric)) then raise exception 'Amount must be integer minor units'; end if;
    insert into public.transactions(owner_id,evidence_id,amount_minor,currency,merchant,description,occurred_at,confidence,status,data)
      values(j.owner_id,evidence.id,(p_result->>'amount_minor')::bigint,coalesce(p_result->>'currency','CLP'),left(p_result->>'merchant',500),coalesce(p_result->>'description',evidence.title),(nullif(p_result->>'occurred_at',''))::timestamptz,(p_result->>'confidence')::numeric,'draft',jsonb_build_object('extraction',p_result))
      on conflict(evidence_id) do update set amount_minor=excluded.amount_minor,currency=excluded.currency,merchant=excluded.merchant,description=excluded.description,occurred_at=excluded.occurred_at,confidence=excluded.confidence,data=excluded.data where public.transactions.status='draft';
    update public.financial_evidence set status='needs_review',data=data||jsonb_build_object('extraction',p_result) where id=evidence.id;
  elsif j.kind='calendar.sync' then
    if jsonb_typeof(p_result->'events') is distinct from 'array' or jsonb_array_length(p_result->'events')>2000 then raise exception 'Invalid event batch'; end if;
    for item in select * from jsonb_array_elements(p_result->'events') loop
      if nullif(item->>'external_id','') is null or length(item->>'title')>1000 or (item->>'end_at')::timestamptz <= (item->>'start_at')::timestamptz then raise exception 'Invalid calendar event'; end if;
      select id into target from public.records where owner_id=j.owner_id and kind='event' and data->>'connection_id'=j.payload->>'connection_id' and data->>'external_id'=item->>'external_id';
      if target is null then
        insert into public.records(owner_id,kind,title,status,due_at,data) values(j.owner_id,'event',coalesce(nullif(item->>'title',''),'(sin título)'),coalesce(item->>'status','confirmed'),(item->>'start_at')::timestamptz,item||jsonb_build_object('connection_id',j.payload->>'connection_id','source','google'));
      else update public.records set title=coalesce(nullif(item->>'title',''),'(sin título)'),status=coalesce(item->>'status','confirmed'),due_at=(item->>'start_at')::timestamptz,data=item||jsonb_build_object('connection_id',j.payload->>'connection_id','source','google') where id=target and owner_id=j.owner_id; end if;
    end loop;
  elsif j.kind='calendar.apply' then
    if p_result->>'outcome' not in ('succeeded','unknown') then raise exception 'Calendar effect outcome required'; end if;
    state=p_result->>'outcome';
    update public.actions set status=state,result=p_result where id=(j.payload->>'action_id')::uuid and owner_id=j.owner_id and status='running';
    if not found then raise exception 'Action was not authorized for execution'; end if;
  elsif j.kind='planner.week' then
    if jsonb_typeof(p_result->'blocks') is distinct from 'array' or jsonb_array_length(p_result->'blocks')>200 then raise exception 'Invalid planner blocks'; end if;
    for item in select * from jsonb_array_elements(p_result->'blocks') loop
      if item->>'kind' not in ('study','training','work','rest') or nullif(item->>'title','') is null or (item->>'end_at')::timestamptz<=(item->>'start_at')::timestamptz then raise exception 'Invalid planner block'; end if;
      if item ? 'source_id' and not exists(select 1 from public.records where id=(item->>'source_id')::uuid and owner_id=j.owner_id and deleted_at is null) then raise exception 'Planner source is outside the workspace'; end if;
    end loop;
    insert into public.records(owner_id,kind,title,status,data) values(j.owner_id,'decision','Propuesta de planificación semanal','proposed',p_result||jsonb_build_object('job_id',j.id));
  elsif j.kind='fitness.sync' then
    if jsonb_typeof(p_result->'metrics') is distinct from 'array' or jsonb_array_length(p_result->'metrics')>1000 then raise exception 'Invalid health metric batch'; end if;
    for item in select * from jsonb_array_elements(p_result->'metrics') loop
      insert into public.records(owner_id,kind,title,data) values(j.owner_id,'health_metric',left(coalesce(item->>'name','Métrica importada'),1000),item||jsonb_build_object('source',j.payload->>'source','job_id',j.id));
    end loop;
  elsif j.kind='life.organize' then
    if jsonb_typeof(p_result->'proposals') is distinct from 'array' or jsonb_array_length(p_result->'proposals')>100 then raise exception 'Invalid organization proposals'; end if;
    for item in select * from jsonb_array_elements(p_result->'proposals') loop
      if not exists(select 1 from public.records where id=(item->>'record_id')::uuid and owner_id=j.owner_id and deleted_at is null) then raise exception 'Proposal record is outside the workspace'; end if;
    end loop;
    insert into public.records(owner_id,kind,title,status,data) values(j.owner_id,'decision','Propuesta de organización','proposed',p_result||jsonb_build_object('job_id',j.id));
  elsif j.kind='projects.sync' then
    if jsonb_typeof(p_result->'projects') is distinct from 'array' or jsonb_array_length(p_result->'projects')>100 then raise exception 'Invalid projects batch'; end if;
    for item in select * from jsonb_array_elements(p_result->'projects') loop
      if length(item->>'title') not between 1 and 500 then raise exception 'Invalid project title'; end if;
      select id into target from public.records where owner_id=j.owner_id and kind='project' and data->>'repository'=item->>'repository';
      if target is null then insert into public.records(owner_id,kind,title,data) values(j.owner_id,'project',item->>'title',item);
      else update public.records set data=data||item where id=target and owner_id=j.owner_id; end if;
    end loop;
  end if;
  update public.jobs set status=state,result=p_result,finished_at=now(),lease_until=null where id=j.id;
  return jsonb_build_object('ok',true,'job_id',j.id,'status',state);
end; $$;
create function public.complete_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.complete_job(p_job_id,p_lease_token,p_result); $$;
create function private.fail_job(p_job_id uuid,p_lease_token uuid,p_error text,p_retryable boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs:=private.require_lease(p_job_id,p_lease_token); state text; begin
  state=case when j.kind='calendar.apply' then 'unknown' when p_retryable and j.attempt<j.max_attempts then 'queued' else 'failed' end;
  update public.jobs set status=state,error=left(p_error,4000),available_at=now()+make_interval(secs=>least(3600,30*power(2,least(j.attempt,6))::integer)),lease_until=null,finished_at=case when state<>'queued' then now() else null end where id=j.id;
  if j.kind='calendar.apply' then update public.actions set status='unknown',result=jsonb_build_object('error',left(p_error,4000)) where id=(j.payload->>'action_id')::uuid and owner_id=j.owner_id and status='running'; end if;
  return jsonb_build_object('ok',true,'status',state);
end; $$;
create function public.fail_job(p_job_id uuid,p_lease_token uuid,p_error text,p_retryable boolean default true) returns jsonb language sql security invoker set search_path='' as $$ select private.fail_job(p_job_id,p_lease_token,p_error,p_retryable); $$;

create function private.propose_action(p_operation text,p_payload jsonb,p_resource jsonb,p_expires timestamptz default null) returns public.actions language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); a public.actions; v bigint; expires timestamptz:=coalesce(p_expires,now()+interval '24 hours'); envelope jsonb; begin
  if p_operation not in ('calendar.create','calendar.update','calendar.cancel','calendar.delete','calendar.invite') or jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_resource)<>'object' or octet_length(p_payload::text)>65536 or expires<=now() or expires>now()+interval '7 days' then raise exception 'Invalid action proposal'; end if;
  if nullif(p_resource->>'calendar_id','') is null then raise exception 'Calendar resource is required'; end if;
  select version into v from public.policies where owner_id=owner;
  envelope=jsonb_build_object('operation',p_operation,'payload',p_payload,'resource',p_resource,'policy_version',v);
  insert into public.actions(owner_id,operation,payload,resource,payload_hash,policy_version,expires_at) values(owner,p_operation,p_payload,p_resource,encode(sha256(convert_to(envelope::text,'UTF8')),'hex'),v,expires) returning * into a;
  return a;
end; $$;
create function public.propose_action(p_operation text,p_payload jsonb,p_resource jsonb,p_expires timestamptz default null) returns public.actions language sql security invoker set search_path='' as $$ select private.propose_action(p_operation,p_payload,p_resource,p_expires); $$;
create function private.approve_action(p_id uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); a public.actions; p public.policies; jid uuid; begin
  select * into a from public.actions where id=p_id and owner_id=owner for update;
  select * into p from public.policies where owner_id=owner;
  if a.id is null or a.status not in ('proposed','approved') or a.payload_hash is distinct from p_hash or a.expires_at<=now() or a.policy_version<>p.version then raise exception 'Action proposal changed or expired' using errcode='42501'; end if;
  insert into public.approvals(owner_id,action_id,payload_hash,policy_version,status,expires_at) values(owner,a.id,a.payload_hash,p.version,'approved',a.expires_at) on conflict(action_id,payload_hash) do update set status='approved',approved_at=now();
  update public.actions set status='approved' where id=a.id;
  insert into public.jobs(owner_id,kind,payload,idempotency_key) values(owner,'calendar.apply',jsonb_build_object('action_id',a.id),'action:'||a.id) on conflict(owner_id,idempotency_key) do nothing;
  select id into jid from public.jobs where owner_id=owner and idempotency_key='action:'||a.id;
  return jsonb_build_object('approved',true,'action_id',a.id,'job_id',jid,'payload_hash',a.payload_hash);
end; $$;
create function public.approve_action(p_id uuid,p_hash text) returns jsonb language sql security invoker set search_path='' as $$ select private.approve_action(p_id,p_hash); $$;
create function private.authorize_action(p_job_id uuid,p_lease_token uuid,p_action_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs:=private.require_lease(p_job_id,p_lease_token); a public.actions; p public.policies; begin
  if j.kind<>'calendar.apply' or j.payload->>'action_id'<>p_action_id::text then raise exception 'Action is not assigned to this job' using errcode='42501'; end if;
  select * into a from public.actions where id=p_action_id and owner_id=j.owner_id for update;
  select * into p from public.policies where owner_id=j.owner_id;
  if a.id is null or a.status<>'approved' or a.expires_at<=now() or a.policy_version<>p.version or coalesce((p.data->>'paused')::boolean,true) or not exists(select 1 from public.approvals where action_id=a.id and owner_id=j.owner_id and status='approved' and payload_hash=a.payload_hash and policy_version=p.version and expires_at>now()) then raise exception 'Current approval required' using errcode='42501'; end if;
  update public.actions set status='running' where id=a.id;
  return jsonb_build_object('action_id',a.id,'operation',a.operation,'payload',a.payload,'resource',a.resource,'payload_hash',a.payload_hash);
end; $$;
create function public.authorize_action(p_job_id uuid,p_lease_token uuid,p_action_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.authorize_action(p_job_id,p_lease_token,p_action_id); $$;

create function private.worker_ingest(p_source text,p_external_id text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker('ingest.'||p_source); c public.captures; target uuid; jid uuid; classification text; kind text; payload jsonb; begin
  if p_source not in ('gmail','telegram') or length(p_external_id) not between 1 and 1000 or jsonb_typeof(p_payload)<>'object' or (p_payload->>'sha256') !~ '^[a-f0-9]{64}$' or p_payload->>'storage_path' not like w.owner_id::text||'/captures/%' or nullif(p_payload->>'mime','') is null then raise exception 'Invalid capture'; end if;
  perform pg_advisory_xact_lock(hashtextextended(w.owner_id::text||':'||p_source||':'||p_external_id,0));
  select * into c from public.captures where owner_id=w.owner_id and((source=p_source and external_id=p_external_id) or sha256=p_payload->>'sha256') order by created_at limit 1;
  if c.id is not null then return jsonb_build_object('capture_id',c.id,'job_id',c.job_id,'duplicate',true); end if;
  classification=coalesce(p_payload->>'classification',case when p_source='gmail' then 'financial_evidence' else 'document' end);
  if classification='financial_evidence' then
    insert into public.financial_evidence(owner_id,title,source,external_id,sha256,mime,storage_path,size_bytes,data) values(w.owner_id,coalesce(p_payload->>'title','Comprobante importado'),p_source,p_external_id,p_payload->>'sha256',p_payload->>'mime',p_payload->>'storage_path',(p_payload->>'size_bytes')::bigint,jsonb_build_object('capture',p_payload)) on conflict(owner_id,sha256) where sha256 is not null do update set updated_at=public.financial_evidence.updated_at returning id into target;
    kind='finance.extract'; payload=jsonb_build_object('evidence_id',target);
  elsif classification='document' then
    insert into public.documents(owner_id,title,mime,storage_path,sha256,size_bytes,file_name,data) values(w.owner_id,coalesce(p_payload->>'title','Documento importado'),p_payload->>'mime',p_payload->>'storage_path',p_payload->>'sha256',(p_payload->>'size_bytes')::bigint,p_payload->>'file_name',jsonb_build_object('source',p_source)) on conflict(owner_id,sha256) where sha256 is not null do update set updated_at=public.documents.updated_at returning id into target;
    kind='document.extract';payload=jsonb_build_object('document_id',target);
  else raise exception 'Unsupported capture classification'; end if;
  insert into public.jobs(owner_id,kind,payload,idempotency_key) values(w.owner_id,kind,payload,'capture:'||p_source||':'||p_external_id) returning id into jid;
  insert into public.captures(owner_id,source,external_id,sha256,data,job_id,document_id,evidence_id) values(w.owner_id,p_source,p_external_id,p_payload->>'sha256',p_payload,jid,case when classification='document' then target else null end,case when classification='financial_evidence' then target else null end) returning * into c;
  return jsonb_build_object('capture_id',c.id,'job_id',jid,'duplicate',false);
end; $$;
create function public.worker_ingest(p_source text,p_external_id text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.worker_ingest(p_source,p_external_id,p_payload); $$;

create function private.get_gym_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); g public.gym_state; begin
  insert into public.gym_state(owner_id) values(owner) on conflict do nothing;
  select * into g from public.gym_state where owner_id=owner;
  return jsonb_build_object('state',g.state,'rev',g.rev,'wid',g.wid);
end; $$;
create function public.get_gym_state() returns jsonb language sql security invoker set search_path='' as $$ select private.get_gym_state(); $$;
create function private.put_gym_state(p_state jsonb,p_base_rev bigint,p_base_wid uuid,p_stamped boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); g public.gym_state; vstate jsonb:=p_state-'active'; nextwid uuid; ts timestamptz:=now(); begin
  if jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>8388608 then raise exception 'Gym state must be an object below 8 MB'; end if;
  insert into public.gym_state(owner_id) values(owner) on conflict do nothing;
  select * into g from public.gym_state where owner_id=owner for update;
  if p_base_rev is distinct from g.rev or p_base_wid is distinct from g.wid then return jsonb_build_object('conflict',true,'state',g.state,'rev',g.rev,'wid',g.wid); end if;
  nextwid=gen_random_uuid();
  update public.gym_state set state=vstate,rev=g.rev+1,wid=nextwid,updated_at=ts where owner_id=owner;
  return jsonb_build_object('ok',true,'rev',g.rev+1,'wid',nextwid,'ts',ts);
end; $$;
create function public.put_gym_state(p_state jsonb,p_base_rev bigint,p_base_wid uuid,p_stamped boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.put_gym_state(p_state,p_base_rev,p_base_wid,p_stamped); $$;

create function private.ui_worker_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); seen timestamptz; enabled_count integer; begin
  select max(last_seen_at),count(*) filter(where enabled) into seen,enabled_count from private.workers where owner_id=owner;
  return jsonb_build_object('online',seen>now()-interval '10 minutes' and enabled_count>0,'last_seen_at',seen,'enabled_workers',enabled_count);
end; $$;
create function public.ui_worker_status() returns jsonb language sql security invoker set search_path='' as $$ select private.ui_worker_status(); $$;

-- Expose invoker wrappers only. Private schema is NOT added to PostgREST exposed schemas.
do $$ declare p record; begin
  for p in select n.nspname,proc.oid::regprocedure signature,proc.proname from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace where n.nspname in ('private','public') and proc.proname in ('is_workspace_owner','get_workspace_settings','set_workspace_settings','set_execution_paused','enqueue_job','claim_jobs','heartbeat_job','get_job_context','complete_job','fail_job','propose_action','approve_action','authorize_action','worker_ingest','get_gym_state','put_gym_state','ui_worker_status') loop
    execute format('revoke all on function %s from public,anon',p.signature);
    execute format('grant execute on function %s to authenticated',p.signature);
  end loop;
end; $$;
revoke all on all tables in schema private from public,anon,authenticated;

-- Storage is provisioned by Supabase; guarded for local PostgreSQL tests.
create function private.worker_can_read_path(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.workers w join public.jobs j on j.worker_id=w.worker_user_id and j.owner_id=w.owner_id
    where w.worker_user_id=auth.uid() and w.enabled and j.status='running' and j.lease_until>now() and j.kind=any(w.scopes)
      and exists(select 1 from private.workspace_owners o where o.owner_id=w.owner_id)
      and not coalesce((select (data->>'paused')::boolean from public.policies where owner_id=w.owner_id),true)
      and ((j.kind='document.extract' and exists(select 1 from public.documents d where d.id=(j.payload->>'document_id')::uuid and d.owner_id=w.owner_id and d.storage_path=p_path))
        or (j.kind='finance.extract' and exists(select 1 from public.financial_evidence e where e.id=(j.payload->>'evidence_id')::uuid and e.owner_id=w.owner_id and e.storage_path=p_path))));
$$;
create function private.worker_can_upload_path(p_path text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.workers w where w.worker_user_id=auth.uid() and w.enabled and (('ingest.gmail'=any(w.scopes)) or ('ingest.telegram'=any(w.scopes)))
    and exists(select 1 from private.workspace_owners o where o.owner_id=w.owner_id) and p_path like w.owner_id::text||'/captures/%'
    and not coalesce((select (data->>'paused')::boolean from public.policies where owner_id=w.owner_id),true));
$$;
revoke all on function private.worker_can_read_path(text),private.worker_can_upload_path(text) from public,anon;
grant execute on function private.worker_can_read_path(text),private.worker_can_upload_path(text) to authenticated;
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('personal-files','personal-files',false,52428800,array['application/pdf','text/plain','text/csv','message/rfc822','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
    execute $policy$create policy personal_files_owner_read on storage.objects for select to authenticated using(bucket_id='personal-files' and split_part(name,'/',1)=(select auth.uid())::text and (select public.is_workspace_owner()))$policy$;
    execute $policy$create policy personal_files_owner_insert on storage.objects for insert to authenticated with check(bucket_id='personal-files' and split_part(name,'/',1)=(select auth.uid())::text and (select public.is_workspace_owner()))$policy$;
    execute $policy$create policy personal_files_worker_read on storage.objects for select to authenticated using(bucket_id='personal-files' and private.worker_can_read_path(name))$policy$;
    execute $policy$create policy personal_files_worker_insert on storage.objects for insert to authenticated with check(bucket_id='personal-files' and private.worker_can_upload_path(name))$policy$;
  end if;
end; $$;
