-- Remove boss_adoption (BOSS upstream replan, Task 4b.5). The declared BOSS "domain mode" (inprocess | shadow | remote) is gone:
-- shadow and remote no longer exist (B-remote), and what a platform actually runs is now REPORTED to BOSS and shown against the
-- declared pins instead (src/boss/). The console no longer reads or writes this table.
--
-- !!! DESTRUCTIVE: DO NOT APPLY WITHOUT THE OWNER'S YES. !!!
-- It drops a table and every row in it. It cannot be undone except from a backup or a Neon branch restore.
-- Before applying: deploy the code that no longer touches boss_adoption (this PR), try the file on a Neon branch, then get the owner's yes.
-- Rolling out in the other order breaks the old code: the previous release reads `select * from boss_adoption` on every registry page.
--
-- Why a new file and not an edit of 002/006: 002 (and 006, which adds tenant_id and RLS to the table) have already been applied,
-- so the migration history stays as it ran. Applying 001..007 in order ends with no boss_adoption table, which is what a fresh database needs.
-- Do NOT re-run 006 on its own after this file: it still names the table. Re-run 002 and 006 only as part of the full ordered chain.
--
-- What goes with the table: its audit trigger, its RLS policy, its foreign key, its grants and its indexes.
-- What stays: the rows already written to registry_audit with table_name = 'boss_adoption'. That log is append-only history.
-- Idempotent: safe to apply twice, with or without 006.

DROP TABLE IF EXISTS boss_adoption;
