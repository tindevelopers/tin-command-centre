# Registry seed: draft for review

Drawn from `shell-base-github-registry` (`hubs.json`, `GRAPH.json`, `REGISTER.md`), `tin-boss-api` (`cells/`, `docs/BOSS-API-PROGRAM.md` in `shell-base-admin`) and `konnect-caas-base` (`apps/`, `apps/ops/package.json`). The SQL is `db/seed/001_projects.draft.sql`. **Not applied to Neon.** Owners are left empty because no repo records them.

## Projects (24)

| Kind | Project | Repo | Notes |
|---|---|---|---|
| boss | `tin-boss-api` | tin-boss-api | Stages 1-2 done, 3-8 planned |
| shell-base | `shell-base-admin` | shell-base-admin | Coordinating hub, core-kernel, control-plane |
| hub | `shared-api-hub` | shared-api-hub | api-credentials, api-mcp |
| hub | `shared-client-care-hub` | shared-client-care-hub | contacts, campaigns, pipeline, support |
| hub | `shared-identity-hub` | shared-identity-hub | domain-identity, schema-identity |
| hub | `shared-integration-hub` | shared-integration-hub | adapter-kit, adapters |
| hub | `shell-base-cxp` | shell-base-cxp | comms, domain-translation |
| hub | `shell-base-knowledge` | shell-base-knowledge | knowledge |
| hub | `shell-base-meetings` | shell-base-meetings | meetings |
| hub | `shell-base-agents` | shell-base-agents | agents |
| hub | `shell-base-finance` | shell-base-finance | finance (prerelease) |
| hub | `shell-base-boss` | shell-base-boss | boss package |
| hub | `chassis` | chassis | brands, design-tokens, ui-consumer |
| app | `shell-base-github-registry` | shell-base-github-registry | Registry and future collector |
| spoke | `konnect-caas-base` | konnect-caas-base | Client 1; calls BOSS |
| app | `konnect-app`, `-consumer`, `-conversations`, `-knowledge-collab`, `-knowledge-worker`, `-ops`, `-partner`, `-translator` | konnect-caas-base | The 8 apps under `apps/` |
| app | `tin-ops-console` | tin-ops-console | This console |

Also seeded: 3 environments (`tin-boss-api` development with cell `konnect-dev`; `konnect-ops` development; `tin-ops-console` production), 20 declared versions, one BOSS mode and 20 relationships.

## Declared versions
- **`konnect-ops`, development:** 17 `@tindevelopers/*` versions copied from `apps/ops/package.json` on `main`, such as `ui-shell 1.2.0`, `core-kernel 3.0.0`, `adapter-kit 1.9.1`, `knowledge 0.4.1`. These are what the code requires, not a verified deployment. Several already differ from the registry's `latest`, so they will show as drift straight away.
- **`tin-ops-console`, production:** `ui-shell 1.2.0`, `domain-identity 2.3.0`, `schema-identity 1.1.0`.

## Assumptions to confirm
1. **`shell-base-admin` as `shell-base`.** I used that kind for it only; the other `shell-base-*` repos are hubs, as the registry calls them. Say if "Shell Base" should mean something wider.
2. **Packages are not projects.** There are 39 and the collector already observes each one, so they appear as declared versions instead. The `package` kind is unused for now.
3. **Cell name `konnect-dev`** is the cell file's name; the BOSS cell's own `name` is `tin-boss-api-konnect-dev`. The first collector run will show which one it reports.
4. **Relationships for `konnect-ops` are inferred** from its dependencies (for example `knowledge` implies `shell-base-knowledge`); `tin-boss-api` consuming `shared-api-hub` is inferred from its `API_CREDENTIALS_*` settings. The other seven Konnect apps have no declared versions yet; their `package.json` files were not read.
5. **Not included:** `shell-base-release-kit`, and the many other repos in the account (client sites, forks, older platforms), because I found no link to this platform.
