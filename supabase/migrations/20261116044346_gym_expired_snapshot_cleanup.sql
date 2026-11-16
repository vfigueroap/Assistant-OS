-- Allow the owner to remove only expired transfer staging, never live gym data.
grant delete on public.gym_snapshots to authenticated;
drop policy if exists owner_expired_delete on public.gym_snapshots;
create policy owner_expired_delete on public.gym_snapshots for delete to authenticated
  using (owner_id=(select auth.uid()) and (select public.is_workspace_owner()) and expires_at<now());
