import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssue, findOpenIssue } from "./github";
import { buildPinTask, bumpSize, issueTitle, validRepo } from "./task";
import type { PinTaskInput } from "./task";

const input: PinTaskInput = {
  repo: "tindevelopers/konnect-caas-base", path: "apps/app", project: "konnect-app", environment: "development", pkg: "@tindevelopers/domain-support",
  declared: "5.1.0", latest: "6.0.0", observedAt: new Date("2026-10-06T07:35:00Z"), packageRepo: "tindevelopers/shared-api-hub",
  origin: "https://command.tinconnect.com", alsoBehind: [{ slug: "konnect-app", environment: "development", version: "5.1.0" }, { slug: "konnect-ops", environment: "development", version: "5.1.0" }],
  requestedBy: "a@tin.info",
};

describe("agent task", () => {
  it("classifies the step", () => {
    expect(bumpSize("5.1.0", "6.0.0")).toBe("major");
    expect(bumpSize("1.2.0", "1.12.2")).toBe("minor");
    expect(bumpSize("0.2.0", "0.2.1")).toBe("patch");
    expect(bumpSize("1.0.0", "1.0.0")).toBeNull();
    expect(bumpSize("^1.0.0", "2.0.0")).toBeNull();
  });
  it("reads as a ticket: where, evidence, what to do, done when, rules", () => {
    const t = buildPinTask(input);
    for (const h of ["## Where this lives", "## Evidence", "## What to do", "## Done when", "## Rules"]) expect(t.body).toContain(h);
    expect(t.body).toMatch(/^@claude /);
    expect(t.body).toContain("`apps/app/package.json`");
    expect(t.body).toContain("https://command.tinconnect.com/projects/konnect-app");
    expect(t.body).toContain("https://github.com/tindevelopers/shared-api-hub/releases");
    expect(t.body).toContain("observed 2026-10-06 07:35 UTC");
    expect(t.body).toContain("**major**");
    expect(t.body).toContain("**draft**");
    expect(t.labels).toEqual(["agent", "dependencies"]);
    expect(t.title).toBe(issueTitle(input));
  });
  it("names the other projects behind, but not this one, and tells the agent to leave them", () => {
    const t = buildPinTask(input);
    expect(t.body).toContain("konnect-ops (development, 5.1.0)");
    expect(t.body).not.toContain("konnect-app (development");
    expect(t.body).toContain("Do not change those here");
    expect(buildPinTask({ ...input, alsoBehind: [] }).body).toContain("No other project is behind");
  });
  it("without a recorded path, tells the agent how to find the app; without an origin, omits links", () => {
    const t = buildPinTask({ ...input, path: null, origin: null, packageRepo: null, observedAt: null });
    expect(t.body).toContain("Not recorded in the registry");
    expect(t.body).not.toContain("Project in the console");
    expect(t.body).not.toContain("Package source");
  });
  it("refuses a pin that is not behind", () => {
    expect(() => buildPinTask({ ...input, declared: "6.0.0" })).toThrow();
  });
  it("only accepts owner/name repos", () => {
    expect(validRepo("tindevelopers/konnect-caas-base")).toBe(true);
    for (const bad of ["", null, "x", "a/b/c", "a/b?x=1", "../a/b"]) expect(validRepo(bad as string)).toBe(false);
  });
});

describe("github", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (...responses: object[]) => {
    const m = vi.fn();
    for (const r of responses) m.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", m);
    return m;
  };

  it("posts to the repo with labels and returns the issue url", async () => {
    const m = stub({ ok: true, json: async () => ({ html_url: "https://github.com/o/r/issues/1" }) });
    expect(await createIssue(buildPinTask(input), "tok")).toBe("https://github.com/o/r/issues/1");
    expect(m.mock.calls[0][0]).toBe("https://api.github.com/repos/tindevelopers/konnect-caas-base/issues");
    expect(JSON.parse(m.mock.calls[0][1].body).labels).toEqual(["agent", "dependencies"]);
  });
  it("retries without labels when GitHub refuses them", async () => {
    const m = stub({ ok: false, status: 422 }, { ok: true, json: async () => ({ html_url: "https://github.com/o/r/issues/2" }) });
    expect(await createIssue(buildPinTask(input), "tok")).toBe("https://github.com/o/r/issues/2");
    expect(JSON.parse(m.mock.calls[1][1].body).labels).toEqual([]);
  });
  it("fails clearly without a token or on an error status", async () => {
    await expect(createIssue(buildPinTask(input), "")).rejects.toThrow(/AGENT_GITHUB_TOKEN/);
    stub({ ok: false, status: 404 });
    await expect(createIssue(buildPinTask(input), "tok")).rejects.toThrow(/404/);
  });
  it("finds an open issue by exact title using the plain issues list, ignoring PRs and near matches", async () => {
    const title = issueTitle(input);
    const m = stub({ ok: true, json: async () => [{ title: title + " v2", html_url: "https://github.com/o/r/issues/9" }, { title, html_url: "https://github.com/o/r/pull/8", pull_request: {} }, { title, html_url: "https://github.com/o/r/issues/7" }] });
    expect(await findOpenIssue("o/r", title, "tok")).toBe("https://github.com/o/r/issues/7");
    expect(m.mock.calls[0][0]).toBe("https://api.github.com/repos/o/r/issues?state=open&per_page=100");
    stub({ ok: true, json: async () => [] });
    expect(await findOpenIssue("o/r", title, "tok")).toBeNull();
    stub({ ok: false, status: 403 });
    await expect(findOpenIssue("o/r", title, "tok")).rejects.toThrow(/403/);
  });
});
