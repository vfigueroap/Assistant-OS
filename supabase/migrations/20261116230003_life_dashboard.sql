-- Dashboard projections contain summaries only. Original captures stay on the homelab.
create table public.dashboard_snapshots (
  owner_id uuid not null references auth.users(id),
  area text not null check (area in ('work','health','spirituality','romantic','family-friends','five-buckets','system','business','education')),
  source text not null, delivery_id uuid not null,
  observed_at timestamptz not null, received_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=262144),
  primary key(owner_id,area,source)
);
alter table public.dashboard_snapshots enable row level security;
revoke all on public.dashboard_snapshots from public,anon,authenticated;
grant select on public.dashboard_snapshots to authenticated;
create policy dashboard_owner_read on public.dashboard_snapshots for select to authenticated
  using(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));

create unique index accounts_external_ref_idx on public.financial_accounts(owner_id,(data->>'source'),(data->>'external_id'))
  where data->>'source' is not null and data->>'external_id' is not null;
create table public.financial_valuations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), account_id uuid not null,
  source text not null, external_id text not null, kind text not null check(kind in ('asset','liability')),
  currency text not null check(currency ~ '^[A-Z]{3}$'), amount_minor bigint not null check(amount_minor between 0 and 9007199254740991),
  valued_at timestamptz not null, source_ref text not null, created_at timestamptz not null default now(),
  foreign key(account_id,owner_id) references public.financial_accounts(id,owner_id),
  unique(owner_id,source,external_id,valued_at)
);
create index valuations_account_date_idx on public.financial_valuations(owner_id,account_id,valued_at desc);
alter table public.financial_valuations enable row level security;
revoke all on public.financial_valuations from public,anon,authenticated;
grant select on public.financial_valuations to authenticated;
create policy valuations_owner_read on public.financial_valuations for select to authenticated
  using(owner_id=(select auth.uid()) and (select public.is_workspace_owner()));

create function private.validate_dashboard_delivery(p jsonb) returns void language plpgsql set search_path='' as $$
declare item jsonb; metric jsonb; k text; n numeric; begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144 or p-'version'-'id'-'area'-'source'-'observed_at'-'summary'-'metrics'-'items'-'references'-'telemetry'-'valuations'<>'{}' then raise exception 'Invalid dashboard delivery'; end if;
  if p->'version' is distinct from '1'::jsonb or coalesce(p->>'area','') not in ('work','health','spirituality','romantic','family-friends','five-buckets','system','business','education')
    or coalesce(p->>'source','') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$'
    or coalesce(p->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'summary') is distinct from 'string' or length(p->>'summary')>20000
    or jsonb_typeof(p->'observed_at') is distinct from 'string' or (p->>'observed_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    or (p->>'observed_at')::timestamptz>now()+interval '30 seconds' then raise exception 'Invalid dashboard identity or observation'; end if;
  foreach k in array array['metrics','items','references','telemetry','valuations'] loop
    if jsonb_typeof(coalesce(p->k,'[]')) is distinct from 'array' or jsonb_array_length(coalesce(p->k,'[]'))>(case when k='metrics' then 30 when k='items' then 200 else 100 end) then raise exception 'Invalid dashboard collection'; end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p->'metrics','[]')) loop
    if exists(select 1 from jsonb_each(item-'value') f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid dashboard field type'; end if;
    if jsonb_typeof(item) is distinct from 'object' or item-'key'-'label'-'value'-'unit'-'currency'<>'{}'
      or length(coalesce(item->>'key','')) not between 1 and 100 or length(coalesce(item->>'label','')) not between 1 and 200
      or coalesce(jsonb_typeof(item->'value'),'null') not in ('number','string') or length(item->>'value')>1000
      or (item ? 'unit' and length(coalesce(item->>'unit','')) not between 1 and 50)
      or (item ? 'currency' and coalesce(item->>'currency','') !~ '^[A-Z]{3}$') then raise exception 'Invalid dashboard metric'; end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    if exists(select 1 from jsonb_each(item) f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid dashboard field type'; end if;
    if jsonb_typeof(item) is distinct from 'object' or item-'id'-'title'-'kind'-'status'-'due_at'-'bucket'-'source_ref'<>'{}'
      or length(coalesce(item->>'id','')) not between 1 and 200 or length(coalesce(item->>'title','')) not between 1 and 1000
      or coalesce(item->>'kind','') not in ('activity','current','next','reflection','opportunity','contact','learning','skill','resource','reputation','plan')
      or (item ? 'bucket' and coalesce(item->>'bucket','') not in ('knowledge','skill','resources','network','reputation'))
      or (item ? 'status' and length(coalesce(item->>'status','')) not between 1 and 100)
      or (item ? 'source_ref' and length(coalesce(item->>'source_ref','')) not between 1 and 500) then raise exception 'Invalid dashboard item'; end if;
    if item ? 'due_at' then perform (item->>'due_at')::timestamptz; end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p->'references','[]')) loop
    if exists(select 1 from jsonb_each(item) f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid dashboard field type'; end if;
    if jsonb_typeof(item) is distinct from 'object' or item-'source'-'external_id'-'url'-'local_ref'<>'{}'
      or length(coalesce(item->>'source','')) not between 1 and 100
      or (item ? 'external_id' and length(coalesce(item->>'external_id','')) not between 1 and 1000)
      or (item ? 'local_ref' and length(coalesce(item->>'local_ref','')) not between 1 and 500)
      or (item ? 'url' and (length(item->>'url')>4000 or coalesce(item->>'url','') !~ '^https?://[^/@[:space:]]+(/|$)')) then raise exception 'Invalid dashboard reference'; end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p->'telemetry','[]')) loop
    if exists(select 1 from jsonb_each(item-'metrics') f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid dashboard field type'; end if;
    if jsonb_typeof(item) is distinct from 'object' or item-'entity_id'-'kind'-'label'-'status'-'observed_at'-'metrics'<>'{}'
      or length(coalesce(item->>'entity_id','')) not between 1 and 200 or length(coalesce(item->>'label','')) not between 1 and 200
      or coalesce(item->>'kind','') not in ('agent','device','service','connector')
      or coalesce(item->>'status','') not in ('online','idle','busy','error','limited','offline','unconfigured')
      or jsonb_typeof(coalesce(item->'metrics','{}')) is distinct from 'object' then raise exception 'Invalid telemetry'; end if;
    if nullif(item->>'observed_at','') is null or (item->>'observed_at')::timestamptz>now()+interval '30 seconds' then raise exception 'Invalid telemetry observation'; end if;
    if (select count(*) from jsonb_each(coalesce(item->'metrics','{}')))>30 then raise exception 'Too many telemetry metrics'; end if;
    for k,metric in select * from jsonb_each(coalesce(item->'metrics','{}')) loop
      if length(k)>100 or jsonb_typeof(metric) not in ('number','string','boolean','null') or length(metric::text)>1002 then raise exception 'Invalid telemetry metric'; end if;
    end loop;
  end loop;
  if jsonb_array_length(coalesce(p->'valuations','[]'))>0 and p->>'area'<>'work' then raise exception 'Financial valuations belong to work'; end if;
  for item in select * from jsonb_array_elements(coalesce(p->'valuations','[]')) loop
    if exists(select 1 from jsonb_each(item-'amount_minor') f where jsonb_typeof(f.value)<>'string') then raise exception 'Invalid dashboard field type'; end if;
    if jsonb_typeof(item) is distinct from 'object' or item-'account_ref'-'name'-'kind'-'currency'-'amount_minor'-'valued_at'-'source_ref'<>'{}'
      or coalesce(item->>'account_ref','') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$' or length(coalesce(item->>'name','')) not between 1 and 200
      or coalesce(item->>'kind','') not in ('asset','liability') or coalesce(item->>'currency','') !~ '^[A-Z]{3}$'
      or jsonb_typeof(item->'amount_minor') is distinct from 'number' or length(coalesce(item->>'source_ref','')) not between 1 and 500 then raise exception 'Invalid valuation'; end if;
    n=(item->>'amount_minor')::numeric;
    if n<>trunc(n) or n<0 or n>9007199254740991 or nullif(item->>'valued_at','') is null or (item->>'valued_at')::timestamptz>now()+interval '30 seconds' then raise exception 'Invalid valuation amount or date'; end if;
  end loop;
end; $$;

create function private.publish_dashboard(p_delivery jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker('dashboard.publish'); previous public.dashboard_snapshots; item jsonb; account uuid; begin
  perform private.validate_dashboard_delivery(p_delivery);
  perform pg_advisory_xact_lock(hashtextextended(w.owner_id::text||':dashboard:'||(p_delivery->>'area')||':'||(p_delivery->>'source'),0));
  select * into previous from public.dashboard_snapshots where owner_id=w.owner_id and area=p_delivery->>'area' and source=p_delivery->>'source' for update;
  if previous.delivery_id=(p_delivery->>'id')::uuid then
    if previous.payload<>p_delivery then raise exception 'Delivery identity reused with different content'; end if;
    return jsonb_build_object('accepted',false,'duplicate',true,'stale',false);
  end if;
  if previous.observed_at>=(p_delivery->>'observed_at')::timestamptz then return jsonb_build_object('accepted',false,'duplicate',false,'stale',true); end if;
  for item in select * from jsonb_array_elements(coalesce(p_delivery->'valuations','[]')) loop
    select id into account from public.financial_accounts where owner_id=w.owner_id and data->>'source'=p_delivery->>'source' and data->>'external_id'=item->>'account_ref';
    if account is null then
      insert into public.financial_accounts(owner_id,name,currency,kind,data) values(w.owner_id,item->>'name',item->>'currency',item->>'kind',jsonb_build_object('source',p_delivery->>'source','external_id',item->>'account_ref')) returning id into account;
    elsif exists(select 1 from public.financial_accounts where id=account and currency<>item->>'currency') then raise exception 'Account currency cannot change'; end if;
    insert into public.financial_valuations(owner_id,account_id,source,external_id,kind,currency,amount_minor,valued_at,source_ref)
      values(w.owner_id,account,p_delivery->>'source',item->>'account_ref',item->>'kind',item->>'currency',(item->>'amount_minor')::bigint,(item->>'valued_at')::timestamptz,item->>'source_ref')
      on conflict(owner_id,source,external_id,valued_at) do update set amount_minor=excluded.amount_minor,kind=excluded.kind,source_ref=excluded.source_ref;
  end loop;
  insert into public.dashboard_snapshots(owner_id,area,source,delivery_id,observed_at,payload)
    values(w.owner_id,p_delivery->>'area',p_delivery->>'source',(p_delivery->>'id')::uuid,(p_delivery->>'observed_at')::timestamptz,p_delivery)
    on conflict(owner_id,area,source) do update set delivery_id=excluded.delivery_id,observed_at=excluded.observed_at,received_at=now(),payload=excluded.payload;
  return jsonb_build_object('accepted',true,'duplicate',false,'stale',false);
end; $$;
create function public.publish_dashboard(p_delivery jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.publish_dashboard(p_delivery); $$;

create function private.worker_ingest_local(p_source text,p_external_id text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker('ingest.'||p_source); c public.captures; target uuid; tx uuid; extraction jsonb:=coalesce(p_payload->'extraction','{}'); classification text:=p_payload->>'classification'; area text:=coalesce(p_payload->>'area','work'); begin
  if coalesce(p_source,'') not in ('gmail','telegram') or length(coalesce(p_external_id,'')) not between 1 and 1000 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-'title'-'sha256'-'mime'-'size_bytes'-'local_ref'-'classification'-'extraction'-'summary'-'area'<>'{}'
    or length(coalesce(p_payload->>'title','')) not between 1 and 240 or coalesce(p_payload->>'sha256','') !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_payload->>'mime','')) not between 1 and 200 or length(coalesce(p_payload->>'local_ref','')) not between 1 and 500 or p_payload->>'local_ref' !~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$'
    or p_payload->>'local_ref' like '%..%' or coalesce((p_payload->>'size_bytes')::bigint,-1) not between 0 and 20971520
    or coalesce(classification,'') not in ('document','financial_evidence') or area not in ('work','health','spirituality','romantic','family-friends','five-buckets','system','business','education')
    or (p_payload ? 'summary' and (jsonb_typeof(p_payload->'summary') is distinct from 'string' or length(p_payload->>'summary')>20000))
    or jsonb_typeof(extraction) is distinct from 'object' or extraction-'amount_minor'-'currency'-'merchant'-'occurred_at'-'confidence'-'warnings'<>'{}' then raise exception 'Invalid local capture'; end if;
  if extraction ? 'amount_minor' and (jsonb_typeof(extraction->'amount_minor') is distinct from 'number' or (extraction->>'amount_minor')::numeric<>trunc((extraction->>'amount_minor')::numeric) or (extraction->>'amount_minor')::numeric not between 0 and 9007199254740991) then raise exception 'Invalid local amount'; end if;
  if (extraction ? 'currency' and coalesce(extraction->>'currency','') !~ '^[A-Z]{3}$') or length(coalesce(extraction->>'merchant',''))>500 or (extraction ? 'confidence' and (extraction->>'confidence')::numeric not between 0 and 1) then raise exception 'Invalid local extraction'; end if;
  if extraction ? 'occurred_at' then perform (extraction->>'occurred_at')::timestamptz; end if;
  perform pg_advisory_xact_lock(hashtextextended(w.owner_id::text||':'||p_source||':'||p_external_id,0));
  select * into c from public.captures where owner_id=w.owner_id and ((source=p_source and external_id=p_external_id) or sha256=p_payload->>'sha256') order by created_at limit 1;
  if c.id is not null then return jsonb_build_object('capture_id',c.id,'document_id',c.document_id,'evidence_id',c.evidence_id,'job_id',null,'duplicate',true); end if;
  if classification='financial_evidence' then
    insert into public.financial_evidence(owner_id,title,source,external_id,sha256,mime,size_bytes,status,data)
      values(w.owner_id,p_payload->>'title',p_source,p_external_id,p_payload->>'sha256',p_payload->>'mime',(p_payload->>'size_bytes')::bigint,'needs_review',jsonb_build_object('local_ref',p_payload->>'local_ref','area',area,'extraction',extraction))
      on conflict(owner_id,sha256) where sha256 is not null do update set updated_at=public.financial_evidence.updated_at returning id into target;
    insert into public.transactions(owner_id,evidence_id,amount_minor,currency,merchant,description,occurred_at,confidence,status,data)
      values(w.owner_id,target,(extraction->>'amount_minor')::bigint,coalesce(extraction->>'currency','CLP'),extraction->>'merchant',p_payload->>'title',(extraction->>'occurred_at')::timestamptz,(extraction->>'confidence')::numeric,'draft',jsonb_build_object('local_ref',p_payload->>'local_ref','warnings',coalesce(extraction->'warnings','[]')))
      on conflict(evidence_id) do nothing returning id into tx;
  else
    insert into public.documents(owner_id,title,mime,local_path,sha256,size_bytes,status,data)
      values(w.owner_id,p_payload->>'title',p_payload->>'mime',p_payload->>'local_ref',p_payload->>'sha256',(p_payload->>'size_bytes')::bigint,'indexed',jsonb_build_object('area',area,'source',p_source,'summary',p_payload->>'summary','local_ref',p_payload->>'local_ref'))
      on conflict(owner_id,sha256) where sha256 is not null do update set updated_at=public.documents.updated_at returning id into target;
  end if;
  insert into public.captures(owner_id,source,external_id,sha256,data,document_id,evidence_id)
    values(w.owner_id,p_source,p_external_id,p_payload->>'sha256',p_payload,case when classification='document' then target else null end,case when classification='financial_evidence' then target else null end) returning * into c;
  return jsonb_build_object('capture_id',c.id,'document_id',c.document_id,'evidence_id',c.evidence_id,'transaction_id',tx,'job_id',null,'duplicate',false);
end; $$;
create function public.worker_ingest_local(p_source text,p_external_id text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.worker_ingest_local(p_source,p_external_id,p_payload); $$;

create function private.worker_runtime_policy() returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker(); begin
  return jsonb_build_object('paused',coalesce((select (data->>'paused')::boolean from public.policies where owner_id=w.owner_id),true),'observed_at',now(),'autonomy','read_and_propose');
end; $$;
create function public.worker_runtime_policy() returns jsonb language sql security invoker set search_path='' as $$ select private.worker_runtime_policy(); $$;

create function private.record_in_dashboard_area(r public.records,p_area text) returns boolean language sql immutable set search_path='' as $$
  select p_area is null or r.data->>'area'=p_area or (jsonb_typeof(r.data->'areas')='array' and (r.data->'areas') ? p_area)
    or (not(r.data ? 'area' or r.data ? 'areas') and case
      when p_area='education' then r.kind in ('course','topic','assessment','study_session')
      when p_area='health' then r.kind in ('training_plan','health_metric')
      when p_area='family-friends' then r.kind='contact'
      when p_area='five-buckets' then r.kind in ('note','topic','contact','goal')
      when p_area='work' then r.kind in ('task','goal','project','note','event','decision') else false end);
$$;

create function private.gym_day(p_value text) returns date language plpgsql immutable set search_path='' as $$
begin
  if coalesce(p_value,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p_value::date;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end; $$;
create function private.gym_dashboard_summary(p_state jsonb) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'last_workout_at',(select max(private.gym_day(w->>'d')) from jsonb_array_elements(case when jsonb_typeof(p_state->'workouts')='array' then p_state->'workouts' else '[]' end) w),
    'workout_dates',(select coalesce(jsonb_agg(private.gym_day(w->>'d')),'[]') from jsonb_array_elements(case when jsonb_typeof(p_state->'workouts')='array' then p_state->'workouts' else '[]' end) w where private.gym_day(w->>'d') between current_date-90 and current_date),
    'last_bodyweight',(select jsonb_build_object('value',(b->>'w')::numeric,'date',b->>'d','unit',case when p_state->>'unit'='lb' then 'lb' else 'kg' end) from jsonb_array_elements(case when jsonb_typeof(p_state->'bodyweight')='array' then p_state->'bodyweight' else '[]' end) b where private.gym_day(b->>'d') is not null and coalesce(b->>'w','') ~ '^[0-9]+([.][0-9]+)?$' and (b->>'w')::numeric>0 order by private.gym_day(b->>'d') desc limit 1)
  );
$$;
alter table public.gym_profiles add column summary jsonb not null default '{}';
create function private.project_gym_dashboard() returns trigger language plpgsql set search_path='' as $$
begin update public.gym_profiles set summary=private.gym_dashboard_summary(new.state) where owner_id=new.owner_id; return new; end; $$;
create trigger zz_project_gym_dashboard after insert or update on public.gym_state for each row execute function private.project_gym_dashboard();
update public.gym_profiles p set summary=private.gym_dashboard_summary(g.state) from public.gym_state g where p.owner_id=g.owner_id;

create function private.update_gym_dashboard_plan(p_rev bigint,p_plan jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); item jsonb; begin
  if jsonb_typeof(p_plan) is distinct from 'object' or octet_length(p_plan::text)>16384 or jsonb_typeof(p_plan->'days') is distinct from 'array' or jsonb_array_length(p_plan->'days')>7 then raise exception 'Invalid gym plan projection'; end if;
  for item in select * from jsonb_array_elements(p_plan->'days') loop
    if private.gym_day(item->>'date') is null or length(coalesce(item->>'title','')) not between 1 and 1000 or jsonb_typeof(item->'routine_ids') is distinct from 'array' or jsonb_array_length(item->'routine_ids')>20 then raise exception 'Invalid gym plan day'; end if;
  end loop;
  perform 1 from public.gym_state where owner_id=owner and rev=p_rev for share;
  if not found then return false; end if;
  update public.gym_profiles set summary=summary||jsonb_build_object('plan',p_plan) where owner_id=owner;
  return found;
end; $$;
create function public.update_gym_dashboard_plan(p_rev bigint,p_plan jsonb) returns boolean language sql security invoker set search_path='' as $$ select private.update_gym_dashboard_plan(p_rev,p_plan); $$;

create function private.get_dashboard(p_area text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); recent jsonb; current_items jsonb; upcoming jsonb; snapshots jsonb; totals jsonb; transactions jsonb; worth jsonb; gym jsonb; record_count bigint; begin
  if p_area is not null and p_area not in ('work','health','spirituality','romantic','family-friends','five-buckets','system','business','education') then raise exception 'Unknown dashboard area'; end if;
  select count(*) into record_count from public.records r where owner_id=owner and deleted_at is null and private.record_in_dashboard_area(r,p_area);
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into recent from (select r.* from public.records r where owner_id=owner and deleted_at is null and private.record_in_dashboard_area(r,p_area) order by updated_at desc,id limit 20) r;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into current_items from (select r.* from public.records r where owner_id=owner and deleted_at is null and status not in ('completed','done','cancelled','archived') and private.record_in_dashboard_area(r,p_area) order by updated_at desc,id limit 20) r;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into upcoming from (select r.* from public.records r where owner_id=owner and deleted_at is null and status not in ('completed','done','cancelled','archived') and due_at is not null and private.record_in_dashboard_area(r,p_area) order by due_at,id limit 20) r;
  select coalesce(jsonb_agg(jsonb_build_object('area',area,'source',source,'observed_at',observed_at,'received_at',received_at,'payload',payload) order by observed_at desc),'[]') into snapshots from public.dashboard_snapshots where owner_id=owner and (p_area is null or area=p_area);
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into totals from (select currency,
    coalesce(sum(amount_minor) filter(where status='confirmed' and direction='income'),0) as income_minor,
    coalesce(sum(amount_minor) filter(where status='confirmed' and direction='expense'),0) as expense_minor,
    coalesce(sum(amount_minor) filter(where status='confirmed' and direction='refund'),0) as refund_minor,
    coalesce(sum(case when direction in ('income','refund') then amount_minor when direction='expense' then -amount_minor else 0 end) filter(where status='confirmed'),0) as net_minor,
    count(*) filter(where status='draft') as draft_count from public.transactions where owner_id=owner and status<>'void' group by currency order by currency) t;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into transactions from (select id,amount_minor,currency,direction,status,merchant,description,occurred_at,data from public.transactions where owner_id=owner and status<>'void' order by occurred_at desc nulls last,created_at desc limit 10) t;
  with latest as (select distinct on(account_id) * from public.financial_valuations where owner_id=owner and valued_at<=now() order by account_id,valued_at desc,id),
    baseline as (select distinct on(account_id) * from public.financial_valuations where owner_id=owner and valued_at<=now()-interval '30 days' order by account_id,valued_at desc,id),
    sums as (select c.currency,sum(case when c.kind='asset' then c.amount_minor else 0 end) as assets_minor,sum(case when c.kind='liability' then c.amount_minor else 0 end) as liabilities_minor,
      sum(case when c.kind='asset' then c.amount_minor else -c.amount_minor end) as networth_minor,min(c.valued_at) as as_of,
      count(*)=count(b.id) as comparable,sum(case when b.kind='asset' then b.amount_minor else -b.amount_minor end) as baseline_minor,min(b.valued_at) as comparison_at
      from latest c left join baseline b on b.account_id=c.account_id and b.currency=c.currency and b.kind=c.kind group by c.currency)
    select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'assets_minor',assets_minor,'liabilities_minor',liabilities_minor,'networth_minor',networth_minor,'as_of',as_of,
      'change_percent',case when comparable and baseline_minor>0 then round((networth_minor-baseline_minor)*100/baseline_minor,2) else null end,'comparison_at',case when comparable then comparison_at else null end) order by currency),'[]') into worth from sums;
  select jsonb_build_object('workout_count',workout_count,'routine_count',routine_count,'bodyweight_count',bodyweight_count,'updated_at',updated_at,
    'last_workout_at',summary->'last_workout_at','last_bodyweight',summary->'last_bodyweight',
    'workouts_30_days',(select count(*) from jsonb_array_elements_text(coalesce(summary->'workout_dates','[]')) d where private.gym_day(d) between current_date-29 and current_date),
    'next_training',coalesce((select jsonb_build_object('title',d->>'title','date',d->>'date','routine_ids',d->'routine_ids') from jsonb_array_elements(coalesce(summary->'plan'->'days','[]')) d where private.gym_day(d->>'date')>=(now() at time zone 'America/Santiago')::date order by d->>'date' limit 1),
      (select jsonb_build_object('id',id,'title',title,'due_at',due_at) from public.records where owner_id=owner and kind='training_plan' and deleted_at is null and due_at>=now() and status not in ('completed','cancelled','archived') order by due_at limit 1))) into gym from public.gym_profiles where owner_id=owner;
  return jsonb_build_object('generated_at',now(),'area',p_area,'counts',jsonb_build_object('records',record_count),'recent',recent,'current',current_items,'upcoming',upcoming,'snapshots',snapshots,
    'finance',jsonb_build_object('by_currency',totals,'latest_transactions',transactions,'networth',worth),'gym',coalesce(gym,'{}'));
end; $$;
create function public.get_dashboard(p_area text default null) returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_dashboard(p_area); $$;

-- The existing registration API keeps its privileges and gains only the summary scope.
create or replace function private.register_worker(p_worker_user_id uuid,p_scopes text[],p_label text default 'HP') returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; valid text[]:=array['document.extract','finance.extract','calendar.sync','calendar.apply','planner.week','fitness.sync','life.organize','projects.sync','ingest.gmail','ingest.telegram','dashboard.publish']; begin
  select owner_id into owner from private.workspace_owners where singleton;
  if owner is null or p_worker_user_id=owner or not exists(select 1 from auth.users where id=p_worker_user_id) then raise exception 'Dedicated worker Auth identity required'; end if;
  if cardinality(p_scopes)=0 or not p_scopes<@valid then raise exception 'Invalid worker scopes'; end if;
  insert into private.workers(worker_user_id,owner_id,scopes,label) values(p_worker_user_id,owner,p_scopes,left(p_label,100))
    on conflict(worker_user_id) do update set owner_id=excluded.owner_id,scopes=excluded.scopes,label=excluded.label,enabled=true;
  return jsonb_build_object('worker_id',p_worker_user_id,'owner_id',owner,'scopes',p_scopes,'enabled',true);
end; $$;
revoke all on function private.register_worker(uuid,text[],text) from public,anon,authenticated;
grant execute on function private.register_worker(uuid,text[],text) to service_role;
revoke all on function public.publish_dashboard(jsonb),private.publish_dashboard(jsonb),public.get_dashboard(text),private.get_dashboard(text),public.worker_ingest_local(text,text,jsonb),private.worker_ingest_local(text,text,jsonb) from public,anon;
grant execute on function public.publish_dashboard(jsonb),private.publish_dashboard(jsonb),public.get_dashboard(text),private.get_dashboard(text),public.worker_ingest_local(text,text,jsonb),private.worker_ingest_local(text,text,jsonb) to authenticated;
revoke all on function public.worker_runtime_policy(),private.worker_runtime_policy(),public.update_gym_dashboard_plan(bigint,jsonb),private.update_gym_dashboard_plan(bigint,jsonb) from public,anon;
grant execute on function public.worker_runtime_policy(),private.worker_runtime_policy(),public.update_gym_dashboard_plan(bigint,jsonb),private.update_gym_dashboard_plan(bigint,jsonb) to authenticated;

do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['dashboard_snapshots','gym_profiles','records','transactions','financial_valuations'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
    end loop;
  end if;
end; $$;
