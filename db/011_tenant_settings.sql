-- Per-tenant presentation, white-label slice 1 (interface strategy 2026-11-01; one console, many tenants, each with its own look and menu).
--
-- One row per tenant: a brand (display name, accent colour, a same-site logo path) and the list of console modules the tenant
-- uses. No row, or modules NULL, means "every module", so applying this file changes nothing for any tenant until a row is written.
-- The application validates the shape again on every read (src/tenancy/settings.ts) and falls back to the defaults if a row is bad.
-- The modules list is what a tenant SEES. It is not an access control: roles, scopes and row-level security still decide what a
-- person may do. Settings hold names and display values only, never a secret.
-- Additive and idempotent: safe to apply twice. Requires 001 to 006 (and 008 for the platform flag, which this file does not use).
--
-- Rollout: deploy the code first (it treats a missing table as "defaults"), then apply this file.

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id  uuid PRIMARY KEY DEFAULT current_tenant() REFERENCES tenants (id),
  -- Display name shown in the sidebar and header; at most 40 characters, no control characters.
  brand_name text CHECK (brand_name IS NULL OR (char_length(brand_name) BETWEEN 1 AND 40 AND brand_name !~ '[[:cntrl:]]')),
  -- #rrggbb only. Never free CSS.
  accent     text CHECK (accent IS NULL OR accent ~* '^#[0-9a-f]{6}$'),
  -- A path on this site (for example /images/logo/implexus.svg), never a remote URL.
  logo_path  text CHECK (logo_path IS NULL OR (logo_path ~ '^/[A-Za-z0-9._/-]{1,200}$' AND logo_path !~ '//' AND logo_path !~ '\.\.')),
  -- Module ids (config/modules.ts). NULL = all. Unknown ids are ignored by the application; the always-on modules cannot be removed.
  modules    text[] CHECK (modules IS NULL OR cardinality(modules) = 0
                   OR (cardinality(modules) <= 32 AND array_to_string(modules, ',') ~ '^[a-z][a-z0-9-]{0,31}(,[a-z][a-z0-9-]{0,31})*$')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
CREATE POLICY tenant_isolation ON tenant_settings USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
DROP TRIGGER IF EXISTS tenant_settings_audit ON tenant_settings;
CREATE TRIGGER tenant_settings_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION registry_audit_fn();

-- Every signed-in person reads their tenant's row; admins write it. A setting is never deleted by the application (set modules NULL to reset).
GRANT SELECT ON tenant_settings TO console_reader, console_admin;
GRANT INSERT, UPDATE ON tenant_settings TO console_admin;
