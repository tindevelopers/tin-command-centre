-- Each "Fix with agent" hand-off can now carry the platform support ticket opened for it (in the care hub, apps/ops).
-- ticket_resolved_at is the one column the console may change afterwards: when the declared pin reaches the target
-- version the ticket is resolved and this is stamped, so it is never resolved twice. Idempotent. Requires 004.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ticket_id text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ticket_ref text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ticket_resolved_at timestamptz;

-- Column-level: every other column stays append-only.
GRANT UPDATE (ticket_resolved_at) ON agent_runs TO console_admin;
