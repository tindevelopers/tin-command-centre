import { describe, expect, it } from "vitest";
import {
  agentPulls, checksWorthReading, describePlatformUnavailable, issueRef, parsePull, parsePulls, pinBumpPulls, platformRepos, pullForProposal, pullForRun,
  readPlatformSignals, summariseChecks,
} from "./platform";

const ID = "2f1c9b1e-4f3a-4a7e-9c1d-0b2a3c4d5e6f";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const pull = (over: Record<string, unknown> = {}) => ({
  number: 41, title: "Bump hub pins", body: "Proposal from BOSS.", state: "open", draft: true, created_at: "2026-11-01T10:00:00Z", merged_at: null,
  head: { ref: `pin-bump/${ID}`, sha: SHA_A }, ...over,
});

describe("platformRepos", () => {
  it("takes live projects of the named platforms, once each, capped", () => {
    const projects = [
      { client: "konnect", repo: "tindevelopers/konnect-caas-base", lifecycle: "active" },
      { client: "konnect", repo: "tindevelopers/konnect-caas-base", lifecycle: "active" },
      { client: "konnect", repo: "tindevelopers/old", lifecycle: "retired" },
      { client: "pawpointers", repo: "tindevelopers/pawpointers-listing-paas", lifecycle: "active" },
      { client: "other", repo: "tindevelopers/other", lifecycle: "active" },
      { client: "konnect", repo: "not a repo", lifecycle: "active" },
      { client: null, repo: "tindevelopers/x", lifecycle: "active" },
    ];
    expect(platformRepos(projects, ["konnect", "pawpointers"])).toEqual(["tindevelopers/konnect-caas-base", "tindevelopers/pawpointers-listing-paas"]);
    expect(platformRepos(projects, [])).toEqual([]);
  });
});

describe("parsePulls", () => {
  it("maps a page and derives merged from merged_at", () => {
    const rows = parsePulls([pull(), pull({ number: 7, state: "closed", merged_at: "2026-11-01T12:00:00Z" }), pull({ number: 8, state: "closed" })], "o/r")!;
    expect(rows.map((r) => r.state)).toEqual(["open", "merged", "closed"]);
    expect(rows[0].url).toBe("https://github.com/o/r/pull/41");
    expect(rows[0].draft).toBe(true);
  });
  it("rejects a bad row and with it the whole page", () => {
    for (const bad of [pull({ number: 0 }), pull({ head: { ref: "x", sha: "nothex" } }), pull({ state: "weird" }), pull({ created_at: "nope" }), pull({ merged_at: 5 }), "x"]) {
      expect(parsePull(bad)).toBeNull();
      expect(parsePulls([pull(), bad], "o/r")).toBeNull();
    }
    expect(parsePulls({ not: "an array" }, "o/r")).toBeNull();
  });
  it("never uses a URL from the body", () => {
    const [r] = parsePulls([pull({ html_url: "https://evil.example/x" })], "o/r")!;
    expect(r.url).toBe("https://github.com/o/r/pull/41");
  });
});

describe("pinBumpPulls", () => {
  it("keeps only pin-bump/<uuid> heads, newest first, with the proposal id", () => {
    const pulls = parsePulls([
      pull({ number: 1, created_at: "2026-11-01T09:00:00Z" }),
      pull({ number: 2, head: { ref: "feat/x", sha: SHA_B } }),
      pull({ number: 3, head: { ref: "pin-bump/../main", sha: SHA_B } }),
      pull({ number: 4, head: { ref: "pin-bump/not-a-uuid", sha: SHA_B } }),
      pull({ number: 5, created_at: "2026-11-01T11:00:00Z", head: { ref: `pin-bump/${ID.replace("2f1c", "ffff")}`, sha: SHA_B } }),
    ], "o/r")!;
    const bumps = pinBumpPulls(pulls, "o/r");
    expect(bumps.map((b) => b.number)).toEqual([5, 1]);
    expect(bumps[1].proposalId).toBe(ID);
  });
});

describe("agentPulls and issue matching", () => {
  it("matches #n as a whole token or the issue URL, once per PR", () => {
    const pulls = parsePulls([
      pull({ number: 10, head: { ref: "agent/upgrade", sha: SHA_B }, title: "Upgrade domain-support", body: "Closes #12\n" }),
      pull({ number: 11, head: { ref: "agent/other", sha: SHA_B }, body: "See https://github.com/o/r/issues/13 and #12" }),
      pull({ number: 12, head: { ref: "x", sha: SHA_B }, body: "Relates to #120 and PR/12" }),
      pull({ number: 13, head: { ref: "y", sha: SHA_B }, body: "https://github.com/other/repo/issues/12" }),
    ], "o/r")!;
    const found = agentPulls(pulls, "o/r", [12, 13]);
    expect(found.map((f) => [f.number, f.issueNumber])).toEqual([[10, 12], [11, 12]]);
    expect(agentPulls(pulls, "o/r", [])).toEqual([]);
  });
  it("reads an issue URL and finds a run's PR", () => {
    expect(issueRef("https://github.com/o/r/issues/12")).toEqual({ repo: "o/r", number: 12 });
    expect(issueRef("https://github.com/o/r/pull/12")).toBeNull();
    expect(issueRef("https://evil.example/o/r/issues/12")).toBeNull();
    const pulls = [{ repo: "o/r", number: 10, url: "https://github.com/o/r/pull/10", issueNumber: 12, state: "open" as const, draft: true, checks: "green" as const }];
    expect(pullForRun({ issueUrl: "https://github.com/o/r/issues/12" }, pulls)?.number).toBe(10);
    expect(pullForRun({ issueUrl: "https://github.com/o/r/issues/99" }, pulls)).toBeNull();
    expect(pullForRun({ issueUrl: "garbage" }, pulls)).toBeNull();
  });
});

describe("summariseChecks", () => {
  const runs = (...r: { status: string; conclusion?: string | null }[]) => ({ check_runs: r });
  it("none, pending, red, green", () => {
    expect(summariseChecks(runs())).toBe("none");
    expect(summariseChecks(runs({ status: "queued" }, { status: "completed", conclusion: "success" }))).toBe("pending");
    expect(summariseChecks(runs({ status: "in_progress" }, { status: "completed", conclusion: "failure" }))).toBe("red");
    expect(summariseChecks(runs({ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }, { status: "completed", conclusion: "neutral" }))).toBe("green");
    expect(summariseChecks(runs({ status: "completed", conclusion: "cancelled" }))).toBe("red");
  });
  it("rejects a malformed body", () => {
    expect(summariseChecks({})).toBeNull();
    expect(summariseChecks({ check_runs: [1] })).toBeNull();
  });
});

describe("checksWorthReading and pullForProposal", () => {
  it("reads open first, then merged, never closed, capped", () => {
    const mk = (n: number, state: "open" | "merged" | "closed") => ({ n, state });
    const list = [mk(1, "closed"), mk(2, "merged"), mk(3, "open"), mk(4, "merged"), mk(5, "open")];
    expect(checksWorthReading(list, 3).map((p) => p.n)).toEqual([3, 5, 2]);
  });
  it("matches a sent proposal by BOSS id", () => {
    const bump = { repo: "o/r", number: 1, url: "u", proposalId: ID, state: "open" as const, draft: false, headSha: SHA_A, createdAt: new Date(), mergedAt: null, checks: "green" as const };
    expect(pullForProposal({ bossId: ID }, [bump])).toBe(bump);
    expect(pullForProposal({ bossId: "other" }, [bump])).toBeNull();
  });
});

describe("readPlatformSignals", () => {
  const env = { AGENT_GITHUB_TOKEN: "ghp_secret" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchWith = (handler: (url: string) => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, init: init! });
      return handler(url);
    }) as typeof fetch;
    return { f, calls };
  };

  it("is unconfigured without a token and empty without repositories, calling nothing", async () => {
    const { f, calls } = fetchWith(() => json([]));
    expect(await readPlatformSignals(["o/r"], [], { env: {}, fetch: f })).toEqual({ status: "unconfigured" });
    expect(await readPlatformSignals([], [], { env, fetch: f })).toEqual({ status: "ok", pinBumps: [], agentPulls: [], repos: [] });
    expect(calls).toHaveLength(0);
  });

  it("lists pulls per repository, reads checks for the ones worth it, and matches both signals", async () => {
    const { f, calls } = fetchWith((url) => {
      if (url.includes("/pulls?")) return json([
        pull(),
        pull({ number: 9, state: "closed", merged_at: "2026-10-30T00:00:00Z", head: { ref: `pin-bump/${ID.replace("2f1c", "ffff")}`, sha: SHA_B } }),
        pull({ number: 20, head: { ref: "agent/fix", sha: SHA_B }, body: "Closes #77" }),
      ]);
      if (url.includes(`/commits/${SHA_A}/check-runs`)) return json({ check_runs: [{ status: "completed", conclusion: "success" }] });
      if (url.includes(`/commits/${SHA_B}/check-runs`)) return json({ check_runs: [{ status: "completed", conclusion: "failure" }] });
      return json({}, 500);
    });
    const r = await readPlatformSignals(["o/r"], [{ issueUrl: "https://github.com/o/r/issues/77" }, { issueUrl: "https://github.com/elsewhere/x/issues/1" }], { env, fetch: f });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pinBumps.map((b) => [b.number, b.state, b.checks])).toEqual([[41, "open", "green"], [9, "merged", "red"]]);
    expect(r.agentPulls.map((a) => [a.number, a.issueNumber, a.checks])).toEqual([[20, 77, "red"]]);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/pulls?state=all&sort=created&direction=desc&per_page=100");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer ghp_secret");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls.filter((c) => c.url.includes("check-runs"))).toHaveLength(3);
  });

  it("fails closed on refusal, error, malformed and timeout, with fixed text", async () => {
    const r = (handler: (url: string) => Response) => readPlatformSignals(["o/r"], [], { env, fetch: fetchWith(handler).f });
    expect(await r(() => json({ message: "Bad credentials <script>" }, 401))).toEqual({ status: "unavailable", reason: "unauthorized" });
    expect(await r(() => json({}, 404))).toEqual({ status: "unavailable", reason: "unauthorized" });
    expect(await r(() => json({}, 502))).toEqual({ status: "unavailable", reason: "http_error" });
    expect(await r(() => json({ not: "a list" }))).toEqual({ status: "unavailable", reason: "malformed" });
    expect(await r(() => new Response("{nope", { status: 200 }))).toEqual({ status: "unavailable", reason: "malformed" });
    const timeout = fetchWith(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    expect(await readPlatformSignals(["o/r"], [], { env, fetch: timeout.f })).toEqual({ status: "unavailable", reason: "timeout" });
    for (const res of [{ status: "unavailable", reason: "unauthorized" }, { status: "unconfigured" }] as const) {
      expect(describePlatformUnavailable(res)).not.toContain("<");
      expect(describePlatformUnavailable(res)).not.toContain("ghp_");
    }
  });

  it("a check-run read that fails fails the whole read rather than showing a partial picture", async () => {
    const { f } = fetchWith((url) => (url.includes("/pulls?") ? json([pull()]) : json({}, 500)));
    expect(await readPlatformSignals(["o/r"], [], { env, fetch: f })).toEqual({ status: "unavailable", reason: "http_error" });
  });
});
