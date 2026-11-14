-- Keep the upstream openGym bookkeeping inside the same atomic CAS as the state.
create or replace function private.put_gym_state(p_state jsonb,p_base_rev bigint,p_base_wid uuid,p_stamped boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.require_owner(); g public.gym_state; vstate jsonb; nextwid uuid; ts timestamptz:=now(); history jsonb; begin
  if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>8388608 then raise exception 'Gym state must be an object below 8 MB'; end if;
  insert into public.gym_state(owner_id) values(owner) on conflict do nothing;
  select * into g from public.gym_state where owner_id=owner for update;
  if p_base_rev is distinct from g.rev or p_base_wid is distinct from g.wid then return jsonb_build_object('conflict',true,'state',g.state,'rev',g.rev,'wid',g.wid); end if;
  nextwid=gen_random_uuid();
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into history from (
    select value,ord from jsonb_array_elements(
      (case when jsonb_typeof(g.state->'_wids')='array' then g.state->'_wids' else '[]'::jsonb end)
      || (case when g.state ? '_wid' then jsonb_build_array(g.state->'_wid') else '[]'::jsonb end)
    ) with ordinality as old(value,ord) order by ord desc limit 32
  ) kept;
  vstate=(p_state-'active')||jsonb_build_object('_rev',g.rev+1,'_wid',nextwid::text,'_wids',history);
  if octet_length(vstate::text)>8388608 then raise exception 'Gym state exceeds 8 MB after bookkeeping'; end if;
  update public.gym_state set state=vstate,rev=g.rev+1,wid=nextwid,updated_at=ts where owner_id=owner;
  return jsonb_build_object('ok',true,'rev',g.rev+1,'wid',nextwid,'ts',coalesce(vstate->'_ts','null'::jsonb));
end; $$;
