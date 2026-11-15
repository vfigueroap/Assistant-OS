-- Keep elevated logic outside the API schema, as with the other owner RPCs.
alter function public.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) set schema private;
revoke all on function private.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) from public,anon;
grant execute on function private.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) to authenticated;
create function public.confirm_financial_draft(
  p_transaction_id uuid,
  p_amount_minor bigint,
  p_merchant text,
  p_occurred_at timestamptz,
  p_allow_similar boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.confirm_financial_draft(p_transaction_id,p_amount_minor,p_merchant,p_occurred_at,p_allow_similar);
$$;
revoke all on function public.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) from public,anon;
grant execute on function public.confirm_financial_draft(uuid,bigint,text,timestamptz,boolean) to authenticated;
