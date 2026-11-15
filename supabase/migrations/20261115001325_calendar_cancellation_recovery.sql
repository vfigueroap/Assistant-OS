create or replace function private.complete_job(p_job_id uuid,p_lease_token uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
      if nullif(item->>'external_id','') is null or length(item->>'title')>1000 then raise exception 'Invalid calendar event'; end if;
      select id into target from public.records where owner_id=j.owner_id and kind='event' and data->>'connection_id'=j.payload->>'connection_id' and data->>'external_id'=item->>'external_id';
      if item->>'status'='cancelled' then
        if target is not null then update public.records set status='cancelled',data=data||jsonb_build_object('cancelled_at',now()) where id=target and owner_id=j.owner_id; end if;
        continue;
      end if;
      if nullif(item->>'start_at','') is null or nullif(item->>'end_at','') is null or (item->>'end_at')::timestamptz <= (item->>'start_at')::timestamptz then raise exception 'Invalid calendar event dates'; end if;
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
