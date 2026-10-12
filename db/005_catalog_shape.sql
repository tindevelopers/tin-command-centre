-- Catalog shape (strategy 2026-10-12, decisions K1, M1-M5): make the declared registry exportable to a
-- Backstage catalog without a translation table. Values follow the specialist; column names stay ours.
-- Idempotent. Requires 004_project_path_agent_runs.sql.
-- The relation rewrite below is a registry write, so the audit trigger needs an actor: the migration names itself.
SELECT set_config('console.actor', 'migration:005_catalog_shape', false);

-- M1. Owners are groups (organisational units), not only people. A group may sit under a parent group.
CREATE TABLE IF NOT EXISTS groups (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name       text NOT NULL,
  parent     text REFERENCES groups (slug),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent IS NULL OR parent <> slug)
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_group text REFERENCES groups (slug);

-- M4. One column for anything an integration wants to attach (e.g. backstage.io/techdocs-ref).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS annotations jsonb NOT NULL DEFAULT '{}';
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_annotations_object;
ALTER TABLE projects ADD CONSTRAINT projects_annotations_object CHECK (jsonb_typeof(annotations) = 'object');

-- M5. The platform layer a project sits in. Exported as the Backstage Domain; also the input to the R6 layer check.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_tier_check;
ALTER TABLE projects ADD CONSTRAINT projects_tier_check
  CHECK (tier IS NULL OR tier IN ('foundation', 'capability', 'domain', 'design', 'governance', 'product', 'internal'));

-- M2. Relation values are Backstage's verbs. The old CHECK goes first, then rows are rewritten in place, then the new CHECK.
ALTER TABLE project_relations DROP CONSTRAINT IF EXISTS project_relations_relation_check;
UPDATE project_relations SET relation = CASE relation
  WHEN 'consumes' THEN 'depends_on' WHEN 'calls' THEN 'consumes_api' WHEN 'hosts' THEN 'has_part' ELSE relation END
  WHERE relation IN ('consumes', 'calls', 'hosts');
ALTER TABLE project_relations ADD CONSTRAINT project_relations_relation_check
  CHECK (relation IN ('depends_on', 'consumes_api', 'has_part'));

-- K1. One environment vocabulary across credentials, cells and the console.
ALTER TABLE environments DROP CONSTRAINT IF EXISTS environments_name_check;
ALTER TABLE environments ADD CONSTRAINT environments_name_check
  CHECK (name IN ('development', 'preview', 'staging', 'production', 'ci'));

-- Audit and grants follow the registry pattern from 002.
DROP TRIGGER IF EXISTS groups_audit ON groups;
CREATE TRIGGER groups_audit AFTER INSERT OR UPDATE OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION registry_audit_fn();
GRANT SELECT ON groups TO console_reader, console_admin;
GRANT INSERT, UPDATE ON groups TO console_admin;

SELECT set_config('console.actor', '', false);
