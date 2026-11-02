# Authority model: the Control Plane is the source of truth

> **Naming (2026-11-01).** The TIN ops console is now the **TIN Control Plane**, served at `control.tinconnect.com` (it was `console.tinconnect.com`; for a few weeks it was briefly named the Command Center, and `command.tinconnect.com` was planned but never set up). The GitHub repo is `tindevelopers/tin-control-plane` (renamed on 2026-11-01 from `tin-command-centre`, which was renamed from `tin-ops-console`; the old addresses redirect). Other identifiers are unchanged on purpose: the package and registry slug are `tin-ops-console`, the Vercel project is `tin-ops-console`, the Neon project is `tin-command-centre`, and env vars keep the `CONSOLE_` prefix. Text below that says "the console" or "the Control Plane" means this app.

**Status:** Owner decision, 2026-10-05. Amends `docs/specs/2026-10-03-tin-ops-console-design.md` in `shell-base-admin` (PR #99).

## What changes

| Spec decision | Was | Now |
|---|---|---|
| C3 | Read-only; links out instead of acting | **Superseded.** The console is the system of record for what TIN runs, who owns it and what it should look like. |
| C4 | Only the collector writes; the console reads | The collector still writes **observed** state. Admins write **declared** state through the console. Neither overwrites the other. |
| Section 1 "Not in scope" | No assigning or changing anything | Assigning owners, and declaring versions are in scope. Rotating keys, publishing packages and deploying cells are still not done from the console. |

Unchanged: C1 (own repo), C2 (Neon, EU), C5 (key metadata only, never secrets), C6 (Neon Auth, closed sign-up, `console_operators` allow-list), C7 (ui-shell structure).

## Declared versus observed

- **Declared** (authoritative, edited by admins): `projects`, `project_relations`, `environments`, `declared_pins`, `assignments`.
- **Observed** (measured by the collector): `package_snapshots`, `cell_snapshots`, `credential_snapshots`.
- **Drift is the difference.** A project declared on `@tindevelopers/ui-shell@1.2.0` while the collector sees `1.1.0` is red. Observed state never edits the declaration.

## What it tracks

`projects.kind` covers `boss`, `hub`, `spoke`, `package`, `shell-base` and `app`. `project_relations` links them (`consumes`, `calls`, `hosts`), for example an app consumes a hub, a spoke calls BOSS. Each project has environments (`development`, `staging`, `production`), declared package pins per environment and owners.

## Access and audit

- Roles: `console_reader` (SELECT), `console_admin` (writes the registry, cannot touch snapshots), `collector_writer` (snapshots only, no registry access).
- `console_operators.role` is now `viewer` or `admin`. Only admins reach the write path.
- Every change to a registry table or to `console_operators` is recorded in `registry_audit` by a database trigger, with actor, before and after. The console must run `SELECT set_config('console.actor', <email>, true)` in the same transaction as each write; a write without an actor is refused. No role can edit or delete audit rows.
- Retiring replaces deleting: projects, environments and assignments cannot be deleted (`lifecycle = 'retired'`, `removed_at`). Relations and pins can be removed.

## Built

- **Admin screens** (`/projects`, `/projects/[slug]`): add and edit projects, environments, declared versions, BOSS mode, owners and relationships. Forms show only for `console_operators.role = 'admin'` and only when `CONSOLE_ADMIN_DATABASE_URL` is set. Each server action re-checks admin access itself and runs its write in one transaction that sets the audit actor.
- **Drift view** (`/drift`, plus a status per project and a findings table per project): declared pins against the collector's `latest`/`next`, declared cells against their health, and projects with no owner. A package or cell the collector has not seen is amber, never green. Retired projects are skipped. Rules are in `src/registry/drift.ts`.
- New pages require an active `console_operators` row. The older pages (`/packages`, `/cells`, `/collector`) still only require sign-in; see below.

## Ownership

A project is owned by another **project** (`projects.owner_project`, migration `db/003_owner_project.sql`), not only by a person. The core hubs and tooling belong to TIN BOSS; Konnect, its apps and the Shell Base modules built for it belong to Konnect. A project may own itself, which marks a top-level owner. People can still be assigned (owner or maintainer) on top. A project counts as owned if it has an owning project or an assigned owner; the Owner filter on `/projects` can filter by "Owned by <project>", by person, or "No owner".

## Also built

- Every console page now requires an active `console_operators` row (`requireOperator`), not just a sign-in. Neon Auth sign-up cannot be closed to OAuth, so signing in alone grants nothing.
- The Overview shows active projects, the number of red and amber findings, collector freshness, and the most urgent findings.
- The collector (`shell-base-github-registry`, `scripts/collect-status.mjs`) records observed package versions and cell health daily. On `*.run.app` cells it checks `/readyz` only, because Cloud Run reserves `/healthz`.

## Collect now

The Collector page has a **Collect now** button for admins. It does not collect inside the console (the console has no `collector_writer` login, by design). It dispatches the collector repo's quick workflow, `collect.yml` (`workflow_dispatch`). That run skips regenerating the register, the slow part: it reuses the committed `REGISTER.json` for packages (the run's note on the Collector page says how old that data is), checks cell health live and records a run as `collector_writer`. The daily `register.yml` run still refreshes everything. Needs `COLLECTOR_GITHUB_TOKEN` (fine-grained, Actions: read and write on `shell-base-github-registry`); the button is hidden without it. A second click is refused for 5 minutes after any run starts, and while a run is marked `running`. Logic: `src/status/collect.ts`; action: `app/(console)/collector/actions.ts`.

## Tenants (phase 1)

The registry is tenant-scoped (`db/006_tenants.sql`; design in the Programming KB under Products > TIN Control Plane > Architecture). Everything that existed is tenant `tin`. Phase 1 has no second tenant yet; it puts the isolation in place first.

- **How a request is scoped.** The tenant comes from the `Host` header (`src/tenancy/host.ts`, configured by `CONTROL_BASE_DOMAIN`, `DEFAULT_TENANT`, `TENANT_OTHER_HOSTS`). Every read and write runs in a transaction that first sets `app.tenant_id` (`src/tenancy/db.ts`). Row-level security on each registry table then limits rows to that tenant, and inserts are stamped with it. With no tenant set, nothing is readable or writable.
- **Keys.** Slugs are unique per tenant, and foreign keys are composite, so a row can only reference its own tenant's rows.
- **Not tenant-scoped.** The collector's runs and snapshots describe the shared estate. Tenants will see them only through explicit views (a later phase).
- **Tenant lookup.** The app roles cannot read `tenants`; `resolve_tenant(slug)` is the only way to learn an id.
- **Dedicated databases.** `tenants.isolation` and `connection_ref` exist, and `connectionFor()` is the single place a connection is chosen, so an enterprise tenant can move to its own database later without touching callers.
- **Guard.** `db/tenants.test.ts` fails if a new table is neither tenant-scoped with a policy nor on the platform list.
- **Rollout order.** Deploy this code first, then apply `db/006_tenants.sql` straight away. Before 006 the code still reads the registry (it finds no `resolve_tenant()` and runs unscoped), but registry writes need 006. Applying 006 first would leave the old code reading an empty registry. Try 006 on a Neon branch first.
- **Seeds.** `db/seed/*.draft.sql` were written before `006` and have not been run. After `006` they need `app.tenant_id` set and `ON CONFLICT (tenant_id, ...)` targets.
- **Catalog export.** `scripts/export-catalog.mjs` reads the tenant named by `CONSOLE_TENANT` (default `tin`).

## Reported versus declared

"Merged pin = deployed" is false: merging a pin bump changes the repo, not what runs (migrations and the worker rollout are still manual). So a project page with declared pins for `@tindevelopers/knowledge`, `@tindevelopers/knowledge-worker` or `@tindevelopers/credential-crypto` (what the PawPointers dashboard reports) shows a **Declared versus reported** section: the declared version next to the version the platform reported to BOSS, and a status.

- **Source.** BOSS `GET /v1/reports`, read on the server with the console's own spoke key (`BOSS_API_URL`, `BOSS_REPORTS_KEY`, scope `boss.reports.read`; see `.env.example`). The key never reaches the browser. Reader and the single wire-to-internal mapping function: `src/boss/reports.ts`. Comparison: `src/boss/compare.ts`.
- **Which reports apply.** The BOSS platform is the project's `client` (for example `konnect`), the environment is the declared environment name. The component is taken to be the project slug without the platform prefix (`konnect-knowledge-worker` is component `knowledge-worker`), or a component named exactly like the slug (`pawpointers-dashboard`); if no such component reported the package, every component that did is compared and any disagreement counts as not deployed.
- **Status.** Deployed (reported equals declared), **Not deployed** (reported differs), Not reported (BOSS has no report for that platform environment or package), Unavailable (BOSS not configured, unreachable, refused the key, timed out after 3 s, or answered with something that does not match the contract). Only Deployed means deployed; every other state fails closed.
- **Validation.** Each field of the response is checked against the patterns BOSS enforces on `POST /v1/reports` before anything is displayed. One bad row rejects the whole response. Nothing BOSS sends is ever put into an error message.
- **Not part of drift.** Drift compares declared with what the collector saw published; this compares declared with what is reported as running. They are separate on purpose.

## BOSS adoption removed (migration 007)

The declared BOSS adoption mode (`boss_adoption`, `inprocess | shadow | remote`) is gone from the code: shadow and remote no longer exist, and what a platform actually runs is reported to BOSS and shown against the declared pins (see "Reported versus declared").

- **`db/007_drop_boss_adoption.sql` is destructive and needs the owner's yes before it is applied.** It drops the table and its rows. It is a new forward file because 002 and 006 have already been applied; they still mention the table and are left as they ran.
- **Rollout order.** Deploy this code first (it no longer reads or writes the table), then apply 007 on a Neon branch, then on the main branch after the owner's yes. Applying 007 first would break the previous release, which reads `boss_adoption` on every registry page.
- `registry_audit` keeps its old `boss_adoption` rows. It is append-only history.
- Do not re-run 006 alone after 007: it still names the table. Apply 001 to 007 in order on a fresh database.

## Hubs, BOSS reports and the interface (2026-11-01)

Steps 1 to 3 of the build order in the interface strategy (`tin-boss-api` `docs/strategy/2026-11-01-control-plane-interface-and-evolution.md`).

- **Hubs and packages** (`/packages`) is now one row per hub, opening into its packages: the collector's snapshots grouped by `repo`, joined to the hub topology decided on 2026-10-30. The topology (layer, risk class, planned, rename, archive, shrink, one-line note, harness tasks) is a decision record in `config/topology.ts`, keyed by repository; a project's `annotations` (`tin.info/layer`, `tin.info/risk-class`, `tin.info/topology`, `tin.info/topology-note`) override it when present, so the registry can take it over with no code change. Package state is read from the collector's `divergence` text (`src/registry/hubs.ts`: OK, awaiting promotion, unpublished, known drift, divergent). Planned hubs with no packages still appear. Promotion stays an owner gate and is not done from the console.
- **BOSS reports** (`/boss/reports`, and a panel on the Overview): one row per platform environment from `GET /v1/reports` (`src/boss/summary.ts`), with every registered platform listed, so a platform that never reported is visible as "not reported", and the declared-versus-reported comparison across all projects. Read with the console's own key; the same fail-closed reader and fixed error strings as before. The Overview waits at most the reader's 3 s for BOSS.
- **Navigation and look.** Pages ordered estate first (Overview, Projects, Hubs and packages, Cells, Drift), then a **BOSS** submenu listing only pages that exist, then Collector. The shared sidebar has three fixed sections with fixed headings, so titled groups wait for a `ui-shell` change. KPI cards are flat with the status carried by the figure and a dot, not a coloured left border. `PageHeader` takes a title and breadcrumb so every page can use it.
- Tests: `src/registry/hubs.test.ts`, `src/boss/summary.test.ts`, `src/boss/panel.test.ts`.

## Consumers and keys (phase 2, T13, 2026-11-01)

The keys page the spec reserved for phase 2 (C5: metadata only, never secrets), built on the one source that exists.

- **`/keys`**: one identity per platform environment (`urn:tin:<platform>:<environment>`, BOSS's `identityExternalId` and Unkey's `externalId` shape), its keys, their scopes, last use and status, as the collector last saw them in `credential_snapshots`. Identities link to the registry projects whose `client` is the platform. Filters live in the URL.
- **The rule check.** `config/scopes.ts` records BOSS's scopes, routes and who may hold them, as the minting script enforces them (`tin-boss-api` `scripts/mint-spoke-credential.ts`, 2026-10-31): a platform key is any non-empty subset of the three platform scopes, the console reader is exactly `boss.reports.read` (it returns every platform's reports, so it is never mixed with operator scopes), the tin hub is exactly `boss.session.issue`. `src/credentials/view.ts` applies the same rule to each active key and flags one outside it in red. The page also shows the scope matrix and the routes no key is minted for yet.
- **The port.** `src/credentials/port.ts` is `CredentialAuthority` (interface strategy §3): `read()` gives identities' keys as metadata. The one adapter is `src/credentials/snapshots.ts` over `credential_snapshots`; a live read of `api-credentials` or Unkey is another adapter, not a new page. Verification outcomes are a column the page already reserves ("not collected yet").
- **What it does not do.** Mint or rotate: those stay the owner's CLI. Read a cell live: nothing on this page talks to BOSS. Until the collector's writer for `api-credentials` is enabled the table is empty and the page says so; the scope matrix stands on its own.
- Tests: `src/credentials/view.test.ts`.

## Tenants and operators (phase 2, 2026-11-01)

Phase P2 of the interface strategy: the tenancy that `006` put in place becomes operable from the console.

- **Migration `db/008_tenant_admin.sql`** (additive, idempotent; the owner applies it after deploying this code). It marks `tin` as the **platform tenant** (`tenants.platform`, exactly one), adds `control` to the reserved slugs, and adds the only doors through which the app roles reach `tenants`: `list_tenants()` (every tenant from the platform tenant, only its own from any other, nothing with no tenant set; with live project and active operator counts), `create_tenant()` and `retire_tenant()` (platform tenant and an audited actor only; the platform tenant cannot be retired). Each write function records its own `registry_audit` row in the platform tenant, since `tenants` has no `tenant_id` for the trigger. The direct `SELECT` on `tenants` stays forbidden. Before `008` the Tenants page says so and shows nothing.
- **Tenants** (`/tenants`): the list with host, isolation, counts and status; platform admins create (slug, name, shared or dedicated with the NAME of its connection secret) and retire. The page also shows which integrations this deployment has configured, by environment-variable name only (`src/tenancy/admin.ts`), and how a request is scoped. Per-tenant integrations are phase P4.
- **Operators** (`/operators`): the tenant's `console_operators`; admins invite by email, change roles and remove. An invite is a row whose `user_id` is `pending:<email>` until that person first signs in with the address, when `currentOperator` (`src/auth/access.ts`) swaps in their Neon Auth id (`claimInvite`, `src/auth/operators.ts`; it needs the admin login, otherwise the invite stays pending and the person is still refused). Guards: nobody changes their own role or removes themself, and the last active admin cannot be removed; the last guard is in the `UPDATE`'s `WHERE`, not only in the form. Removal is `removed_at`, never a delete.
- Validation of form input is `src/tenancy/validate.ts`; the database's constraints remain the backstop. Tests: `db/tenant_admin.test.ts`, `src/tenancy/validate.test.ts`, `src/tenancy/admin.test.ts`.
- **Bootstrapping a new tenant's first operator** still needs either a platform admin who is also made a member there (by SQL, as today) or a SQL insert; inviting from the platform tenant into another tenant is deliberately not possible, since membership rows are tenant-scoped.

## Pin proposals (phase 2, 2026-11-01)

Step 4 of the build order. The console now proposes, BOSS records, platforms pull (BOSS-8): nothing here touches a platform repository.

- **Drafts** (`/boss/proposals`, `src/boss/drafts.ts`) are derived, never stored: one per (platform, environment) from the registry's `latest` pins that are behind the hub's published version, merged per package, worst bump first, chunked to BOSS's limit of 10 pins. A draft whose pin set equals the newest sent proposal for that key is marked already sent and cannot be sent again.
- **Sending** (`app/(console)/boss/proposals/actions.ts`, `src/boss/propose.ts`) is autonomy class A1: an admin presses the button, every time. The form names only the draft; the pins are re-derived server-side, so a stale form cannot send anything the registry does not say. `POST /v1/pin-proposals` carries two credentials, both server-only: the console's operator spoke key (`BOSS_OPERATOR_KEY`, scope `boss.pins.write`) and the signed-in person's Neon Auth JWT (`src/auth/token.ts`, from Neon Auth's `/token`). BOSS also requires that person on its operator list, so a 403 reads "not on its operator list". No credential and nothing BOSS returns is logged, stored or interpolated; failures are fixed strings.
- **Record** (`db/009_pin_proposals.sql`): the console cannot read proposals back from BOSS (`GET /v1/pin-proposals/latest` is platform-scope), so it keeps its own append-only, tenant-isolated, audited record of what it sent, with BOSS's id. A send that BOSS accepted but the console could not record is reported as such; BOSS stays the authority.
- **Deployed state** is derived from BOSS reports: deployed, partly, not deployed, or not reported.
- **Platform signals** (`src/boss/platform.ts`, added the same day): the "PR open on platform" and "Checks green" stages and the Platform PR column are read from GitHub, the only place that evidence exists. `pin-bump.yml` pushes `pin-bump/<proposal id>` (replan 4b.4, W3-03), so a platform's PR is matched to a sent proposal by its head branch and the BOSS id the console recorded, with no title parsing; PRs for proposals sent some other way still show, marked "sent elsewhere". CI on that PR is the test-before-upgrading gate, so its check runs are the evidence; the compat canary (W3-01) will post a check run on the same commit and appears without a code change. An agent hand-off's PR is the one in the issue's repository that names the issue. Only repositories the registry names are read (live projects with a `client`, plus the repositories of recorded hand-off issues), with the agent token, read-only, one list per repository and at most twelve check-run reads, under one 4 s budget, fail-closed with fixed strings. Without `AGENT_GITHUB_TOKEN` the stages show a dash and say why.
- **Rollout.** Deploy the code first (the page says "db/009 not applied" until then), apply 009 on a Neon branch and then on main, mint a console operator key on BOSS and set `BOSS_OPERATOR_KEY`, and add the sending admins to BOSS's operator list.
- Tests: `db/pin_proposals.test.ts`, `src/boss/drafts.test.ts`, `src/boss/propose.test.ts`, `src/boss/platform.test.ts`.


## BOSS keys (Keys page)

- `/boss/keys` (`app/(console)/boss/keys`, `src/boss/credentials.ts`) lists BOSS's spoke keys through `GET /v1/credentials` and lets an admin revoke one through `POST /v1/credentials/:id/revoke` (tin-boss-api `src/routes/credentials.ts`). BOSS sends metadata only (name, identity, scopes, status, dates): never a key, a digest or a public id, and the reader keeps only those fields. Minting stays an owner step; the page explains the order (mint, update the platform, then revoke).
- Both calls carry two server-only credentials: the console's credentials key (`BOSS_CREDENTIALS_KEY`, scope `boss.credentials.write` and nothing else) and the signed-in person's Neon Auth JWT, and BOSS requires that person on its operator list. The key is separate from the operator key and the reports key because it reaches every platform's keys.
- Revoking is final and is autonomy class A1: an admin does it, every time. The form carries only the key's id, its identity and what the person typed. The server action re-reads the identity's keys from BOSS, so the name to be typed and "this is the only active key" come from BOSS, not from the form; a stale form cannot revoke anything the page did not show or skip the confirmation. BOSS itself refuses an identity's only active key unless confirmed, and a key can never revoke the key the console uses. BOSS records the operator's id as the actor in its credential log; the console keeps no copy.
- Nothing BOSS sends is interpolated into text; failures are fixed strings. Rollout: mint the console credentials key on BOSS, set `BOSS_CREDENTIALS_KEY` (and `BOSS_API_URL`), and BOSS needs its credential admin login (`BOSS_CREDENTIAL_ADMIN_DATABASE_URL`) before the routes exist; until then the page says BOSS refused.
- Tests: `db/pin_proposals.test.ts`, `src/boss/drafts.test.ts`, `src/boss/propose.test.ts`.

## Policy and Integrations (Settings, 2026-11-02)

The last two items of the Settings group (interface strategy §2.1: Tenants · Policy · Integrations). Both are read-only by design.

- **Policy** (`/settings/policy`, `src/settings/policy.ts`): the rules the console runs under, each with where it is recorded, who approves it, how it changes and what overrides it. Three kinds: decision records (hub topology, autonomy classes, support windows, BOSS scopes and who may hold them: owner-approved text, changed by PR, mirrored in the console as `config/*.ts` where a page needs it), code constants (access, registry vocabulary, freshness and collection, BOSS readers and proposals: cited from the same constants the code uses, so the page cannot drift), and deployment settings (tenancy: base domain, default tenant, unknown hosts, reserved slugs). The owner gates close the page: what the console and its agents never do. A policy changes where it is recorded, never from a page; when `tin-programme` publishes `policy/autonomy.yaml` and `policy/support-windows.yaml`, those files are the records.
- **Integrations** (`/settings/integrations`, `src/settings/integrations.ts`): every connection this deployment can be given, by environment-variable NAME, grouped (status store, sign-in, BOSS, GitHub, tenancy) with its state (configured, partial with the missing names, not set, defaults), what it switches on, what its absence looks like, and what the owner sets with the rule it must obey. No value is ever read into the page. A `NEXT_PUBLIC_` copy of a server-only name is flagged as a leak to remove and rotate. The one live check is the BOSS reports reader, already bounded and fail-closed. The per-tenant panel shows what phase P4 moves into tenant settings (the BOSS keys and the agent App; names only, secrets stay in the manager) and that every tenant inherits the deployment's connections until then; it waits on W0-03 and OD-9. The Tenants page keeps a one-line summary and links here.
- Navigation: a **Settings** submenu (Tenants, Policy, Integrations). Tests: `src/settings/settings.test.ts`.

## Agent runs and Autonomy (phase 2, 2026-11-01)

The Automation group of the interface strategy (§2.1): the decide-and-act loop's own record, and the policy it runs under.

- **Policy as a decision record.** `config/autonomy.ts` carries the owner-approved autonomy policy (strategy §6; the harness template `policy/autonomy.yaml`): the four classes A0 observe, A1 propose, A2 merge on evidence, A3 act with rollback; the task types with their class and spend cap; what a record must show before the owner moves a type up (20 consecutive merges without human changes, 0 reverts in 30 days, reviewer–human agreement κ ≥ 0.6); automatic demotion for 30 days after a revert or incident; the never-above-A1 topics and paths; and the hard limits every agent runs under. It is read, never edited from a page. When `tin-programme` publishes the YAML, that file replaces this one.
- **Ledger `db/010_agent_ledger.sql`** (from the harness template, W4-06; additive, idempotent; the owner applies it). `agent_ledger_runs` and `agent_ledger_events`, tenant-scoped with RLS, and the `agent_task_type_record` view. A dedicated `agent_ledger_writer` role may insert runs and events and update only the columns that close a run; the console reads; nothing deletes. The owner grants the agent workflows' login that role. `agent_runs` (004) and `pin_proposals` (009) stay as the console's own records.
- **Agent runs** (`/automation/runs`): one timeline of everything automation did in the tenant, from the ledger plus the console's hand-offs, proposals and collector runs, each with the class it ran under (a hand-off's from the size of its step, a proposal A1 because a person sends, the collector A0). Filter by kind. Figures for the last seven days, agents seen, merged, reverted and cost. Nothing is started from this page.
- **Autonomy** (`/automation/autonomy`): the class ladder, every task type with its class, cap and record (runs, merged, consecutive clean merges, reverts in 30 days, κ, last run) and a verdict in the policy's own terms: ready for the next class, not yet and why, held down until a date, never above A1, or highest. The console's own actions and the class each runs under. The never-above-A1 list and the hard limits. The page states that A2 waits on enforced required checks (OD-1) and that a per-agent kill switch is not built.
- Logic is pure and tested (`src/automation/ledger.ts`): a run's fate from its events (last word wins; merged, reverted and closed are final), the consecutive-clean count back from the newest run with open runs neither extending nor breaking it, the 30-day windows, Cohen's κ where both verdicts exist, and the timeline.
- Tests: `db/agent_ledger.test.ts`, `src/automation/ledger.test.ts`.

## Releases and Review queue (BOSS, 2026-11-02)

The two BOSS items the interface strategy listed and the cells did not yet serve (§2.1). Both are operator routes: the console's operator key as `x-api-key`, the signed-in person's Neon Auth token as the bearer, and that person on BOSS's operator list. `src/boss/operator.ts` is the one place those rules live (https only, no redirects, a time budget, fixed reasons, a 409 detail matched but never shown); the readers add their own meanings for 404 and 409.

- **Releases** (`/boss/releases`, `src/boss/releases.ts`, scope `boss.releases.write`): the signed, immutable knowledge bundles platforms pull, listed as metadata (version, SHA-256, who, when) from `GET /v1/knowledge/releases`. An admin builds one with `POST /v1/knowledge/releases` (autonomy class A1): version typed twice because a release is immutable, at most 50 platform space ids, both validated to BOSS's shape before anything leaves the console; BOSS builds, signs, verifies its own output and stores, and refuses an existing version. The console never fetches a bundle and BOSS never serves a key to trust: platforms pin the release public key themselves.
- **Review queue** (`/boss/queue`, `src/boss/queue.ts`, scope `boss.knowledge.write`): platform documents awaiting review from `GET /v1/knowledge/queue`, bound to the signed-in operator, paged by cursor. An admin accepts (publishes the listed revision) or rejects (returns to draft); the action re-reads the queue first so a stale form cannot decide a revision the queue no longer lists, and BOSS refuses a changed document with a 409 besides. No reason travels: the knowledge package has no field for one. A document edited after submission is marked so it is read again before deciding.
- **What a cell serves.** A cell mounts only what its configuration enables: releases need the upstream store and the release key, the queue needs the knowledge login (a Neon Auth cell). `tin-production` has neither, so both pages read a 404 as "this cell does not serve it" rather than as a refusal. `BOSS_OPERATOR_KEY` must carry the scope each page names.
- Navigation: the BOSS submenu gains Releases and Review queue. Tests: `src/boss/releases-queue.test.ts`.

## Still to build

1. Declared versions for the seven Konnect apps other than `konnect-ops`, so drift covers them.
2. A bulk import for new projects, so the registry is not filled one form at a time.
3. Decide whether other systems (registry, cell files) are later generated from the console, or stay as inputs it reconciles against.

## Catalog export (specialist upgrade, phase 1)

`scripts/export-catalog.mjs` writes the declared registry as a Backstage catalog: one YAML file per entity and an `all.yaml` Location. It proves the registry exports without a translation table, and it is the ponytail version of a Backstage EntityProvider: the mapping is `toCatalogEntities()` in `src/registry/catalog.ts`, and a provider would call the same function in-process.

```
CONSOLE_DATABASE_URL=<read-only login> node --experimental-strip-types scripts/export-catalog.mjs catalog
node --experimental-strip-types scripts/export-catalog.mjs catalog --from registry.json   # no database
```

Mapping: hub and shell-base become Systems; package, boss, spoke and app become Components (library, service, service, website); tiers become Domains; groups become Groups; the owner is the project's group, else its owning project's group, else the first owner person (as a User), else an explicit `unowned` group with a warning. Nothing is written back to the registry, and the files are generated, never hand-edited. Backstage is not run here: standing it up waits for a trigger in the strategy (a third product app, more than about 30 projects, or a second team).
