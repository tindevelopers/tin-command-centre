-- Multi-tenancy, phase 1 (docs: Programming KB, Products > TIN Command Center > Architecture, multi-tenant).
-- One database, many tenants, isolated by row-level security (RLS). Everything that exists today becomes tenant 'tin'.
-- Idempotent: safe to apply twice. Requires 001 to 005.
--
-- How a request is scoped: the app runs  SELECT set_config('app.tenant_id', '<tenant uuid>', true)  at the start of each
-- transaction (see src/tenancy/db.ts). With no tenant set, current_tenant() is NULL, so every policy matches nothing and
-- every insert is refused: the schema fails closed. The roles console_reader and console_admin are not table owners, so
-- RLS always applies to them. The owner (migrations, seeds) bypasses RLS on purpose.
--
-- Platform data is NOT tenant-scoped: collector_runs and the snapshot tables describe the shared estate and stay as they are.
-- A test (db/tenants.test.ts) fails if a new table is neither tenant-scoped with a policy nor on the platform list.

CREATE TABLE IF NOT EXISTS tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE
                   CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$')
                   CHECK (slug NOT IN ('admin', 'www', 'api', 'auth', 'command', 'app', 'platform')),
  name           text NOT NULL,
  -- 'shared': rows live in this database, isolated by RLS. 'dedicated': the tenant has its own database (enterprise).
  isolation      text NOT NULL DEFAULT 'shared' CHECK (isolation IN ('shared', 'dedicated')),
  -- For 'dedicated': the NAME of the secret that holds its connection string. Never the value.
  connection_ref text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz,
  CHECK (isolation = 'shared' OR connection_ref IS NOT NULL)
);

INSERT INTO tenants (slug, name) VALUES ('tin', 'TIN') ON CONFLICT (slug) DO NOTHING;

-- The tenant of the current transaction, or NULL when none was set.
CREATE OR REPLACE FUNCTION current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- The only way the app roles learn a tenant id. They cannot SELECT from tenants, so one tenant cannot list the others.
CREATE OR REPLACE FUNCTION resolve_tenant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id FROM tenants WHERE slug = p_slug AND retired_at IS NULL $$;

REVOKE ALL ON FUNCTION resolve_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO console_reader, console_admin;
GRANT EXECUTE ON FUNCTION current_tenant() TO console_reader, console_admin;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY; -- no policy and no grant: only the owner and resolve_tenant() can read it

-- 1. tenant_id on every tenant-scoped table. The column starts with a constant default (the 'tin' tenant), which backfills
--    existing rows without an UPDATE, so the audit triggers do not fire. The default then switches to current_tenant().
DO $$
DECLARE
  t text;
  tin uuid := (SELECT id FROM tenants WHERE slug = 'tin');
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'project_relations', 'environments', 'declared_pins', 'boss_adoption', 'assignments',
                           'groups', 'agent_runs', 'registry_audit', 'console_operators']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT %L REFERENCES tenants (id)', t, tin);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT current_tenant()', t);
  END LOOP;
END
$$;

-- 2. Keys: slugs are unique per tenant, and a row can only reference rows of its own tenant (composite foreign keys).
--    Skipped when projects' primary key already includes tenant_id (a second run).
DO $$
DECLARE
  t text;
  c record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'projects'::regclass AND i.indisprimary AND a.attname = 'tenant_id'
  ) THEN
    RETURN;
  END IF;

  -- Drop every foreign key between registry tables (the link to tenants stays).
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE contype = 'f' AND confrelid <> 'tenants'::regclass
      AND conrelid = ANY (ARRAY['projects', 'project_relations', 'environments', 'declared_pins', 'boss_adoption', 'assignments', 'groups', 'agent_runs']::regclass[])
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;

  -- Replace the primary keys that were global.
  FOREACH t IN ARRAY ARRAY['projects', 'project_relations', 'environments', 'declared_pins', 'boss_adoption', 'groups', 'console_operators']
  LOOP
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = t::regclass AND contype = 'p' LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c.conname);
    END LOOP;
  END LOOP;
  ALTER TABLE projects          ADD PRIMARY KEY (tenant_id, slug);
  ALTER TABLE groups            ADD PRIMARY KEY (tenant_id, slug);
  ALTER TABLE environments      ADD PRIMARY KEY (tenant_id, project_slug, name);
  ALTER TABLE declared_pins     ADD PRIMARY KEY (tenant_id, project_slug, environment, package);
  ALTER TABLE boss_adoption     ADD PRIMARY KEY (tenant_id, project_slug, environment);
  ALTER TABLE project_relations ADD PRIMARY KEY (tenant_id, from_slug, to_slug, relation);
  ALTER TABLE console_operators ADD PRIMARY KEY (tenant_id, user_id);

  DROP INDEX IF EXISTS assignments_one_active;
  CREATE UNIQUE INDEX assignments_one_active ON assignments (tenant_id, project_slug, assignee, role) WHERE removed_at IS NULL;

  -- Composite foreign keys, same shape as before with tenant_id first. A NULL slug (no owner) skips the check, as it did.
  ALTER TABLE groups            ADD CONSTRAINT groups_parent_fkey         FOREIGN KEY (tenant_id, parent)       REFERENCES groups (tenant_id, slug);
  ALTER TABLE projects          ADD CONSTRAINT projects_owner_project_fkey FOREIGN KEY (tenant_id, owner_project) REFERENCES projects (tenant_id, slug);
  ALTER TABLE projects          ADD CONSTRAINT projects_owner_group_fkey   FOREIGN KEY (tenant_id, owner_group)   REFERENCES groups (tenant_id, slug);
  ALTER TABLE environments      ADD CONSTRAINT environments_project_fkey   FOREIGN KEY (tenant_id, project_slug)  REFERENCES projects (tenant_id, slug);
  ALTER TABLE declared_pins     ADD CONSTRAINT declared_pins_env_fkey      FOREIGN KEY (tenant_id, project_slug, environment) REFERENCES environments (tenant_id, project_slug, name);
  ALTER TABLE boss_adoption     ADD CONSTRAINT boss_adoption_env_fkey      FOREIGN KEY (tenant_id, project_slug, environment) REFERENCES environments (tenant_id, project_slug, name);
  ALTER TABLE assignments       ADD CONSTRAINT assignments_project_fkey    FOREIGN KEY (tenant_id, project_slug)  REFERENCES projects (tenant_id, slug);
  ALTER TABLE project_relations ADD CONSTRAINT project_relations_from_fkey FOREIGN KEY (tenant_id, from_slug)     REFERENCES projects (tenant_id, slug);
  ALTER TABLE project_relations ADD CONSTRAINT project_relations_to_fkey   FOREIGN KEY (tenant_id, to_slug)       REFERENCES projects (tenant_id, slug);
  ALTER TABLE agent_runs        ADD CONSTRAINT agent_runs_env_fkey         FOREIGN KEY (tenant_id, project_slug, environment) REFERENCES environments (tenant_id, project_slug, name);
END
$$;

-- 3. The audit trigger records the tenant of the row it saw.
CREATE OR REPLACE FUNCTION registry_audit_fn() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who text := nullif(current_setting('console.actor', true), '');
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'registry write refused: console.actor is not set';
  END IF;
  INSERT INTO registry_audit (tenant_id, actor, table_name, action, before, after)
  VALUES ((to_jsonb(COALESCE(NEW, OLD)) ->> 'tenant_id')::uuid, who, TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END
$$;

-- 4. Row-level security: a row is visible and writable only inside its own tenant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'project_relations', 'environments', 'declared_pins', 'boss_adoption', 'assignments',
                           'groups', 'agent_runs', 'registry_audit', 'console_operators']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant())', t);
  END LOOP;
END
$$;
