-- White-label slice 3: the platform tenant's admins read and set ANOTHER tenant's workspace settings (interface strategy 2026-11-01).
-- Requires 006, 008 (is_platform_tenant) and 011 (tenant_settings). Additive and idempotent: safe to apply twice.
--
-- Why functions: tenant_settings is row-level secured to its own tenant (011) and that stays so; no app role can touch another tenant's
-- row. These SECURITY DEFINER functions are the only doors, the same shape as 008: each checks that the caller's tenant is the
-- platform tenant, refuses a write without an audited actor, and refuses a retired or unknown target.
--
-- Audit: the row-level trigger on tenant_settings records the change in the TARGET tenant, so that tenant can see who changed its
-- settings. set_tenant_settings also writes one row in the platform tenant, so the platform's admins can see what they changed
-- elsewhere. Settings are names and display values only, never a secret.
--
-- Rollout: deploy the code first (it treats a missing function as "not applied"), then apply this file after 011.

-- Read one tenant's settings row (zero rows when it has none). Platform tenant only.
CREATE OR REPLACE FUNCTION get_tenant_settings(p_slug text)
  RETURNS TABLE (brand_name text, accent text, logo_path text, modules text[], updated_at timestamptz, updated_by text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT is_platform_tenant() THEN
    RAISE EXCEPTION 'tenant settings refused: only the platform tenant manages other tenants';
  END IF;
  RETURN QUERY
    SELECT s.brand_name, s.accent, s.logo_path, s.modules, s.updated_at, s.updated_by
    FROM tenant_settings s JOIN tenants t ON t.id = s.tenant_id
    WHERE t.slug = p_slug;
END
$$;

-- Set one tenant's settings (insert or replace its single row). The table's CHECK constraints decide the values.
CREATE OR REPLACE FUNCTION set_tenant_settings(p_slug text, p_brand_name text, p_accent text, p_logo_path text, p_modules text[])
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who       text := nullif(current_setting('console.actor', true), '');
  target    uuid;
  new_row   jsonb;
BEGIN
  IF who IS NULL THEN
    RAISE EXCEPTION 'tenant settings refused: console.actor is not set';
  END IF;
  IF NOT is_platform_tenant() THEN
    RAISE EXCEPTION 'tenant settings refused: only the platform tenant manages other tenants';
  END IF;
  SELECT t.id INTO target FROM tenants t WHERE t.slug = p_slug AND t.retired_at IS NULL;
  IF target IS NULL THEN
    RAISE EXCEPTION 'tenant settings refused: no active tenant named %', p_slug;
  END IF;
  INSERT INTO tenant_settings (tenant_id, brand_name, accent, logo_path, modules, updated_at, updated_by)
  VALUES (target, p_brand_name, p_accent, p_logo_path, p_modules, now(), who)
  ON CONFLICT (tenant_id) DO UPDATE SET brand_name = excluded.brand_name, accent = excluded.accent, logo_path = excluded.logo_path,
    modules = excluded.modules, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  -- The trigger has recorded the change in the target tenant. Record it in the platform tenant too, unless they are the same.
  IF target <> current_tenant() THEN
    SELECT to_jsonb(s) INTO new_row FROM tenant_settings s WHERE s.tenant_id = target;
    INSERT INTO registry_audit (tenant_id, actor, table_name, action, before, after)
    VALUES (current_tenant(), who, 'tenant_settings', 'SET_FOR_TENANT', jsonb_build_object('slug', p_slug), new_row);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION get_tenant_settings(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_tenant_settings(text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_tenant_settings(text) TO console_reader, console_admin;
GRANT EXECUTE ON FUNCTION set_tenant_settings(text, text, text, text, text[]) TO console_admin;
