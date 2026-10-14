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
  const [projects, environments, pins, adoption, assignments, relations] = await Promise.all([
    read("select * from projects order by slug"),
    read("select * from environments order by project_slug, name"),
    read("select * from declared_pins order by project_slug, environment, package"),
    read("select * from boss_adoption"),
    read("select * from assignments where removed_at is null order by assigned_at"),
    read("select * from project_relations order by from_slug, to_slug"),
  ]);
  return {
    projects: projects.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, client: r.client, repo: r.repo, lifecycle: r.lifecycle, notes: r.notes, ownerProject: r.owner_project ?? null, path: r.path ?? null, ownerGroup: r.owner_group ?? null, tier: r.tier ?? null, annotations: r.annotations ?? {} })),
    environments: environments.map((r) => ({ projectSlug: r.project_slug, name: r.name, cell: r.cell, region: r.region, url: r.url })),
    pins: pins.map((r) => ({ projectSlug: r.project_slug, environment: r.environment, package: r.package, version: r.version })),
    adoption: adoption.map((r) => ({ projectSlug: r.project_slug, environment: r.environment, domainMode: r.domain_mode })),
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
