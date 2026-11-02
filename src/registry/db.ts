import { tenantQuery, tenantWrite } from "@/src/tenancy/db";
import { currentTenant } from "@/src/tenancy/tenant";
import { cellSnapshots, latestDataRun, packageSnapshots } from "@/src/status/db";
import type { CellSnapshot, CollectorRun, PackageSnapshot } from "@/src/status/types";
import type { Statement } from "./commands";
import type { Group, Registry } from "./types";

type Row = Record<string, any>;

export const registryConfigured = () => Boolean(process.env.CONSOLE_DATABASE_URL);
export const registryWritable = () => Boolean(process.env.CONSOLE_ADMIN_DATABASE_URL);

/** Every registry read is scoped to the request's tenant; with no tenant the schema returns nothing (db/006). */
const read = async (text: string): Promise<Row[]> => tenantQuery((await currentTenant()).id, text);

/** The whole declared registry. It is small (projects, not telemetry), so one read per page beats per-entity queries. */
export async function loadRegistry(): Promise<Registry> {
  const [projects, environments, pins, assignments, relations] = await Promise.all([
    read("select * from projects order by slug"),
    read("select * from environments order by project_slug, name"),
    read("select * from declared_pins order by project_slug, environment, package"),
    read("select * from assignments where removed_at is null order by assigned_at"),
    read("select * from project_relations order by from_slug, to_slug"),
  ]);
  return {
    projects: projects.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, client: r.client, repo: r.repo, lifecycle: r.lifecycle, notes: r.notes, ownerProject: r.owner_project ?? null, path: r.path ?? null, ownerGroup: r.owner_group ?? null, tier: r.tier ?? null, annotations: r.annotations ?? {} })),
    environments: environments.map((r) => ({ projectSlug: r.project_slug, name: r.name, cell: r.cell, region: r.region, url: r.url })),
    pins: pins.map((r) => ({ projectSlug: r.project_slug, environment: r.environment, package: r.package, version: r.version })),
    assignments: assignments.map((r) => ({ id: String(r.id), projectSlug: r.project_slug, assignee: r.assignee, role: r.role, assignedBy: r.assigned_by, assignedAt: new Date(r.assigned_at) })),
    relations: relations.map((r) => ({ fromSlug: r.from_slug, toSlug: r.to_slug, relation: r.relation })),
  };
}

/** Owning groups (db/005). Groups are added by SQL for now, like operators. Empty before the migration runs. */
export async function loadGroups(): Promise<Group[]> {
  try {
    const rows = await read("select slug, name, parent from groups order by slug");
    return rows.map((r) => ({ slug: r.slug, name: r.name, parent: r.parent ?? null }));
  } catch {
    return [];
  }
}

export type Observed = { run: CollectorRun | null; packages: PackageSnapshot[] | null; cells: CellSnapshot[] | null };

/** What the collector last measured, or nulls before its first successful run. */
export async function loadObserved(): Promise<Observed> {
  const run = await latestDataRun();
  if (!run) return { run: null, packages: null, cells: null };
  const [packages, cells] = await Promise.all([packageSnapshots(run.id), cellSnapshots(run.id)]);
  return { run, packages, cells };
}

/** Applies statements in one transaction as console_admin, inside the request's tenant. The actor is set first so the audit trigger records who made the change. */
export async function registryWrite(actor: string, statements: Statement[]): Promise<void> {
  if (!registryWritable()) throw new Error("CONSOLE_ADMIN_DATABASE_URL is not set.");
  await tenantWrite((await currentTenant()).id, actor, statements);
}

export type AuditEntry = { at: Date; actor: string; table: string; action: string; subject: string | null };

/** The latest registry changes in this tenant, newest first. Empty if the audit table cannot be read, so the Overview still renders. */
export async function loadRecentAudit(limit = 6): Promise<AuditEntry[]> {
  try {
    const rows = await read(`select at, actor, table_name, action,
      coalesce(after->>'slug', before->>'slug', after->>'project_slug', before->>'project_slug', after->>'from_slug', before->>'from_slug', after->>'email', before->>'email') as subject
      from registry_audit order by id desc limit ${Math.max(1, Math.min(50, Math.floor(limit)))}`);
    return rows.map((r) => ({ at: new Date(r.at), actor: r.actor, table: r.table_name, action: r.action, subject: r.subject ?? null }));
  } catch {
    return [];
  }
}

export type AgentRun = { projectSlug: string; environment: string; package: string; fromVersion: string; toVersion: string; issueUrl: string; requestedBy: string; requestedAt: Date };

/** Recent "Fix with agent" hand-offs, newest first. Empty if the table has not been created yet, so Drift still renders. */
export async function loadAgentRuns(): Promise<AgentRun[]> {
  try {
    const rows = await read("select * from agent_runs order by requested_at desc limit 500");
    return rows.map((r) => ({ projectSlug: r.project_slug, environment: r.environment, package: r.package, fromVersion: r.from_version, toVersion: r.to_version, issueUrl: r.issue_url, requestedBy: r.requested_by, requestedAt: new Date(r.requested_at) }));
  } catch {
    return [];
  }
}

export async function recordAgentRun(r: Omit<AgentRun, "requestedAt">): Promise<void> {
  await registryWrite(r.requestedBy, [{
    text: "INSERT INTO agent_runs (project_slug, environment, package, from_version, to_version, issue_url, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    params: [r.projectSlug, r.environment, r.package, r.fromVersion, r.toVersion, r.issueUrl, r.requestedBy],
  }]);
}

export type SentPinProposal = { id: string; platform: string; environment: string; pins: string[]; bossId: string; requestedBy: string; requestedAt: Date };

/** Postgres 42P01: the table does not exist (db/009 not applied). */
const isMissingTable = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";

/** Proposals this tenant sent to BOSS, newest first; null before db/009_pin_proposals.sql is applied, so the page can say so. */
export async function loadPinProposals(limit = 200): Promise<SentPinProposal[] | null> {
  try {
    const rows = await read(`select id, platform, environment, pins, boss_id, requested_by, requested_at from pin_proposals order by requested_at desc limit ${Math.max(1, Math.min(1000, Math.floor(limit)))}`);
    return rows.map((r) => ({ id: String(r.id), platform: r.platform, environment: r.environment, pins: Array.isArray(r.pins) ? r.pins.filter((p: unknown): p is string => typeof p === "string") : [], bossId: r.boss_id, requestedBy: r.requested_by, requestedAt: new Date(r.requested_at) }));
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export async function recordPinProposal(r: Omit<SentPinProposal, "id" | "requestedAt">): Promise<void> {
  await registryWrite(r.requestedBy, [{
    text: "INSERT INTO pin_proposals (platform, environment, pins, boss_id, requested_by) VALUES ($1, $2, $3, $4, $5)",
    params: [r.platform, r.environment, r.pins, r.bossId, r.requestedBy],
  }]);
}


/** Rows of db/010: the agent ledger. null before the migration is applied, so the pages can say so. */
export async function loadLedgerRuns(limit = 500): Promise<LedgerRunRow[] | null> {
  try {
    const rows = await read(`select id, agent, task_type, autonomy, repository, model, reviewer_model, trigger, started_at, finished_at, cost_usd, pr_url, issue_url, diff_files, diff_lines, tests_before, tests_after, outcome
      from agent_ledger_runs order by started_at desc limit ${Math.max(1, Math.min(2000, Math.floor(limit)))}`);
    return rows.map((r) => ({
      id: String(r.id), agent: r.agent, taskType: r.task_type, autonomy: r.autonomy, repository: r.repository, model: r.model, reviewerModel: r.reviewer_model ?? null, trigger: r.trigger,
      startedAt: new Date(r.started_at), finishedAt: r.finished_at ? new Date(r.finished_at) : null, costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
      prUrl: r.pr_url ?? null, issueUrl: r.issue_url ?? null, diffFiles: r.diff_files ?? null, diffLines: r.diff_lines ?? null, testsBefore: r.tests_before ?? null, testsAfter: r.tests_after ?? null, outcome: r.outcome ?? null,
    }));
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export async function loadLedgerEvents(limit = 5000): Promise<LedgerEventRow[] | null> {
  try {
    const rows = await read(`select id, run_id, at, event, actor from agent_ledger_events order by at desc limit ${Math.max(1, Math.min(20000, Math.floor(limit)))}`);
    return rows.map((r) => ({ id: String(r.id), runId: String(r.run_id), at: new Date(r.at), event: r.event, actor: r.actor }));
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export type LedgerRunRow = {
  id: string; agent: string; taskType: string; autonomy: "A0" | "A1" | "A2" | "A3"; repository: string; model: string; reviewerModel: string | null; trigger: "schedule" | "event" | "issue" | "manual";
  startedAt: Date; finishedAt: Date | null; costUsd: number | null; prUrl: string | null; issueUrl: string | null; diffFiles: number | null; diffLines: number | null; testsBefore: number | null; testsAfter: number | null;
  outcome: "no-op" | "issue" | "draft-pr" | "ready-pr" | "failed" | "over-budget" | null;
};
export type LedgerEventRow = { id: string; runId: string; at: Date; event: "checks-passed" | "checks-failed" | "review-approve" | "review-changes" | "human-approve" | "human-changes" | "merged" | "closed-unmerged" | "reverted" | "incident" | "rule-proposed" | "rule-accepted"; actor: string };
