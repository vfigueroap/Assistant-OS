-- The platform's event trigger is only invoked by PostgreSQL; API roles do not need EXECUTE.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
