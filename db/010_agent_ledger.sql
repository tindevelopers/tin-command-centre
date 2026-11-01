-- Agent ledger (harness task W4-06; strategy §7.1), from the harness template agent-ledger.sql. The owner reviews and applies
-- it (Standard §11); the application never does. Follows db/004 (append-only, explicit grants) and db/006 (tenant-scoped,
-- RLS with a policy). Additive and idempotent: safe to apply twice. Requires 001 to 006.
--
-- agent_runs (db/004) stays as the record of "Fix with agent" pin hand-offs. This adds, beside it, a general ledger for every
-- agent run of every type, and an append-only event stream for what happened afterwards (checks, reviews, merged, reverted…).
-- The autonomy page reads both; the Retro agent learns from them.
--
-- Rights: a dedicated writer can INSERT runs and events and UPDATE only the columns that close a run. The console reads.
-- Nothing can DELETE.

CREATE TABLE IF NOT EXISTS agent_ledger_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants (id),
  agent          text NOT NULL CHECK (agent ~ '^[a-z0-9-]{1,40}$'),          -- e.g. estate-scanner, ci-doctor
  task_type      text NOT NULL CHECK (task_type ~ '^[a-z0-9.-]{1,64}$'),     -- e.g. upgrade.patch.non-security
  autonomy       text NOT NULL CHECK (autonomy IN ('A0', 'A1', 'A2', 'A3')),
  repository     text NOT NULL CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  model          text NOT NULL,                                              -- the model id that did the work
  reviewer_model text,                                                       -- cross-family reviewer, if any
  trigger        text NOT NULL CHECK (trigger IN ('schedule', 'event', 'issue', 'manual')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  input_tokens   bigint CHECK (input_tokens >= 0),
  output_tokens  bigint CHECK (output_tokens >= 0),
  cost_usd       numeric(10, 4) CHECK (cost_usd >= 0),
  pr_url         text,
  issue_url      text,
  diff_files     integer CHECK (diff_files >= 0),
  diff_lines     integer CHECK (diff_lines >= 0),
  tests_before   integer,                                                    -- test count before/after: tamper signal
  tests_after    integer,
  outcome        text CHECK (outcome IN ('no-op', 'issue', 'draft-pr', 'ready-pr', 'failed', 'over-budget'))
);

CREATE TABLE IF NOT EXISTS agent_ledger_events (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL DEFAULT current_tenant() REFERENCES tenants (id),
  run_id     uuid NOT NULL REFERENCES agent_ledger_runs (id),
  at         timestamptz NOT NULL DEFAULT now(),
  event      text NOT NULL CHECK (event IN (
               'checks-passed', 'checks-failed', 'review-approve', 'review-changes', 'human-approve',
               'human-changes', 'merged', 'closed-unmerged', 'reverted', 'incident', 'rule-proposed', 'rule-accepted')),
  actor      text NOT NULL,                                                  -- github login or agent name
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(detail) <= 4096)
);

CREATE INDEX IF NOT EXISTS agent_ledger_runs_type ON agent_ledger_runs (tenant_id, task_type, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_ledger_events_run ON agent_ledger_events (tenant_id, run_id, at);

-- Tenancy, as db/006: RLS on, policies keyed on current_tenant(); no tenant set means nothing visible and inserts refused.
ALTER TABLE agent_ledger_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_ledger_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_ledger_runs;
CREATE POLICY tenant_isolation ON agent_ledger_runs USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());
DROP POLICY IF EXISTS tenant_isolation ON agent_ledger_events;
CREATE POLICY tenant_isolation ON agent_ledger_events USING (tenant_id = current_tenant()) WITH CHECK (tenant_id = current_tenant());

-- Per task type: merges, human change requests, reverts in 30 days, and cost. Cost is summed per run, not per event.
-- "Consecutive merges without human changes" and reviewer/human agreement need ordered or paired data; the page computes them.
CREATE OR REPLACE VIEW agent_task_type_record WITH (security_invoker = true) AS
SELECT r.tenant_id,
       r.task_type,
       count(*)              AS runs,
       sum(r.cost_usd)       AS cost_usd,
       sum(e.merged)         AS merged,
       sum(e.human_changes)  AS human_changes,
       sum(e.reverts_30d)    AS reverts_30d
FROM agent_ledger_runs r
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE ev.event = 'merged')                                           AS merged,
         count(*) FILTER (WHERE ev.event = 'human-changes')                                    AS human_changes,
         count(*) FILTER (WHERE ev.event = 'reverted' AND ev.at > now() - interval '30 days')  AS reverts_30d
  FROM agent_ledger_events ev WHERE ev.run_id = r.id
) e ON true
GROUP BY r.tenant_id, r.task_type;

-- A dedicated writer role (the agent workflows' login is granted it by the owner). Insert, close a run, never delete.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_ledger_writer') THEN
    CREATE ROLE agent_ledger_writer NOLOGIN;
  END IF;
END $$;
GRANT SELECT ON agent_ledger_runs, agent_ledger_events, agent_task_type_record TO console_reader, console_admin;
GRANT INSERT ON agent_ledger_runs, agent_ledger_events TO agent_ledger_writer;
GRANT SELECT (id, tenant_id) ON agent_ledger_runs TO agent_ledger_writer;   -- needed to UPDATE … WHERE id = …
GRANT UPDATE (finished_at, input_tokens, output_tokens, cost_usd, pr_url, diff_files, diff_lines, tests_after, outcome)
  ON agent_ledger_runs TO agent_ledger_writer;
GRANT USAGE ON SEQUENCE agent_ledger_events_id_seq TO agent_ledger_writer;
