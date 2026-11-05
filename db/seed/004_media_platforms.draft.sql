-- DRAFT. Registers the three platforms that will share the BOSS asset hub (Lifescape, Lock'd, Notarized) and the hub
-- itself (shared-asset-hub). Not applied: applying it is the owner's act (CLAUDE.md, owner gates). Written 2026-11-05.
-- Written for the schema after db/012: rows belong to tenant 'tin' and conflict targets include tenant_id.
-- Idempotent. Run as neondb_owner in one transaction; every row is audited under the actor below.
--
-- What it does NOT declare, on purpose:
--   * No environments or pins. None of the three reports to BOSS yet (no spoke key minted, no POST /v1/reports caller),
--     so a declared environment would show as "not reported" with nothing behind it. Add them with the reporter.
--   * No relation to shared-asset-hub. No platform consumes the hub's packages yet (2026-11-05); adoption is a separate,
--     owner-approved step per platform (shared-asset-hub docs/plans/2026-11-05-shared-media-hub-runbook.md).
-- Relations to hubs are written only when that hub is already registered (seed 001), so this file applies on its own.
BEGIN;
select set_config('console.actor', 'developer@tin.info', true);
select set_config('app.tenant_id', (select id::text from tenants where slug = 'tin'), true);

insert into groups (slug, name, parent) values
  ('lifescape', 'Lifescape', null),
  ('lockd', 'Lock''d', null),
  ('notarized', 'Notarized', null)
on conflict do nothing;

insert into projects (slug, name, kind, client, repo, lifecycle, notes, path, tier, owner_project, owner_group) values
  ('shared-asset-hub', 'Shared asset hub (DAM)', 'hub', null, 'tindevelopers/shared-asset-hub', 'active', 'BOSS digital asset management hub: schema-assets 0.2.0, domain-assets, adapter-assets-b2, adapter-assets-cloudflare, domain-assets-client 0.1.0 on next (2026-10-29). Run in-process by each platform (P-self); needs no BOSS key.', null, 'capability', null, null),
  ('lifescape-platform-v1', 'Lifescape platform', 'spoke', 'lifescape', 'tin-wizard/lifescape-platform-v1', 'active', 'Web, API (Cloud Run) and Expo mobile app. Outside BOSS claims (D-28, P-self); no BOSS key and no reporter yet. Media on R2; asset hub adoption is roadmap 6c (P6-11..P6-17).', null, 'product', 'lifescape-platform-v1', 'lifescape'),
  ('lockd-platform-v1-workos', 'Lock''d platform', 'spoke', 'lockd', 'tin-wizard/lockd-platform-v1-workos', 'active', 'WorkOS identity. Media Hub (R2 landing, B2 mirror, Mux) is on main; default branch phase-0-workos has none. Authoritative branch is open decision O-1. Spoke key planned, not minted; no reporter.', null, 'product', 'lockd-platform-v1-workos', 'lockd'),
  ('notarized-platform-v1', 'Notarized platform', 'spoke', 'notarized', 'tin-wizard/notarized-platform-v1', 'active', 'Supabase plus WorkOS AuthKit; branch develop. Documents, RON recordings, sealed PDFs. No TIN BOSS key or reporter ("BOSS" in its code is FinCEN''s system).', null, 'product', 'notarized-platform-v1', 'notarized')
on conflict (tenant_id, slug) do nothing;

-- The hub is owned like the other hubs (owner_project tin-boss-api), once BOSS is registered.
update projects set owner_project = 'tin-boss-api'
where slug = 'shared-asset-hub' and owner_project is null and exists (select 1 from projects where slug = 'tin-boss-api');

-- Hub packages each platform already depends on (package.json on the branch named in its notes).
insert into project_relations (from_slug, to_slug, relation)
select r.from_slug, r.to_slug, r.relation
from (values
  ('lifescape-platform-v1', 'chassis', 'depends_on'),
  ('lockd-platform-v1-workos', 'shared-identity-hub', 'depends_on'),
  ('lockd-platform-v1-workos', 'shared-client-care-hub', 'depends_on')
) as r (from_slug, to_slug, relation)
where exists (select 1 from projects p where p.slug = r.to_slug)
on conflict do nothing;

COMMIT;
