-- ═══════════════════════════════════════════════════════════
--  VSHORT v2 migration — lock the template prompt (creator protection)
--  Run in Supabase SQL Editor after 0002.
-- ═══════════════════════════════════════════════════════════
-- The RLS policy on `templates` allows reading official/public rows, but RLS is
-- row-level: it would still expose the `prompt_template` COLUMN to anyone using
-- the public anon/authenticated key (e.g. a direct PostgREST query). To truly
-- "lock" a published prompt, revoke column access from those roles. Only the
-- service-role worker can read it — and the worker runs templates server-side,
-- so the prompt never reaches another user's browser.
revoke select (prompt_template) on templates from anon;
revoke select (prompt_template) on templates from authenticated;

-- (service_role bypasses RLS and column grants, so the worker still reads it.)
