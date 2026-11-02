import { describe, expect, it } from "vitest";
import { describeCall, operatorCall } from "./operator";
import { buildRelease, describeBuildFailure, describeReleasesFailure, listReleases, nextVersions, parseRelease, parseSpaceIds, validateBuild } from "./releases";
import { decideDocument, describeDecideFailure, describeQueueFailure, listQueue, parseQueueItem, validateDecision } from "./queue";

const env = { BOSS_API_URL: "https://boss.example.com", BOSS_OPERATOR_KEY: "op_secret" };
const U1 = "2f1c9b1e-4f3a-4a7e-9c1d-0b2a3c4d5e6f";
const U2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U3 = "11111111-2222-4333-8444-555555555555";
const SHA = "a".repeat(64);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchWith = (handler: (url: string, init: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, init: init! });
    return handler(url, init!);
  }) as typeof fetch;
  return { f, calls };
};

describe("operatorCall", () => {
  it("sends the operator key and the bearer, https only, never following a redirect", async () => {
    const { f, calls } = fetchWith(() => json({ ok: 1 }));
    const r = await operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: "not_served" }, "jwt", { env, fetch: f });
    expect(r).toEqual({ status: "ok", code: 200, body: { ok: 1 } });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("op_secret");
    expect(h.authorization).toBe("Bearer jwt");
    expect(calls[0].init.redirect).toBe("error");
    expect(await operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: "not_served" }, "jwt", { env: { ...env, BOSS_API_URL: "http://boss.example.com" }, fetch: f })).toMatchObject({ status: "failed", reason: "misconfigured" });
  });
  it("says what is missing and maps every status to a fixed reason; a 409 detail is kept for matching, never shown", async () => {
    expect(await operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: "not_served" }, "jwt", { env: {}, fetch: fetchWith(() => json({})).f })).toEqual({ status: "unconfigured", missing: ["BOSS_API_URL", "BOSS_OPERATOR_KEY"] });
    expect(await operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: "not_served" }, null, { env, fetch: fetchWith(() => json({})).f })).toEqual({ status: "no-operator-token" });
    const r = async (status: number, meaning: "not_served" | "not_found" = "not_served") => operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: meaning }, "jwt", { env, fetch: fetchWith(() => json({ detail: "<b>secret</b>" }, status)).f });
    expect((await r(401) as { reason: string }).reason).toBe("unauthorized");
    expect((await r(403) as { reason: string }).reason).toBe("forbidden");
    expect((await r(404) as { reason: string }).reason).toBe("not_served");
    expect((await r(404, "not_found") as { reason: string }).reason).toBe("not_found");
    expect((await r(409) as { reason: string }).reason).toBe("conflict");
    expect((await r(422) as { reason: string }).reason).toBe("unprocessable");
    expect((await r(503) as { reason: string }).reason).toBe("busy");
    expect((await r(500) as { reason: string }).reason).toBe("http_error");
    const route = { scope: "s", notServed: "ns", notFound: "nf", conflict: "c" };
    for (const status of [401, 403, 404, 409, 422, 503, 500]) {
      const failed = (await r(status)) as Exclude<Awaited<ReturnType<typeof operatorCall>>, { status: "ok" }>;
      expect(describeCall(failed, route)).not.toContain("<");
      expect(describeCall(failed, route)).not.toContain("secret");
    }
    const timeout = fetchWith(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    expect(await operatorCall("/v1/x", { method: "GET", okCodes: [200], notFoundMeans: "not_served" }, "jwt", { env, fetch: timeout.f })).toMatchObject({ status: "failed", reason: "timeout" });
  });
});

describe("releases", () => {
  it("parses metadata strictly", () => {
    expect(parseRelease({ version: "1.2.3", sha256: SHA, createdBy: "u_1", createdAt: "2026-11-01T00:00:00Z" })?.version).toBe("1.2.3");
    expect(parseRelease({ version: "v1", sha256: SHA, createdBy: "u", createdAt: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(parseRelease({ version: "1.2.3", sha256: "zz", createdBy: "u", createdAt: "2026-11-01T00:00:00Z" })).toBeNull();
    expect(parseRelease({ version: "1.2.3", sha256: SHA, createdBy: "u", createdAt: "nope" })).toBeNull();
  });
  it("lists, and treats a 404 as a cell that does not serve releases", async () => {
    const { f, calls } = fetchWith(() => json({ releases: [{ version: "1.0.0", sha256: SHA, createdBy: "u", createdAt: "2026-11-01T00:00:00Z" }] }));
    const r = await listReleases("jwt", { env, fetch: f });
    expect(r.status).toBe("ok");
    expect(calls[0].url).toBe("https://boss.example.com/v1/knowledge/releases?limit=100");
    const off = await listReleases("jwt", { env, fetch: fetchWith(() => json({}, 404)).f });
    expect(off.status).toBe("failed");
    expect(describeReleasesFailure(off as never)).toContain("does not serve releases");
    expect(await listReleases("jwt", { env, fetch: fetchWith(() => json({ releases: [{ version: "x" }] })).f })).toMatchObject({ status: "failed", reason: "malformed" });
  });
  it("validates a build like BOSS and builds with a longer budget", async () => {
    expect(validateBuild({ version: "1.0", spaceIds: [U1] })).toMatch(/semantic/);
    expect(validateBuild({ version: "1.0.0", spaceIds: [] })).toMatch(/at least one/);
    expect(validateBuild({ version: "1.0.0", spaceIds: [U1, U1] })).toMatch(/repeated/);
    expect(validateBuild({ version: "1.0.0", spaceIds: ["nope"] })).toMatch(/UUID/);
    expect(validateBuild({ version: "1.0.0", spaceIds: Array.from({ length: 51 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`) })).toMatch(/at most 50/);
    expect(validateBuild({ version: "1.0.0-rc.1", spaceIds: [U1, U2] })).toBeNull();
    const { f, calls } = fetchWith(() => json({ version: "1.0.0", sha256: SHA }, 201));
    expect(await buildRelease({ version: "1.0.0", spaceIds: [U1.toUpperCase()] }, "jwt", { env, fetch: f })).toEqual({ status: "ok", version: "1.0.0", sha256: SHA });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: "1.0.0", spaceIds: [U1] });
    const conflict = await buildRelease({ version: "1.0.0", spaceIds: [U1] }, "jwt", { env, fetch: fetchWith(() => json({ detail: "exists" }, 409)).f });
    expect(describeBuildFailure(conflict as never)).toContain("already exists");
    expect(await buildRelease({ version: "1.0.0", spaceIds: [U1] }, "jwt", { env, fetch: fetchWith(() => json({ version: "9.9.9", sha256: SHA }, 201)).f })).toMatchObject({ status: "failed", reason: "malformed" });
  });
  it("splits typed space ids and suggests the next versions", () => {
    expect(parseSpaceIds(` ${U1}\n${U2.toUpperCase()}, ${U1} `)).toEqual([U1, U2]);
    expect(nextVersions([{ version: "1.4.2", sha256: SHA, createdBy: "u", createdAt: new Date() }, { version: "1.10.0-rc.1", sha256: SHA, createdBy: "u", createdAt: new Date() }])).toEqual({ patch: "1.10.1", minor: "1.11.0", major: "2.0.0" });
    expect(nextVersions([])).toBeNull();
  });
});

describe("review queue", () => {
  const item = (over: Record<string, unknown> = {}) => ({ documentId: U1, title: "Pricing page", spaceId: U2, spaceName: "Konnect docs", revisionId: U3, revisionNumber: 3, submittedAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T11:00:00Z", ...over });
  it("parses items strictly and bounds the text", () => {
    const p = parseQueueItem(item({ title: "Bad\u0000chars\u001f", documentId: U1.toUpperCase() }))!;
    expect(p.title).toBe("Bad chars");
    expect(p.documentId).toBe(U1);
    expect(parseQueueItem(item({ title: "x".repeat(301) }))).toBeNull();
    expect(parseQueueItem(item({ revisionId: "not-a-uuid" }))).toBeNull();
    expect(parseQueueItem(item({ revisionNumber: 1.5 }))).toBeNull();
    expect(parseQueueItem(item({ title: "" }))?.title).toBe("(untitled)");
  });
  it("lists a page and refuses a bad cursor before calling", async () => {
    const { f, calls } = fetchWith(() => json({ items: [item()], nextCursor: U2 }));
    const r = await listQueue("jwt", { after: U1 }, { env, fetch: f });
    expect(r).toMatchObject({ status: "ok", nextCursor: U2 });
    expect(calls[0].url).toBe(`https://boss.example.com/v1/knowledge/queue?limit=100&after=${U1}`);
    const bad = fetchWith(() => json({}));
    expect(await listQueue("jwt", { after: "../x" }, { env, fetch: bad.f })).toMatchObject({ status: "failed", reason: "rejected" });
    expect(bad.calls).toHaveLength(0);
    const off = await listQueue("jwt", {}, { env, fetch: fetchWith(() => json({}, 404)).f });
    expect(describeQueueFailure(off as never)).toContain("does not serve the review queue");
  });
  it("decides only at the listed revision and checks BOSS's echo", async () => {
    expect(validateDecision({ documentId: "x", revisionId: U3, decision: "accept" })).toMatch(/document id/);
    const { f, calls } = fetchWith(() => json({ documentId: U1, revisionId: U3, status: "published" }));
    expect(await decideDocument({ documentId: U1, revisionId: U3, decision: "accept" }, "jwt", { env, fetch: f })).toEqual({ status: "ok", documentId: U1, revisionId: U3, outcome: "published" });
    expect(calls[0].url).toBe(`https://boss.example.com/v1/knowledge/queue/${U1}/accept`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ revisionId: U3 });
    const wrongEcho = await decideDocument({ documentId: U1, revisionId: U3, decision: "reject" }, "jwt", { env, fetch: fetchWith(() => json({ documentId: U1, revisionId: U3, status: "published" })).f });
    expect(wrongEcho).toMatchObject({ status: "failed", reason: "malformed" });
    const stale = await decideDocument({ documentId: U1, revisionId: U3, decision: "accept" }, "jwt", { env, fetch: fetchWith(() => json({ detail: "newer revision" }, 409)).f });
    expect(describeDecideFailure(stale as never)).toContain("Re-read the queue");
    const gone = await decideDocument({ documentId: U1, revisionId: U3, decision: "accept" }, "jwt", { env, fetch: fetchWith(() => json({}, 404)).f });
    expect(describeDecideFailure(gone as never)).toContain("no longer reviewable");
  });
});
