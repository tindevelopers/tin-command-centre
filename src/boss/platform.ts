import type { AgentRun, SentPinProposal } from "@/src/registry/db";

/**
 * What the platforms did with what BOSS proposed and what the agent was asked: read from GitHub, the only place that evidence exists
 * today, into the two pipeline stages the proposals page reserved.
 *
 * - **PR open on platform.** `pin-bump.yml` (BOSS upstream replan 4b.4, harness W3-03) pushes branch `pin-bump/<proposal id>` and opens a
 *   PR. The proposal id is the BOSS id the console recorded when it sent, so a PR is matched to a sent proposal by its head branch alone:
 *   no title parsing, no label. PRs for proposals sent some other way (another operator, the CLI) still show, unmatched.
 * - **Checks on that PR.** CI on the pin-bump PR is the test-before-upgrading gate (replan 1.3). Its check runs are the evidence that
 *   exists now; the compat canary (W3-01) will post a check run too, so when it lands it appears here without a code change.
 * - **Agent runs.** "Fix with agent" opens an issue; the agent is asked for a draft PR that links it. A PR whose title or body names the
 *   issue (`#n` or its URL) is that run's PR.
 *
 * Rules: server-side only, the same token the agent hand-off uses (`AGENT_GITHUB_TOKEN`), read-only calls, one list per repository plus
 * one check-run read per PR up to a fixed cap, a single time budget for the whole read, and fail closed: a missing token, an error or
 * a malformed body gives an explicit status, never a throw or a partial picture presented as complete. Nothing GitHub returns is passed
 * through unchecked; every field is validated and bounded before it leaves this module, and the token never enters an error or a log.
 */
export type PullState = "open" | "merged" | "closed";
export type CheckState = "green" | "red" | "pending" | "none";

export type PinBumpPull = {
  repo: string;
  number: number;
  url: string;
  /** The BOSS proposal id from the head branch `pin-bump/<id>`. */
  proposalId: string;
  state: PullState;
  draft: boolean;
  headSha: string;
  createdAt: Date;
  mergedAt: Date | null;
  checks: CheckState;
};

export type AgentPull = { repo: string; number: number; url: string; issueNumber: number; state: PullState; draft: boolean; checks: CheckState };

export type PlatformReason = "unauthorized" | "http_error" | "malformed" | "timeout" | "network" | "too_large";

export type PlatformSignals =
  | { status: "ok"; pinBumps: PinBumpPull[]; agentPulls: AgentPull[]; repos: string[] }
  | { status: "unconfigured" }
  | { status: "unavailable"; reason: PlatformReason };

export function describePlatformUnavailable(r: Exclude<PlatformSignals, { status: "ok" }>): string {
  if (r.status === "unconfigured") return "Platform pull requests are not read: set AGENT_GITHUB_TOKEN (read access to pull requests and checks on the platform repositories).";
  const why: Record<PlatformReason, string> = {
    unauthorized: "GitHub refused the console's token for a platform repository.",
    http_error: "GitHub answered with an error.",
    malformed: "GitHub returned an unexpected response.",
    timeout: "GitHub did not answer in time.",
    network: "GitHub could not be reached.",
    too_large: "GitHub returned a response that is too large.",
  };
  return `Platform pull requests are unavailable: ${why[r.reason]}`;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PIN_BUMP_REF = /^pin-bump\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const SHA = /^[0-9a-f]{40}$/;
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d{1,9})$/;
export const MAX_REPOS = 10;
export const MAX_CHECK_READS = 12;
const MAX_BODY_CHARS = 2 * 1024 * 1024;
const MAX_TEXT_SCAN = 20_000;
const DEFAULT_TIMEOUT_MS = 4000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const validRepo = (s: string | null | undefined): s is string => !!s && REPO.test(s);

/** The platform repositories to read: the live projects whose `client` is one of the platforms, deduplicated and capped. */
export function platformRepos(projects: { client: string | null; repo: string | null; lifecycle: string }[], platforms: Iterable<string>): string[] {
  const wanted = new Set(platforms);
  const out: string[] = [];
  for (const p of projects) {
    if (p.lifecycle === "retired" || !p.client || !wanted.has(p.client) || !validRepo(p.repo) || out.includes(p.repo)) continue;
    out.push(p.repo);
    if (out.length >= MAX_REPOS) break;
  }
  return out;
}

type RawPull = { number: number; url: string; headRef: string; headSha: string; title: string; body: string; state: PullState; draft: boolean; createdAt: Date; mergedAt: Date | null };

function pullUrl(repo: string, n: number) {
  return `https://github.com/${repo}/pull/${n}`;
}

/** One row of `GET /repos/{repo}/pulls`, validated and bounded; null rejects the whole page. */
export function parsePull(row: unknown): RawPull | null {
  if (!isObject(row) || !isObject(row.head)) return null;
  const { number, title, body, state, draft, created_at, merged_at } = row;
  if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > 999_999_999) return null;
  if (typeof row.head.ref !== "string" || row.head.ref.length > 256) return null;
  if (typeof row.head.sha !== "string" || !SHA.test(row.head.sha)) return null;
  if (state !== "open" && state !== "closed") return null;
  if (typeof created_at !== "string") return null;
  const createdAt = new Date(created_at);
  if (Number.isNaN(createdAt.getTime())) return null;
  let mergedAt: Date | null = null;
  if (merged_at !== null && merged_at !== undefined) {
    if (typeof merged_at !== "string") return null;
    mergedAt = new Date(merged_at);
    if (Number.isNaN(mergedAt.getTime())) return null;
  }
  return {
    number: number as number,
    url: "", // filled by the caller from the repository and number, never from the body
    headRef: row.head.ref,
    headSha: row.head.sha,
    title: typeof title === "string" ? title.slice(0, MAX_TEXT_SCAN) : "",
    body: typeof body === "string" ? body.slice(0, MAX_TEXT_SCAN) : "",
    state: state === "open" ? "open" : mergedAt ? "merged" : "closed",
    draft: draft === true,
    createdAt,
    mergedAt,
  };
}

export function parsePulls(body: unknown, repo: string): RawPull[] | null {
  if (!Array.isArray(body) || body.length > 100) return null;
  const out: RawPull[] = [];
  for (const row of body) {
    const p = parsePull(row);
    if (!p) return null;
    out.push({ ...p, url: pullUrl(repo, p.number) });
  }
  return out;
}

/**
 * `GET /repos/{repo}/commits/{sha}/check-runs` to one state. No runs is "none" (the repository has no CI on that branch, or only
 * commit statuses, which are not read); any run still queued or in progress is "pending"; any failure, cancellation, timeout or
 * action-required is "red"; otherwise "green". Neutral and skipped runs do not count against green.
 */
export function summariseChecks(body: unknown): CheckState | null {
  if (!isObject(body) || !Array.isArray(body.check_runs)) return null;
  if (body.check_runs.length === 0) return "none";
  let pending = false;
  for (const run of body.check_runs) {
    if (!isObject(run)) return null;
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    const c = run.conclusion;
    if (c === "failure" || c === "cancelled" || c === "timed_out" || c === "action_required" || c === "startup_failure" || c === "stale") return "red";
  }
  return pending ? "pending" : "green";
}

/** The pin-bump PRs among a repository's pulls, newest first. */
export function pinBumpPulls(pulls: RawPull[], repo: string): Omit<PinBumpPull, "checks">[] {
  const out: Omit<PinBumpPull, "checks">[] = [];
  for (const p of pulls) {
    const m = PIN_BUMP_REF.exec(p.headRef);
    if (!m) continue;
    out.push({ repo, number: p.number, url: p.url, proposalId: m[1], state: p.state, draft: p.draft, headSha: p.headSha, createdAt: p.createdAt, mergedAt: p.mergedAt });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Repository and number of a recorded agent-run issue, or null when the URL is not a plain GitHub issue URL. */
export function issueRef(issueUrl: string): { repo: string; number: number } | null {
  const m = ISSUE_URL.exec(issueUrl);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** The PRs in a repository that name one of the given issues (`#n` as a whole token, or the issue URL) in their title or body. */
export function agentPulls(pulls: RawPull[], repo: string, issueNumbers: Iterable<number>): Omit<AgentPull, "checks">[] {
  const wanted = [...new Set(issueNumbers)];
  if (wanted.length === 0) return [];
  const out: Omit<AgentPull, "checks">[] = [];
  for (const p of pulls) {
    const text = `${p.title}\n${p.body}`;
    for (const n of wanted) {
      const token = new RegExp(`(^|[^0-9A-Za-z/])#${n}(?![0-9])`);
      if (token.test(text) || text.includes(`https://github.com/${repo}/issues/${n}`)) {
        out.push({ repo, number: p.number, url: p.url, issueNumber: n, state: p.state, draft: p.draft });
        break;
      }
    }
  }
  return out;
}

/** Which PRs are worth a check-run read: open ones first, then the newest merged, up to the cap. */
export function checksWorthReading<T extends { state: PullState; createdAt?: Date }>(pulls: T[], cap = MAX_CHECK_READS): T[] {
  const open = pulls.filter((p) => p.state === "open");
  const merged = pulls.filter((p) => p.state === "merged");
  return [...open, ...merged].slice(0, cap);
}

/** The pin-bump PR for a sent proposal: the newest whose head branch carries the proposal's BOSS id, if any. */
export function pullForProposal(sent: Pick<SentPinProposal, "bossId">, pinBumps: PinBumpPull[]): PinBumpPull | null {
  return pinBumps.find((p) => p.proposalId === sent.bossId) ?? null;
}

/** The PR for an agent run, matched by the issue it was asked to link. */
export function pullForRun(run: Pick<AgentRun, "issueUrl">, pulls: AgentPull[]): AgentPull | null {
  const ref = issueRef(run.issueUrl);
  if (!ref) return null;
  return pulls.find((p) => p.repo === ref.repo && p.issueNumber === ref.number) ?? null;
}

type ReadOptions = { env?: Record<string, string | undefined>; fetch?: typeof globalThis.fetch; timeoutMs?: number };

const ghHeaders = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" });

/**
 * Reads the pin-bump and agent PRs in the given repositories, with check states for the ones worth reading. Never throws.
 * `agentRuns` only supplies the issue numbers to look for; nothing else about them is sent anywhere.
 */
export async function readPlatformSignals(repos: string[], agentRuns: Pick<AgentRun, "issueUrl">[], opts: ReadOptions = {}): Promise<PlatformSignals> {
  const env = opts.env ?? process.env;
  const token = env.AGENT_GITHUB_TOKEN?.trim();
  if (!token) return { status: "unconfigured" };
  const wanted = repos.filter(validRepo).slice(0, MAX_REPOS);
  if (wanted.length === 0) return { status: "ok", pinBumps: [], agentPulls: [], repos: [] };
  const f = opts.fetch ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = ghHeaders(token);

  const issuesByRepo = new Map<string, number[]>();
  for (const r of agentRuns) {
    const ref = issueRef(r.issueUrl);
    if (ref && wanted.includes(ref.repo)) issuesByRepo.set(ref.repo, [...(issuesByRepo.get(ref.repo) ?? []), ref.number]);
  }

  type Failure = { status: "unavailable"; reason: PlatformReason };
  const getJson = async (url: string): Promise<{ ok: true; body: unknown } | Failure> => {
    const res = await f(url, { method: "GET", headers, redirect: "error", cache: "no-store", signal });
    if (res.status === 401 || res.status === 403 || res.status === 404) return { status: "unavailable", reason: "unauthorized" };
    if (!res.ok) return { status: "unavailable", reason: "http_error" };
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return { status: "unavailable", reason: "too_large" };
    try {
      return { ok: true, body: JSON.parse(text) };
    } catch {
      return { status: "unavailable", reason: "malformed" };
    }
  };

  try {
    const pages = await Promise.all(wanted.map((repo) => getJson(`https://api.github.com/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=100`)));
    const bumps: Omit<PinBumpPull, "checks">[] = [];
    const agents: Omit<AgentPull, "checks">[] = [];
    const shaByUrl = new Map<string, { repo: string; sha: string }>();
    for (let i = 0; i < wanted.length; i++) {
      const page = pages[i];
      if (!("ok" in page)) return page;
      const pulls = parsePulls(page.body, wanted[i]);
      if (!pulls) return { status: "unavailable", reason: "malformed" };
      for (const p of pulls) shaByUrl.set(p.url, { repo: wanted[i], sha: p.headSha });
      bumps.push(...pinBumpPulls(pulls, wanted[i]));
      agents.push(...agentPulls(pulls, wanted[i], issuesByRepo.get(wanted[i]) ?? []));
    }

    const toRead = [...checksWorthReading(bumps), ...checksWorthReading(agents)].slice(0, MAX_CHECK_READS);
    const checks = new Map<string, CheckState>();
    const results = await Promise.all(toRead.map(async (p) => {
      const at = shaByUrl.get(p.url);
      if (!at) return null;
      const r = await getJson(`https://api.github.com/repos/${at.repo}/commits/${at.sha}/check-runs?per_page=100`);
      if (!("ok" in r)) return r;
      const s = summariseChecks(r.body);
      if (s === null) return { status: "unavailable", reason: "malformed" } as Failure;
      checks.set(p.url, s);
      return null;
    }));
    const failed = results.find((r): r is Failure => r !== null);
    if (failed) return failed;

    return {
      status: "ok",
      repos: wanted,
      pinBumps: bumps.map((b) => ({ ...b, checks: checks.get(b.url) ?? "none" })),
      agentPulls: agents.map((a) => ({ ...a, checks: checks.get(a.url) ?? "none" })),
    };
  } catch (e) {
    const name = typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
    return { status: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
