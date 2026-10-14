import type { CollectorRun } from "./types";

/**
 * On-demand collection. The console never writes observed state itself (it has no collector_writer login, by design).
 * Instead it starts the collector's quick workflow (`collect.yml`), which reuses the committed register for packages, checks cell health live and records a run
 * as collector_writer. The daily `register.yml` schedule is unchanged and still regenerates the register.
 */
const DEFAULT_REPO = "tindevelopers/shell-base-github-registry";
const DEFAULT_WORKFLOW = "collect.yml";

export const collectionConfigured = () => !!process.env.COLLECTOR_GITHUB_TOKEN;

/** Collections started this recently, or a run still marked running, mean one is already under way. */
export const COOLDOWN_MINUTES = 5;
export const RUNNING_WINDOW_MINUTES = 30;

/** A reason not to start another collection, or null when it is fine to go ahead. */
export function collectionBlocked(runs: Pick<CollectorRun, "startedAt" | "status">[], now: Date): string | null {
  const age = (r: Pick<CollectorRun, "startedAt">) => (now.getTime() - r.startedAt.getTime()) / 60_000;
  if (runs.some((r) => r.status === "running" && age(r) < RUNNING_WINDOW_MINUTES)) return "A collection is already running.";
  if (runs.some((r) => age(r) < COOLDOWN_MINUTES)) return `A collection started less than ${COOLDOWN_MINUTES} minutes ago.`;
  return null;
}

/** Starts the collector workflow and returns the URL of its Actions page. Resolves once GitHub accepts the dispatch (HTTP 204). */
export async function startCollection(opts: { token?: string; repo?: string; workflow?: string; ref?: string } = {}): Promise<string> {
  const token = opts.token ?? process.env.COLLECTOR_GITHUB_TOKEN;
  if (!token) throw new Error("COLLECTOR_GITHUB_TOKEN is not set.");
  const repo = opts.repo ?? process.env.COLLECTOR_REPO ?? DEFAULT_REPO;
  const workflow = opts.workflow ?? process.env.COLLECTOR_WORKFLOW ?? DEFAULT_WORKFLOW;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("COLLECTOR_REPO must look like owner/repo.");
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ ref: opts.ref ?? "main" }),
  });
  if (res.status === 404) throw new Error(`GitHub could not find ${workflow} in ${repo}, or the token cannot see it.`);
  if (res.status === 403 || res.status === 401) throw new Error("GitHub refused the token. It needs Actions: read and write on the collector repository.");
  if (res.status === 422) throw new Error(`${workflow} has no workflow_dispatch trigger on the ${opts.ref ?? "main"} branch.`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status} starting the collector.`);
  return `https://github.com/${repo}/actions/workflows/${workflow}`;
}
