-- Trigger functions run regardless of EXECUTE grants; they should not be callable via /rpc.
revoke all on function public.community_reports_guard() from public, anon, authenticated;
revoke all on function public.community_reports_refresh() from public, anon, authenticated;
