import type { CareHubTicket } from "./carehub";
import { isAtLeast, lowest, type RepoPin } from "./repo";
import { buildCareHubTicket, buildPinTask, issueTitle, ticketMarkerComment, type AgentTask, type PinTaskInput } from "./task";
import type { TicketPriority } from "./task";

export type DispatchInput = Omit<PinTaskInput, "repoVersion">;

/** Everything with side effects, injected so the order of events and every failure path can be tested. */
export type DispatchDeps = {
  readRepoPin(repo: string, path: string | null, pkg: string): Promise<RepoPin>;
  findOpenIssue(repo: string, title: string): Promise<string | null>;
  createIssue(task: AgentTask): Promise<{ url: string; number: number }>;
  commentOnIssue(repo: string, issueNumber: number, body: string): Promise<void>;
  /** null when the care hub is not configured: the GitHub issue alone is then the ticket. */
  createTicket: null | ((t: { subject: string; description: string; priority: TicketPriority }) => Promise<CareHubTicket>);
  recordRun(r: { projectSlug: string; environment: string; package: string; fromVersion: string; toVersion: string; issueUrl: string; requestedBy: string; ticketId: string | null; ticketRef: string | null }): Promise<void>;
};

export type DispatchOutcome =
  | { kind: "refused"; reason: string }
  | { kind: "existing"; issueUrl: string }
  | { kind: "created"; issueUrl: string; ticket: CareHubTicket | null; warnings: string[] };

const message = (e: unknown) => (e instanceof Error ? e.message : "unknown error");

/**
 * One "Fix with agent" click, in order:
 *  1. read the repo's real pin; refuse if it is already at (or past) the latest version
 *  2. reuse an open issue for the same upgrade instead of opening a duplicate
 *  3. open the GitHub issue (the work order the agent runs from)
 *  4. open the platform support ticket (the record) and mark the issue with its id
 *  5. remember the hand-off so Drift can show it
 * The issue is the one step that must succeed. The ticket, the marker and the memory are best effort: each failure
 * becomes a warning the operator sees, never a lost or duplicated work order.
 */
export async function dispatchPin(deps: DispatchDeps, input: DispatchInput): Promise<DispatchOutcome> {
  const pin = await deps.readRepoPin(input.repo, input.path, input.pkg).catch((e): RepoPin => ({ status: "unverified", reason: message(e) }));
  const warnings: string[] = [];
  let repoVersion: string | null = null;

  if (pin.status === "found") {
    if (pin.versions.every((v) => isAtLeast(v, input.latest))) {
      return {
        kind: "refused",
        reason: `${input.project} already pins ${input.pkg} ${pin.versions.join(", ")} in ${pin.file} (latest is ${input.latest}). The registry says ${input.declared}, so the declared pin is the out-of-date one: update it instead.`,
      };
    }
    repoVersion = lowest(pin.versions);
    if (repoVersion !== input.declared) warnings.push(`The repo pins ${repoVersion} but the registry declares ${input.declared}; the registry needs correcting too.`);
  } else {
    warnings.push(`Not checked against the repo (${pin.reason}), so the registry's pin was used.`);
  }

  const full: PinTaskInput = { ...input, repoVersion };
  const task = buildPinTask(full);

  const existing = await deps.findOpenIssue(input.repo, issueTitle(full)).catch((e) => {
    console.error("duplicate check failed, creating the ticket anyway", e);
    return null;
  });
  if (existing) return { kind: "existing", issueUrl: existing };

  const issue = await deps.createIssue(task);

  let ticket: CareHubTicket | null = null;
  if (deps.createTicket) {
    try {
      ticket = await deps.createTicket(buildCareHubTicket(full, issue.url));
    } catch (e) {
      console.error("care hub ticket failed", e);
      warnings.push(`The support ticket was not created (${message(e)}). The GitHub issue is the only record.`);
    }
  }
  if (ticket) {
    try {
      await deps.commentOnIssue(input.repo, issue.number, ticketMarkerComment(ticket));
    } catch (e) {
      console.error("ticket marker comment failed", e);
      warnings.push(`Ticket ${ticket.number} was created but could not be linked on the issue (${message(e)}), so PR progress will not reach it.`);
    }
  }

  try {
    await deps.recordRun({
      projectSlug: input.project, environment: input.environment, package: input.pkg,
      fromVersion: input.declared, toVersion: input.latest, issueUrl: issue.url, requestedBy: input.requestedBy,
      ticketId: ticket?.id ?? null, ticketRef: ticket?.number ?? null,
    });
  } catch (e) {
    console.error("could not record agent run", e);
    warnings.push("The hand-off was not recorded, so Drift will not show it as in progress.");
  }
  return { kind: "created", issueUrl: issue.url, ticket, warnings };
}
