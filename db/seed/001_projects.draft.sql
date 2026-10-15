-- DRAFT. Seed for the TIN Command Center registry. Review before applying; nothing here has been run on Neon.
-- NOTE: written before db/006_tenants.sql. After 006, set app.tenant_id first and use ON CONFLICT (tenant_id, ...) targets. See docs/authority-model.md, "Tenants".
-- Idempotent. Owners are not set: they are not in any repo, so each project will show "No owner assigned" until you assign one.
-- Run as neondb_owner (or console_admin) in one transaction; every row is audited under the actor below.
BEGIN;
select set_config('console.actor', 'developer@tin.info', true);

insert into projects (slug, name, kind, client, repo, lifecycle, notes) values
  ('tin-boss-api', 'TIN BOSS API', 'boss', null, 'tindevelopers/tin-boss-api', 'active', 'Domain API platform on Cloud Run. Stages 1-2 done, 3-8 planned (docs/BOSS-API-PROGRAM.md).'),
  ('shell-base-admin', 'Shell Base Admin', 'shell-base', null, 'tindevelopers/shell-base-admin', 'active', 'Coordinating hub: publishes core-kernel, control-plane, billing, email; owns the hub docs and plans.'),
  ('shared-api-hub', 'Shared API hub', 'hub', null, 'tindevelopers/shared-api-hub', 'active', 'api-credentials, api-mcp.'),
  ('shared-client-care-hub', 'Shared client care hub', 'hub', null, 'tindevelopers/shared-client-care-hub', 'active', 'domain-campaigns, contacts, pipeline, support; schemas; ui-crm.'),
  ('shared-identity-hub', 'Shared identity hub', 'hub', null, 'tindevelopers/shared-identity-hub', 'active', 'domain-identity, schema-identity (canonical copy).'),
  ('shared-integration-hub', 'Shared integration hub', 'hub', null, 'tindevelopers/shared-integration-hub', 'active', 'adapter-kit and the payment/accounting adapters, credential-crypto.'),
  ('shell-base-cxp', 'Shell Base CXP', 'hub', null, 'tindevelopers/shell-base-cxp', 'active', 'comms, domain-translation.'),
  ('shell-base-knowledge', 'Shell Base knowledge', 'hub', null, 'tindevelopers/shell-base-knowledge', 'active', 'knowledge.'),
  ('shell-base-meetings', 'Shell Base meetings', 'hub', null, 'tindevelopers/shell-base-meetings', 'active', 'meetings.'),
  ('shell-base-agents', 'Shell Base agents', 'hub', null, 'tindevelopers/shell-base-agents', 'active', 'agents.'),
  ('shell-base-finance', 'Shell Base finance', 'hub', null, 'tindevelopers/shell-base-finance', 'active', 'domain-finance, domain-platform-billing, schema-finance (prerelease).'),
  ('shell-base-boss', 'Shell Base BOSS package', 'hub', null, 'tindevelopers/shell-base-boss', 'active', 'boss package.'),
  ('chassis', 'Chassis design packages', 'hub', null, 'tindevelopers/chassis', 'active', 'brands, design-tokens, ui-consumer.'),
  ('shell-base-github-registry', 'Shell Base GitHub registry', 'app', null, 'tindevelopers/shell-base-github-registry', 'active', 'Daily register and graph of hub packages; will host the collector.'),
  ('konnect-caas-base', 'Konnect CaaS base', 'spoke', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'Client 1 monorepo; calls BOSS. Cell: konnect-dev.'),
  ('konnect-app', 'Konnect app', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/app'),
  ('konnect-consumer', 'Konnect consumer', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/consumer'),
  ('konnect-conversations', 'Konnect conversations', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/conversations'),
  ('konnect-knowledge-collab', 'Konnect knowledge collab', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/knowledge-collab'),
  ('konnect-knowledge-worker', 'Konnect knowledge worker', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/knowledge-worker'),
  ('konnect-ops', 'Konnect ops', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/ops; first BOSS adoption seam (Stage 4).'),
  ('konnect-partner', 'Konnect partner', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/partner'),
  ('konnect-translator', 'Konnect translator', 'app', 'konnect', 'tindevelopers/konnect-caas-base', 'active', 'apps/translator'),
  ('tin-ops-console', 'TIN Command Center', 'app', null, 'tindevelopers/tin-ops-console', 'active', 'This app (formerly the ops console).')
on conflict (slug) do nothing;

insert into environments (project_slug, name, cell, region, url) values
  ('tin-boss-api', 'development', 'konnect-dev', 'europe-west2', null),
  ('konnect-ops', 'development', null, null, null),
  ('tin-ops-console', 'production', null, null, 'https://tin-ops-console.vercel.app')
on conflict (project_slug, name) do nothing;

insert into declared_pins (project_slug, environment, package, version) values
  ('konnect-ops', 'development', '@tindevelopers/adapter-kit', '1.9.1'),
  ('konnect-ops', 'development', '@tindevelopers/agents', '2.0.0'),
  ('konnect-ops', 'development', '@tindevelopers/comms', '3.0.0'),
  ('konnect-ops', 'development', '@tindevelopers/core-kernel', '3.0.0'),
  ('konnect-ops', 'development', '@tindevelopers/domain-billing', '1.0.2'),
  ('konnect-ops', 'development', '@tindevelopers/domain-control-plane', '1.0.3'),
  ('konnect-ops', 'development', '@tindevelopers/domain-control-plane-client', '0.1.0'),
  ('konnect-ops', 'development', '@tindevelopers/domain-email', '1.0.1'),
  ('konnect-ops', 'development', '@tindevelopers/domain-identity', '2.3.0'),
  ('konnect-ops', 'development', '@tindevelopers/domain-pipeline', '1.2.0'),
  ('konnect-ops', 'development', '@tindevelopers/domain-support', '5.1.0'),
  ('konnect-ops', 'development', '@tindevelopers/domain-translation', '1.0.0'),
  ('konnect-ops', 'development', '@tindevelopers/knowledge', '0.4.1'),
  ('konnect-ops', 'development', '@tindevelopers/meetings', '2.0.0'),
  ('konnect-ops', 'development', '@tindevelopers/platform', '1.4.2'),
  ('konnect-ops', 'development', '@tindevelopers/schema-identity', '1.1.1'),
  ('konnect-ops', 'development', '@tindevelopers/ui-shell', '1.2.0'),
  ('tin-ops-console', 'production', '@tindevelopers/domain-identity', '2.3.0'),
  ('tin-ops-console', 'production', '@tindevelopers/schema-identity', '1.1.0'),
  ('tin-ops-console', 'production', '@tindevelopers/ui-shell', '1.2.0')
on conflict (project_slug, environment, package) do nothing;

insert into boss_adoption (project_slug, environment, domain_mode) values
  ('konnect-ops', 'development', 'inprocess')
on conflict (project_slug, environment) do nothing;

insert into project_relations (from_slug, to_slug, relation) values
  ('konnect-caas-base', 'konnect-app', 'has_part'),
  ('konnect-caas-base', 'konnect-consumer', 'has_part'),
  ('konnect-caas-base', 'konnect-conversations', 'has_part'),
  ('konnect-caas-base', 'konnect-knowledge-collab', 'has_part'),
  ('konnect-caas-base', 'konnect-knowledge-worker', 'has_part'),
  ('konnect-caas-base', 'konnect-ops', 'has_part'),
  ('konnect-caas-base', 'konnect-partner', 'has_part'),
  ('konnect-caas-base', 'konnect-translator', 'has_part'),
  ('konnect-caas-base', 'tin-boss-api', 'consumes_api'),
  ('konnect-ops', 'shell-base-admin', 'depends_on'),
  ('konnect-ops', 'shared-identity-hub', 'depends_on'),
  ('konnect-ops', 'shared-client-care-hub', 'depends_on'),
  ('konnect-ops', 'shared-integration-hub', 'depends_on'),
  ('konnect-ops', 'shell-base-cxp', 'depends_on'),
  ('konnect-ops', 'shell-base-agents', 'depends_on'),
  ('konnect-ops', 'shell-base-knowledge', 'depends_on'),
  ('konnect-ops', 'shell-base-meetings', 'depends_on'),
  ('tin-ops-console', 'shell-base-admin', 'depends_on'),
  ('tin-ops-console', 'shared-identity-hub', 'depends_on'),
  ('tin-boss-api', 'shared-api-hub', 'depends_on')
on conflict do nothing;

COMMIT;
