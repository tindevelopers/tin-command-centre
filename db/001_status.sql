-- TIN Command Center status store (spec §4, plan T2). Idempotent: safe to apply twice.
-- Roles are created here WITHOUT passwords and NOLOGIN. The owner enables login out of band:
--   ALTER ROLE collector_writer LOGIN PASSWORD '...';  ALTER ROLE console_reader LOGIN PASSWORD '...';
-- Create them through SQL, not the Neon console: console-created roles join neon_superuser.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'collector_writer') THEN
    CREATE ROLE collector_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'console_reader') THEN
    CREATE ROLE console_reader NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS collector_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  error       text
);

CREATE TABLE IF NOT EXISTS package_snapshots (
  run_id         bigint NOT NULL REFERENCES collector_runs (id) ON DELETE CASCADE,
  package        text NOT NULL,
  repo           text NOT NULL,
  branch_version text,
  latest         text,
  next           text,
  divergence     text NOT NULL,
  dependents     jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (run_id, package)
);

CREATE TABLE IF NOT EXISTS cell_snapshots (
  run_id         bigint NOT NULL REFERENCES collector_runs (id) ON DELETE CASCADE,
  cell           text NOT NULL,
  client         text NOT NULL,
  ring           integer NOT NULL,
  region         text NOT NULL,
  url            text,
  healthz_status integer,
  readyz_status  integer,
  checked_at     timestamptz NOT NULL,
  PRIMARY KEY (run_id, cell)
);

-- Phase 2. Metadata only (spec C5): no hash, pepper or secret column exists, so none can be written.
CREATE TABLE IF NOT EXISTS credential_snapshots (
  run_id       bigint NOT NULL REFERENCES collector_runs (id) ON DELETE CASCADE,
  cell         text NOT NULL,
  public_id    text NOT NULL,
  program      text NOT NULL,
  environment  text NOT NULL,
  status       text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  PRIMARY KEY (run_id, cell, public_id)
);

CREATE TABLE IF NOT EXISTS console_operators (
  user_id    text PRIMARY KEY,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),
  added_by   text NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

GRANT USAGE ON SCHEMA public TO collector_writer, console_reader;

GRANT SELECT ON collector_runs, package_snapshots, cell_snapshots, credential_snapshots, console_operators
  TO console_reader;

GRANT SELECT, INSERT, DELETE ON collector_runs TO collector_writer;
GRANT UPDATE (finished_at, status, error) ON collector_runs TO collector_writer;
GRANT SELECT, INSERT ON package_snapshots, cell_snapshots, credential_snapshots TO collector_writer;
