-- A receipt and a bank email may describe the same purchase. Require an
-- explicit second decision before confirming a similar draft.
create function public.confirm_financial_draft(
  p_transaction_id uuid,
  p_amount_minor bigint,
  p_merchant text,
  p_occurred_at timestamptz,
  p_allow_similar boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner uuid;
  draft public.transactions;
  similar_ids uuid[];
begin
  owner := private.require_owner();
  if p_amount_minor is null or p_amount_minor < 0 or p_amount_minor > 9007199254740991
      or p_occurred_at is null or length(coalesce(p_merchant,'')) > 500 then
    raise exception 'Invalid financial draft' using errcode='22023';
  end if;
  -- Serialize confirmations for this owner, including two devices at once.
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 150018));
  select * into draft from public.transactions
    where id=p_transaction_id and owner_id=owner and status='draft' for update;
  if draft.id is null then raise exception 'Draft not found' using errcode='22023'; end if;
  select coalesce(array_agg(t.id),array[]::uuid[]) into similar_ids
    from public.transactions t
    where t.owner_id=owner and t.id<>draft.id and t.status='confirmed'
      and t.kind=draft.kind and t.direction=draft.direction
      and t.currency=draft.currency and t.amount_minor=p_amount_minor
      and t.occurred_at between p_occurred_at - interval '2 days' and p_occurred_at + interval '2 days'
      and lower(regexp_replace(coalesce(t.merchant,''),'\s+','','g'))=
          lower(regexp_replace(coalesce(p_merchant,''),'\s+','','g'))
      and length(btrim(coalesce(p_merchant,'')))>0;
  if cardinality(similar_ids)>0 and not p_allow_similar then
    return jsonb_build_object('status','similar','candidate_ids',similar_ids);
  end if;
  update public.transactions set amount_minor=p_amount_minor,merchant=p_merchant,
    description=coalesce(nullif(p_merchant,''),draft.description),
    occurred_at=p_occurred_at,status='confirmed',
    data=data||jsonb_build_object('similar_override',p_allow_similar and cardinality(similar_ids)>0)
    where id=draft.id and owner_id=owner;
  return jsonb_build_object('status','confirmed','candidate_ids',similar_ids);
end; $$;
revoke all on function public.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) from public,anon;
grant execute on function public.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) to authenticated;
