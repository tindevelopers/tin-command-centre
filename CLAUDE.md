# tin-command-centre (TIN Command Center)

The TIN Command Center — the registry of what TIN runs, who owns it and whether it has drifted. A Next.js 16 app
(package and registry slug `tin-ops-console`) on Neon Postgres and Neon Auth, served at `command.tinconnect.com`.
Admins edit **declared** state here (projects, environments, pins, assignments); the collector in
`shell-base-github-registry` writes **observed** state (package, cell and credential snapshots). Drift is the
difference. Authority model, tenants and rollout order: `docs/authority-model.md`.

## Gate

Run before every commit: `pnpm quality` — `lint` → `type-check` → `test` → `build` on Node 24, pnpm 10.6.1.
(The linter and the `quality` script arrive with the harness-2026-10-29 workflows PR; before that, run
`pnpm type-check && pnpm test && pnpm build`.) "Skipped" is not "passed": say which checks you skipped. The `db/*`
suites boot PGlite in-process, so no database server is needed to run them.

## You may

- Work on a branch named `agent/<agent>/<slug>` (agents) or `feat/<slug>` (people), and open a **draft** PR.
- Add or edit a migration file under `db/` — as a file only; applying it is the owner's act (owner gates below).

## You may not (owner gates, Standard §11)

- Merge or push to `main`/`develop`; publish; move a dist-tag; edit `release-targets.json` (except an evidence PR);
  apply a migration; deploy; create, rotate or print a secret; change repository or registry settings.
- Delete, skip or weaken a test; add `ts-ignore`, `eslint-disable` or `--passWithNoTests`.

## Rules a tool cannot check here

- `db/*.sql` is delivered as a file and never applied from a pull request. Migrations apply to Neon in file order
  (001 → 007) with the owner's approval, and `npm`/`pnpm` runs never touch a live database (2026-10-03, `docs/evidence.md`).
- Deploy the code before applying its migration. 006 and 007 were written that way because the previous release reads
  what they change; never re-run 006 alone after 007 (2026-10-14, `docs/authority-model.md`).
- Every registry write sets `console.actor` in the same transaction. The audit trigger refuses a write without an
  actor, and no role may edit or delete audit rows (2026-10-05, owner decision).
- The console never writes observed state: "Collect now" dispatches the collector's `collect.yml`, and the console has
  no `collector_writer` login by design (2026-10-14).
- Secrets stay on the server: `CONSOLE_*`, `AGENT_GITHUB_TOKEN`, `COLLECTOR_GITHUB_TOKEN` and `BOSS_*` are server-only;
  never prefix one with `NEXT_PUBLIC_` (2026-10-14, `.env.example`).

## Read next

- Package rules: `tin-boss-api/docs/standards/packages-when-to-share-how-to-create-how-dependencies-work.md`
- The standard: KB *Standard — BOSS standardization (2026-10-23)*
- Versions and consumers: `shell-base-github-registry/REGISTER.md`
- Local architecture: `docs/authority-model.md`, `docs/evidence.md`
