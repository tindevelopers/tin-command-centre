# Evidence

## H2: `db/001_status.sql` on the main Neon branch (2026-10-03)

- Owner approved H2 on 2026-10-03.
- Target: the `tin-ops-console` Neon project, default (production) branch, database `neondb`.
- Before applying: `pnpm test` passed 40/40 (PGlite schema and grant tests).
- Applied twice over Neon's HTTPS SQL endpoint (`@neondatabase/serverless`, one transaction per pass). Both passes succeeded, so the file is idempotent on Neon.
- Grant check (owner ran `has_table_privilege` for SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all five tables in the Neon SQL editor), 14 rows, matching the plan exactly:
  - `console_reader`: SELECT on all five tables, nothing else.
  - `collector_writer`: SELECT, INSERT, DELETE on `collector_runs`; SELECT, INSERT on `package_snapshots`, `cell_snapshots`, `credential_snapshots`; nothing on `console_operators`.
- Not checked live: column-level UPDATE on `collector_runs` (covered by `db/schema.test.ts`).

## T1: Neon Auth through `NeonAuthProvider` (2026-10-06, System Admin account)

Built (2026-10-04): `src/auth/auth.ts` (lazy `createNeonAuth` + `NeonAuthProvider`), `/api/auth/[...path]` proxy, `/signin` (sign-in, forgot password by emailed code, set password), `/` with sign-out. `@neondatabase/auth@0.5.0-beta` added (peer dependency of `domain-identity`).

Results against the live Neon Auth endpoint:
- **Sign-up is refused.** `POST /api/auth/sign-up/email` returned 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` and the user count did not change (2026-10-04, local `next start`).
- **Sign-in works for the System Admin account.** The owner set the password with the emailed-code flow on 2026-10-05 and signed in on 2026-10-06. Neon Auth holds a credential account with a password for that user, and 6 sessions, the latest on 2026-10-06 10:34 UTC (read-only query, no secrets selected).
- **Signed-out access is refused.** `/signin` renders, `/` redirects to `/signin` without a session, and `get-session` returns `null` without a cookie (2026-10-04).

Not recorded in this write-up: a screenshot or log that `/` showed the signed-in email, and a check that sign-out clears the session. The owner confirmed being signed in as System Admin; these two checks were not captured.

Not covered: the second operator account (Platform Admin) has no password yet. It is out of scope for T1 by the owner's decision.

Known deviations:
- `NeonAuthProvider.resetPassword` throws ("handled by the hosted flow"), so forgot-password calls the SDK's `emailOtp` methods directly in `app/signin/actions.ts`. Sign-in through the provider worked, so the plan's stop condition (fix in `shared-identity-hub`) did not trigger.
- Google and GitHub OAuth are enabled in Neon Auth, and OAuth can still create Neon Auth accounts. Access to the console is controlled by the `console_operators` allow-list, not by Neon Auth sign-up.

## Migrations 007 to 012 on the production Neon branch (2026-11-07)

- Owner asked for them on 2026-11-07 ("Apply 007 to 012"). Target: Neon project `tin-command-centre` (`red-truth-58035256`), `production` branch, database `neondb`.
- Before applying, the database held 001 to 006 only: `boss_adoption` existed, `tenants` had no `platform` column, and `pin_proposals`, `agent_ledger_*` and `tenant_settings` were missing (read-only queries).
- Rehearsal: the same six files were applied in order to a throwaway branch of production (`test-migrations-007-012`) with no errors; the branch was then deleted at the owner's request.
- Code first, as 007 requires: production served `main` at `0b47517` (Vercel deployment `dpl_5wyosLSdJg7KwCTyXA6GpSxFuezP`, READY), which has no `boss_adoption` reads (the removal is commit `2882d4a`).
- Applied to production in order 007, 008, 009, 010, 011, 012, one transaction per file (007 as a single statement), all without error. The statements were sent through the Neon MCP `run_sql` / `run_sql_transaction` tools, split from the files with comments removed.
- Check afterwards (read-only): `boss_adoption` is gone; `pin_proposals`, `agent_ledger_runs`, `agent_ledger_events`, `tenant_settings` and the `agent_task_type_record` view exist; the six tenant functions exist; row-level security is on for the four new tables; `tenants` holds one row (`tin`, `platform = true`); `registry_audit` still has 301 rows.
- 010 created the `agent_ledger_writer` role (NOLOGIN).
- Not checked: the console against the new schema, calls to the new functions, and the app roles' grants on live data. The restore window is the project's 24 hours of history; a restore was not tried.
