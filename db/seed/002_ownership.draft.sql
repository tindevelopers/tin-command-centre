-- DRAFT. Ownership and tiers for the 24 seeded projects (strategy 2026-10-12, M1 and M5). Review before applying.
-- NOTE: written before db/006_tenants.sql. After 006, set app.tenant_id first and use ON CONFLICT (tenant_id, ...) targets. See docs/authority-model.md, "Tenants".
-- Needs 005_catalog_shape.sql and 001_projects.draft.sql. Idempotent. Run as neondb_owner (or console_admin) in one
-- transaction; every row is audited under the actor below. Change the actor to the person applying it.
--
-- Rules used:
--   * The owner's existing owner_project chain is kept as it is. It has two roots that own themselves: tin-boss-api
--     (the BOSS, 9 core hubs and shell-bases, the registry and this console) and konnect-caas-base (Konnect's
--     monorepo, its eight apps and the four shell-base hubs built for Konnect: agents, cxp, knowledge, meetings).
--   * So only the two roots need a group. Everything else inherits it through owner_project, and moving a root to
--     another group moves its whole tree.
--   * Tiers follow docs/onboarding/02-platform-schema-and-scope.md section 1. tin-boss-api has no tier: the docs put
--     the BOSS in its own layer, which is not one of the seven allowed tier values.
BEGIN;
select set_config('console.actor', 'developer@tin.info', true);

insert into groups (slug, name, parent) values
  ('tin',          'TIN',          null),
  ('tin-platform', 'TIN platform', 'tin'),
  ('konnect',      'Konnect',      null)
on conflict (slug) do nothing;

update projects set owner_group = 'tin-platform' where slug = 'tin-boss-api'      and owner_group is distinct from 'tin-platform';
update projects set owner_group = 'konnect'      where slug = 'konnect-caas-base' and owner_group is distinct from 'konnect';

-- Tiers.
update projects set tier = t.tier from (values
  ('shell-base-admin', 'foundation'), ('shared-identity-hub', 'foundation'),
  ('shared-api-hub', 'capability'), ('shared-integration-hub', 'capability'),
  ('shared-client-care-hub', 'domain'), ('shell-base-cxp', 'domain'), ('shell-base-agents', 'domain'),
  ('shell-base-meetings', 'domain'), ('shell-base-knowledge', 'domain'), ('shell-base-boss', 'domain'), ('shell-base-finance', 'domain'),
  ('chassis', 'design'),
  ('shell-base-github-registry', 'governance'),
  ('konnect-caas-base', 'product'), ('konnect-app', 'product'), ('konnect-consumer', 'product'), ('konnect-conversations', 'product'),
  ('konnect-knowledge-collab', 'product'), ('konnect-knowledge-worker', 'product'), ('konnect-ops', 'product'),
  ('konnect-partner', 'product'), ('konnect-translator', 'product'),
  ('tin-ops-console', 'internal')
) as t(slug, tier) where projects.slug = t.slug and projects.tier is distinct from t.tier;

COMMIT;
