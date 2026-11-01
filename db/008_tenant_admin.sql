-- Tenants and operators, phase 2 (tin-boss-api docs/strategy/2026-11-01-control-plane-interface-and-evolution.md, P2):
-- the platform tenant's admins list, create and retire tenants from the console; every other tenant sees only its own row.
-- Additive and idempotent: safe to apply twice. Requires 001 to 006 (007 may or may not have run).
--
-- Why functions: the app roles have no grant on `tenants` (006) and that stays so. These SECURITY DEFINER functions are the only
-- doors. Each checks the caller's tenant, and each writes its own registry_audit row, because `tenants` has no tenant_id column for
-- the audit trigger to read. The audit row lands in the platform tenant, where the person who acted can see it.
--
-- Rollout: deploy the code first (it treats a missing function as "not applied" and shows a notice), then apply this file.

-- 1. Which tenant is the platform. Exactly one; today that is 'tin'.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS platform boolean NOT NULL DEFAULT false;
UPDATE tenants SET platform = true WHERE slug = 'tin' AND NOT platform;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_platform ON tenants ((platform)) WHERE platform;

-- 2. 'control' joins the reserved slugs (src/tenancy/host.ts already refuses it). A named constraint beside 006's unnamed ones.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tenants'::regclass AND conname = 'tenants_slug_reserved') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_slug_reserved
      CHECK (slug NOT IN ('admin', 'www', 'api', 'auth', 'command', 'control', 'app', 'platform'));
  END IF;
END
$$;

-- 3. Is the current transaction's tenant the platform tenant?
CREATE OR REPLACE FUNCTION is_platform_tenant() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce((SELECT t.platform FROM tenants t WHERE t.id = current_tenant()), false) $$;

-- 4. The tenants a caller may see: all of them from the platform tenant, only its own from any other, none with no tenant set.
--    Counts are of live projects and active operators; the function runs as the owner, so row-level security does not hide them.
CREATE OR REPLACE FUNCTION list_tenants()
  RETURNS TABLE (id uuid, slug text, name text, isolation text, connection_ref text, platform boolean,
                 created_at timestamptz, retired_at timestamptz, projects int, operators int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.slug, t.name, t.isolation, t.connection_ref, t.platform, t.created_at, t.retired_at,
         (SELECT count(*)::int FROM projects p WHERE p.tenant_id = t.id AND p.lifecycle <> 'retired'),
         (SELECT count(*)::int FROM console_operators o WHERE o.tenant_id = t.id AND o.removed_at IS NULL)
  FROM tenants t
  WHERE current_tenant() IS NOT NULL AND (t.id = current_tenant() OR is_platform_tenant())
  ORDER BY t.platform DESC, t.retired_at NULLS FIRST, t.slug
$$;

-- 5. Create a tenant. Platform tenant and an audited actor only; the table's checks decide slug, isolation and connection_ref.
--    connection_ref is the NAME of the secret that holds a dedicated tenant's connection string, never the value.
CREATE OR REPLACE FUNCTION create_tenant(p_slug text, p_name text, p_isolation text DEFAULT 'shared', p_connection_ref text DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who    text := nullif(current_setting('console.actor', true), '');
  new_id uuid;
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'tenant write refused: console.actor is not set';
  END IF;
  IF NOT is_platform_tenant() THEN
    RAISE EXCEPTION 'tenant write refused: only the platform tenant manages tenants';
  END IF;
  INSERT INTO tenants (slug, name, isolation, connection_ref)
  VALUES (p_slug, p_name, coalesce(nullif(p_isolation, ''), 'shared'), nullif(p_connection_ref, ''))
  RETURNING tenants.id INTO new_id;
  INSERT INTO registry_audit (tenant_id, actor, table_name, action, before, after)
  VALUES (current_tenant(), who, 'tenants', 'INSERT', NULL, (SELECT to_jsonb(t) FROM tenants t WHERE t.id = new_id));
  RETURN new_id;
END
$$;

-- 6. Retire a tenant. Retiring replaces deleting, as everywhere in the registry; the platform tenant cannot be retired.
CREATE OR REPLACE FUNCTION retire_tenant(p_slug text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who    text := nullif(current_setting('console.actor', true), '');
  before jsonb;
  after  jsonb;
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'tenant write refused: console.actor is not set';
  END IF;
  IF NOT is_platform_tenant() THEN
    RAISE EXCEPTION 'tenant write refused: only the platform tenant manages tenants';
  END IF;
  SELECT to_jsonb(t) INTO before FROM tenants t WHERE t.slug = p_slug;
  IF before IS NULL THEN
    RAISE EXCEPTION 'tenant write refused: no tenant named %', p_slug;
  END IF;
  IF (before ->> 'platform')::boolean THEN
    RAISE EXCEPTION 'tenant write refused: the platform tenant cannot be retired';
  END IF;
  UPDATE tenants t SET retired_at = coalesce(t.retired_at, now()) WHERE t.slug = p_slug;
  SELECT to_jsonb(t) INTO after FROM tenants t WHERE t.slug = p_slug;
  IF before IS DISTINCT FROM after THEN
    INSERT INTO registry_audit (tenant_id, actor, table_name, action, before, after)
    VALUES (current_tenant(), who, 'tenants', 'UPDATE', before, after);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION is_platform_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_tenant(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retire_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_platform_tenant() TO console_reader, console_admin;
GRANT EXECUTE ON FUNCTION list_tenants() TO console_reader, console_admin;
GRANT EXECUTE ON FUNCTION create_tenant(text, text, text, text) TO console_admin;
GRANT EXECUTE ON FUNCTION retire_tenant(text) TO console_admin;
