-- Pin proposals the console sent to BOSS (interface strategy 2026-11-01, build-order step 4).
--
-- BOSS is the system of record for a proposal (POST /v1/pin-proposals returns its id; the platform pulls it with
-- GET /v1/pin-proposals/latest). The console's reader key may not read proposals back, so the console keeps its own
-- record of what it sent: platform, environment, the pins, BOSS's id, who and when. Append-only, tenant-scoped, audited.
-- Additive and idempotent: safe to apply twice. Requires 001 to 006.

CREATE TABLE IF NOT EXISTS pin_proposals (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants (id),
  -- The BOSS platform (a project's client), the same pattern BOSS enforces on the request.
  platform     text NOT NULL CHECK (platform ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- The declared environment the pins were taken from; BOSS does not carry it, the console needs it to compare later.
  environment  text NOT NULL,
  -- '@tindevelopers/<package>@<version>' strings, at most ten, as sent.
  pins         text[] NOT NULL CHECK (cardinality(pins) BETWEEN 1 AND 10),
  boss_id      text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pin_proposals_latest ON pin_proposals (tenant_id, platform, environment, requested_at DESC);

-- Tenant isolation and audit, the same shape 006 gives every registry table.
ALTER TABLE pin_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pin_proposals;
CREATE POLICY tenant_isolation ON pin_proposals USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
DROP TRIGGER IF EXISTS pin_proposals_audit ON pin_proposals;
CREATE TRIGGER pin_proposals_audit AFTER INSERT OR UPDATE OR DELETE ON pin_proposals FOR EACH ROW EXECUTE FUNCTION registry_audit_fn();

-- Append-only: admins record what they sent; nobody edits or deletes a record. BOSS holds the proposal itself.
GRANT SELECT ON pin_proposals TO console_reader, console_admin;
GRANT INSERT ON pin_proposals TO console_admin;
GRANT USAGE ON SEQUENCE pin_proposals_id_seq TO console_admin;
