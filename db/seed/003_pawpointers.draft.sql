-- DRAFT. Registers PawPointers, the first spoke that reports to BOSS. Review before applying; nothing here has been run on Neon.
-- Written for the schema after db/007: rows belong to tenant 'tin' and conflict targets include tenant_id.
-- Idempotent. Run as neondb_owner in one transaction; every row is audited under the actor below.
-- Environments are development, staging and production only (no preview keys). Only the dashboard reports (component
-- `pawpointers-dashboard`, POST /v1/reports from apps/dashboard/lib/boss/report.ts), so only it gets environments and pins.
-- Relations to hubs are written only when that hub is already registered (seed 001), so this file applies on its own.
BEGIN;
select set_config('console.actor', 'developer@tin.info', true);
select set_config('app.tenant_id', (select id::text from tenants where slug = 'tin'), true);

insert into projects (slug, name, kind, client, repo, lifecycle, notes, path, tier) values
  ('pawpointers-listing-paas', 'PawPointers listing platform', 'spoke', 'pawpointers', 'tindevelopers/pawpointers-listing-paas', 'active', 'Client monorepo (admin, portal, dashboard); first spoke that reports to BOSS. Cell: tin-production.', null, null),
  ('pawpointers-dashboard', 'PawPointers dashboard', 'app', 'pawpointers', 'tindevelopers/pawpointers-listing-paas', 'active', 'Reports to BOSS every 10 minutes as component pawpointers-dashboard.', 'apps/dashboard', 'product'),
  ('pawpointers-admin', 'PawPointers admin', 'app', 'pawpointers', 'tindevelopers/pawpointers-listing-paas', 'active', 'No BOSS reporter yet.', 'apps/admin', 'product'),
  ('pawpointers-portal', 'PawPointers portal', 'app', 'pawpointers', 'tindevelopers/pawpointers-listing-paas', 'active', 'No BOSS reporter yet.', 'apps/portal', 'product')
on conflict (tenant_id, slug) do nothing;

insert into environments (project_slug, name, cell, region, url) values
  ('pawpointers-dashboard', 'development', null, null, null),
  ('pawpointers-dashboard', 'staging', null, null, null),
  ('pawpointers-dashboard', 'production', 'tin-production', 'europe-west2', null)
on conflict (tenant_id, project_slug, name) do nothing;

-- The version the dashboard declares (packages/@listing-platform/booking/package.json on develop) and reports.
insert into declared_pins (project_slug, environment, package, version) values
  ('pawpointers-dashboard', 'development', '@tindevelopers/credential-crypto', '1.0.0'),
  ('pawpointers-dashboard', 'staging', '@tindevelopers/credential-crypto', '1.0.0'),
  ('pawpointers-dashboard', 'production', '@tindevelopers/credential-crypto', '1.0.0')
on conflict (tenant_id, project_slug, environment, package) do nothing;

insert into project_relations (from_slug, to_slug, relation)
select r.from_slug, r.to_slug, r.relation
from (values
  ('pawpointers-listing-paas', 'pawpointers-dashboard', 'has_part'),
  ('pawpointers-listing-paas', 'pawpointers-admin', 'has_part'),
  ('pawpointers-listing-paas', 'pawpointers-portal', 'has_part'),
  ('pawpointers-listing-paas', 'tin-boss-api', 'consumes_api'),
  ('pawpointers-admin', 'shared-identity-hub', 'depends_on'),
  ('pawpointers-admin', 'shared-client-care-hub', 'depends_on'),
  ('pawpointers-dashboard', 'shared-integration-hub', 'depends_on')
) as r (from_slug, to_slug, relation)
where exists (select 1 from projects p where p.slug = r.to_slug)
on conflict do nothing;

COMMIT;
