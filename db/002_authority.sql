-- TIN Command Center registry: the declared (authoritative) state. Spec amendment: docs/authority-model.md.
-- Idempotent: safe to apply twice. Requires 001_status.sql.
-- Observed state (collector snapshots) is compared against this; it never overwrites it.
-- console_admin is created NOLOGIN, like the other roles; the owner enables login out of band.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'console_admin') THEN
    CREATE ROLE console_admin NOLOGIN;
  END IF;
END
$$;

-- Operators can now be admins (may change the registry) as well as viewers.
ALTER TABLE console_operators DROP CONSTRAINT IF EXISTS console_operators_role_check;
ALTER TABLE console_operators ADD CONSTRAINT console_operators_role_check CHECK (role IN ('viewer', 'admin'));

-- Everything TIN tracks: the BOSS, hubs, spokes, packages, Shell Base and consuming apps.
CREATE TABLE IF NOT EXISTS projects (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('boss', 'hub', 'spoke', 'package', 'shell-base', 'app')),
  client     text,
  repo       text,
  lifecycle  text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('planned', 'active', 'retired')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who depends on or hosts whom, e.g. app consumes hub, hub consumes package, spoke calls boss.
CREATE TABLE IF NOT EXISTS project_relations (
  from_slug text NOT NULL REFERENCES projects (slug),
  to_slug   text NOT NULL REFERENCES projects (slug),
  relation  text NOT NULL CHECK (relation IN ('consumes', 'calls', 'hosts')),
  PRIMARY KEY (from_slug, to_slug, relation),
  CHECK (from_slug <> to_slug)
);

CREATE TABLE IF NOT EXISTS environments (
  project_slug text NOT NULL REFERENCES projects (slug),
  name         text NOT NULL CHECK (name IN ('development', 'staging', 'production')),
  cell         text,
  region       text,
  url          text,
  PRIMARY KEY (project_slug, name)
);

-- Declared package versions per project and environment. Drift = this versus package_snapshots.
CREATE TABLE IF NOT EXISTS declared_pins (
  project_slug text NOT NULL,
  environment  text NOT NULL,
  package      text NOT NULL,
  version      text NOT NULL,
  PRIMARY KEY (project_slug, environment, package),
  FOREIGN KEY (project_slug, environment) REFERENCES environments (project_slug, name)
);

-- Declared BOSS adoption mode per consuming project and environment.
CREATE TABLE IF NOT EXISTS boss_adoption (
  project_slug text NOT NULL,
  environment  text NOT NULL,
  domain_mode  text NOT NULL CHECK (domain_mode IN ('inprocess', 'shadow', 'remote')),
  PRIMARY KEY (project_slug, environment),
  FOREIGN KEY (project_slug, environment) REFERENCES environments (project_slug, name)
);

-- Who is responsible for a project. History is kept: ending an assignment sets removed_at.
CREATE TABLE IF NOT EXISTS assignments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_slug text NOT NULL REFERENCES projects (slug),
  assignee     text NOT NULL,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'maintainer')),
  assigned_by  text NOT NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_active
  ON assignments (project_slug, assignee, role) WHERE removed_at IS NULL;

-- Append-only record of every registry change, written by trigger so no write can skip it.
CREATE TABLE IF NOT EXISTS registry_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,
  table_name text NOT NULL,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb
);

-- The console sets the signed-in admin per transaction: SELECT set_config('console.actor', email, true).
-- A write without an actor is refused.
CREATE OR REPLACE FUNCTION registry_audit_fn() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who text := nullif(current_setting('console.actor', true), '');
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'registry write refused: console.actor is not set';
  END IF;
  INSERT INTO registry_audit (actor, table_name, action, before, after)
  VALUES (who, TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'project_relations', 'environments', 'declared_pins', 'boss_adoption', 'assignments', 'console_operators']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registry_audit_fn()', t || '_audit', t);
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION registry_audit_fn() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO console_admin;

GRANT SELECT ON projects, project_relations, environments, declared_pins, boss_adoption, assignments, registry_audit
  TO console_reader, console_admin;
GRANT SELECT ON console_operators, collector_runs, package_snapshots, cell_snapshots, credential_snapshots TO console_admin;

-- Admins add and change registry rows. Removing a row is a deliberate act: only link tables and pins can be deleted.
GRANT INSERT, UPDATE ON projects, environments, assignments TO console_admin;
GRANT INSERT, UPDATE, DELETE ON project_relations, declared_pins, boss_adoption TO console_admin;
GRANT INSERT, UPDATE ON console_operators TO console_admin;
