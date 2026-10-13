-- DRAFT. Ownership and tiers for the 24 seeded projects (strategy 2026-10-12, M1 and M5). Review before applying.
-- Needs 005_catalog_shape.sql and 001_projects.draft.sql. Idempotent. Run as neondb_owner (or console_admin) in one
-- transaction; every row is audited under the actor below. Change the actor to the person applying it.
--
-- Rules used:
--   * Hubs, shell-bases, chassis, the BOSS, the registry and this console are owned by the group tin-platform.
--   * Konnect's monorepo (konnect-caas-base) is owned by the group konnect; its eight apps are owned by that project
--     (owner_project) and inherit the group, so moving the monorepo to another group moves them with it.
--   * Tiers follow docs/onboarding/02-platform-schema-and-scope.md section 1. tin-boss-api has no tier: the docs put
--     the BOSS in its own layer, which is not one of the seven allowed tier values.
BEGIN;
select set_config('console.actor', 'developer@tin.info', true);

insert into groups (slug, name, parent) values
  ('tin',          'TIN',          null),
  ('tin-platform', 'TIN platform', 'tin'),
  ('konnect',      'Konnect',      null)
on conflict (slug) do nothing;

-- tin-platform: the BOSS, every hub and shell-base, the design hub, governance and internal tooling.
update projects set owner_group = 'tin-platform'
 where slug in ('tin-boss-api', 'shell-base-admin', 'shared-api-hub', 'shared-client-care-hub', 'shared-identity-hub',
                'shared-integration-hub', 'shell-base-cxp', 'shell-base-knowledge', 'shell-base-meetings', 'shell-base-agents',
                'shell-base-finance', 'shell-base-boss', 'chassis', 'shell-base-github-registry', 'tin-ops-console')
   and owner_group is distinct from 'tin-platform';

-- konnect: the monorepo owns itself in the group; each app is owned by the monorepo.
update projects set owner_group = 'konnect' where slug = 'konnect-caas-base' and owner_group is distinct from 'konnect';
update projects set owner_project = 'konnect-caas-base'
 where slug in ('konnect-app', 'konnect-consumer', 'konnect-conversations', 'konnect-knowledge-collab',
                'konnect-knowledge-worker', 'konnect-ops', 'konnect-partner', 'konnect-translator')
   and owner_project is distinct from 'konnect-caas-base';

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
