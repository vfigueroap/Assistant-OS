create or replace function private.worker_ingest_local(p_source text,p_external_id text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers:=private.require_worker('ingest.'||p_source); c public.captures; target uuid; tx uuid; extraction jsonb:=coalesce(p_payload->'extraction','{}'); classification text:=p_payload->>'classification'; area text:=coalesce(p_payload->>'area','work'); begin
  if coalesce(p_source,'') not in ('gmail','telegram') or length(coalesce(p_external_id,'')) not between 1 and 1000 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-'title'-'sha256'-'mime'-'size_bytes'-'local_ref'-'classification'-'extraction'-'summary'-'area'<>'{}'
    or length(coalesce(p_payload->>'title','')) not between 1 and 240 or coalesce(p_payload->>'sha256','') !~ '^[a-f0-9]{64}$'
    or length(coalesce(p_payload->>'mime','')) not between 1 and 200 or length(coalesce(p_payload->>'local_ref','')) not between 1 and 500 or (p_payload->>'local_ref' !~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$' and p_payload->>'local_ref' <> 'sha256:'||(p_payload->>'sha256'))
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
