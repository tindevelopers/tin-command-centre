import { neon } from "@neondatabase/serverless";
import { cellSnapshots, latestDataRun, packageSnapshots } from "@/src/status/db";
import type { CellSnapshot, CollectorRun, PackageSnapshot } from "@/src/status/types";
import type { Statement } from "./commands";
import type { Group, Registry } from "./types";

type Row = Record<string, any>;

export const registryConfigured = () => Boolean(process.env.CONSOLE_DATABASE_URL);
export const registryWritable = () => Boolean(process.env.CONSOLE_ADMIN_DATABASE_URL);

const read = (text: string, params: unknown[] = []): Promise<Row[]> => neon(process.env.CONSOLE_DATABASE_URL!).query(text, params) as Promise<Row[]>;

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

/** Applies statements in one transaction as console_admin. The actor is set first so the audit trigger records who made the change. */
export async function registryWrite(actor: string, statements: Statement[]): Promise<void> {
  if (!registryWritable()) throw new Error("CONSOLE_ADMIN_DATABASE_URL is not set.");
  const sql = neon(process.env.CONSOLE_ADMIN_DATABASE_URL!);
  await sql.transaction([
    sql.query("select set_config('console.actor', $1, true)", [actor]),
    ...statements.map((s) => sql.query(s.text, s.params)),
  ]);
}

export type AgentRun = {
  projectSlug: string; environment: string; package: string; fromVersion: string; toVersion: string; issueUrl: string; requestedBy: string; requestedAt: Date;
  ticketId: string | null; ticketRef: string | null; ticketResolvedAt: Date | null;
};

/** Recent "Fix with agent" hand-offs, newest first. Empty if the table has not been created yet, so Drift still renders. */
export async function loadAgentRuns(): Promise<AgentRun[]> {
  try {
    const rows = await read("select * from agent_runs order by requested_at desc limit 500");
    return rows.map((r) => ({
      projectSlug: r.project_slug, environment: r.environment, package: r.package, fromVersion: r.from_version, toVersion: r.to_version, issueUrl: r.issue_url,
      requestedBy: r.requested_by, requestedAt: new Date(r.requested_at),
      ticketId: r.ticket_id ?? null, ticketRef: r.ticket_ref ?? null, ticketResolvedAt: r.ticket_resolved_at ? new Date(r.ticket_resolved_at) : null,
    }));
  } catch {
    return [];
  }
}

export async function recordAgentRun(r: Omit<AgentRun, "requestedAt" | "ticketResolvedAt">): Promise<void> {
  await registryWrite(r.requestedBy, [{
    text: "INSERT INTO agent_runs (project_slug, environment, package, from_version, to_version, issue_url, requested_by, ticket_id, ticket_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    params: [r.projectSlug, r.environment, r.package, r.fromVersion, r.toVersion, r.issueUrl, r.requestedBy, r.ticketId, r.ticketRef],
  }]);
}

/** Hand-offs for one pin that have a support ticket still to resolve. */
export async function openTicketRuns(project: string, environment: string, pkg: string): Promise<{ id: number; ticketId: string; ticketRef: string | null; toVersion: string }[]> {
  const rows = await read(
    "select id, ticket_id, ticket_ref, to_version from agent_runs where project_slug = $1 and environment = $2 and package = $3 and ticket_id is not null and ticket_resolved_at is null order by id",
    [project, environment, pkg],
  );
  return rows.map((r) => ({ id: Number(r.id), ticketId: r.ticket_id, ticketRef: r.ticket_ref ?? null, toVersion: r.to_version }));
}

/** Stamps tickets as resolved so they are never resolved twice. */
export async function markTicketsResolved(ids: number[], actor: string): Promise<void> {
  if (!ids.length) return;
  await registryWrite(actor, [{ text: "UPDATE agent_runs SET ticket_resolved_at = now() WHERE id = ANY($1::bigint[]) AND ticket_resolved_at IS NULL", params: [ids] }]);
}
