import { compareVersions, parseVersion } from "@/src/registry/drift";

export type OpenTicketRun = { id: number; ticketId: string; ticketRef: string | null; toVersion: string };

export type ResolveDeps = {
  openRuns(project: string, environment: string, pkg: string): Promise<OpenTicketRun[]>;
  resolveTicket(ticketId: string, note: string): Promise<unknown>;
  markResolved(ids: number[], actor: string): Promise<void>;
};

/**
 * The declared pin changed: resolve the tickets raised for upgrading it, once the new version has reached the
 * target the ticket was raised for. A pin moved somewhere short of the target leaves the ticket open. Each ticket is
 * independent, so one the care hub refuses never blocks another, and only tickets actually resolved are stamped.
 */
export async function resolveTicketsForPin(
  deps: ResolveDeps,
  p: { project: string; environment: string; pkg: string; version: string; actor: string },
): Promise<{ resolved: string[]; errors: string[] }> {
  const now = parseVersion(p.version);
  if (!now) return { resolved: [], errors: [] };
  const runs = (await deps.openRuns(p.project, p.environment, p.pkg)).filter((r) => {
    const target = parseVersion(r.toVersion);
    return !!target && compareVersions(now, target) >= 0;
  });
  const done: OpenTicketRun[] = [];
  const errors: string[] = [];
  for (const r of runs) {
    try {
      await deps.resolveTicket(r.ticketId, `Declared pin for ${p.project} (${p.environment}) set to ${p.pkg} ${p.version} in the TIN ops console by ${p.actor}.`);
      done.push(r);
    } catch (e) {
      errors.push(`${r.ticketRef ?? r.ticketId}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  if (done.length) await deps.markResolved(done.map((r) => r.id), p.actor);
  return { resolved: done.map((r) => r.ticketRef ?? r.ticketId), errors };
}
