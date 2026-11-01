import { describe, expect, it } from "vitest";
import { parseReports, readReports } from "./reports";

const KEY = "tin_sk_test_0123456789abcdef";
const env = { BOSS_API_URL: "https://boss.example.test", BOSS_REPORTS_KEY: KEY };

const row = (over: Record<string, unknown> = {}) => ({
  platform: "konnect",
  environment: "staging",
  component: "knowledge-worker",
  versions: { "@tindevelopers/knowledge": "0.4.1", "@tindevelopers/knowledge-worker": "0.4.1" },
  health: "ok",
  errors: [{ code: "lease_expired", count: 2 }],
  reportedAt: "2026-10-14T10:00:00.000Z",
  ...over,
});

const json = (body: unknown, init: ResponseInit = { status: 200 }) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });

describe("parseReports (the one place the wire shape is mapped)", () => {
  it("accepts a bare array and a { reports } wrapper", () => {
    expect(parseReports([row()])).toHaveLength(1);
    expect(parseReports({ reports: [row()] })).toHaveLength(1);
    expect(parseReports({ reports: [] })).toEqual([]);
  });

  it("maps a row to the internal shape", () => {
    const [r] = parseReports([row()])!;
    expect(r).toEqual({
      platform: "konnect",
      environment: "staging",
      component: "knowledge-worker",
      versions: { "@tindevelopers/knowledge": "0.4.1", "@tindevelopers/knowledge-worker": "0.4.1" },
      health: "ok",
      errors: [{ code: "lease_expired", count: 2 }],
      reportedAt: new Date("2026-10-14T10:00:00.000Z"),
    });
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a wrapper without reports", { items: [] }],
    ["a row that is not an object", [1]],
    ["a bad platform", [row({ platform: "Konnect; drop" })]],
    ["a bad component", [row({ component: "has space" })]],
    ["an unknown health", [row({ health: "fine" })]],
    ["versions that is an array", [row({ versions: ["0.4.1"] })]],
    ["a version value with markup", [row({ versions: { "@tindevelopers/knowledge": "<img src=x>" } })]],
    ["a version value that is not a string", [row({ versions: { "@tindevelopers/knowledge": 4 } })]],
    ["a package key with markup", [row({ versions: { "<b>": "1.0.0" } })]],
    ["more than 50 versions", [row({ versions: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, "1.0.0"])) })]],
    ["errors that is not an array", [row({ errors: "boom" })]],
    ["an error code with free text", [row({ errors: [{ code: "Something went wrong!", count: 1 }] })]],
    ["an error count that is not an integer", [row({ errors: [{ code: "x", count: 1.5 }] })]],
    ["more than 20 errors", [row({ errors: Array.from({ length: 21 }, (_, i) => ({ code: `e${i}`, count: 1 })) })]],
    ["a missing reportedAt", [row({ reportedAt: undefined })]],
    ["an unparseable reportedAt", [row({ reportedAt: "yesterday-ish" })]],
  ])("returns null for %s", (_label, body) => {
    expect(parseReports(body)).toBeNull();
  });

  it("one bad row fails the whole response (closed, not partial)", () => {
    expect(parseReports([row(), row({ health: "???" })])).toBeNull();
  });
});

describe("readReports", () => {
  it("is 'unconfigured' without a URL or key, and never calls fetch", async () => {
    let called = false;
    const fetch = (async () => { called = true; return json([]); }) as typeof globalThis.fetch;
    expect(await readReports({ env: {}, fetch })).toEqual({ status: "unconfigured" });
    expect(await readReports({ env: { BOSS_API_URL: env.BOSS_API_URL }, fetch })).toEqual({ status: "unconfigured" });
    expect(await readReports({ env: { BOSS_REPORTS_KEY: KEY }, fetch })).toEqual({ status: "unconfigured" });
    expect(called).toBe(false);
  });

  it("calls GET /v1/reports server-side with the spoke key in x-api-key, a timeout and no redirects", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetch = (async (url: URL | string, init: RequestInit) => { seen = { url: String(url), init }; return json({ reports: [row()] }); }) as typeof globalThis.fetch;
    const res = await readReports({ env, fetch });
    expect(res.status).toBe("ok");
    expect(seen?.url).toBe("https://boss.example.test/v1/reports");
    expect(seen?.init.method ?? "GET").toBe("GET");
    expect((seen?.init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(seen?.init.redirect).toBe("error");
    expect(seen?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps a base URL path and ignores a trailing slash", async () => {
    let url = "";
    const fetch = (async (u: URL | string) => { url = String(u); return json([]); }) as typeof globalThis.fetch;
    await readReports({ env: { ...env, BOSS_API_URL: "https://boss.example.test/" }, fetch });
    expect(url).toBe("https://boss.example.test/v1/reports");
  });

  it("refuses a plain-http or garbage URL as 'misconfigured' without sending the key", async () => {
    let called = false;
    const fetch = (async () => { called = true; return json([]); }) as typeof globalThis.fetch;
    for (const BOSS_API_URL of ["http://boss.example.test", "not a url", "javascript:alert(1)"]) {
      expect(await readReports({ env: { ...env, BOSS_API_URL }, fetch })).toEqual({ status: "unavailable", reason: "misconfigured" });
    }
    expect(called).toBe(false);
  });

  it("allows http only for localhost, for development", async () => {
    const fetch = (async () => json([])) as typeof globalThis.fetch;
    expect((await readReports({ env: { ...env, BOSS_API_URL: "http://localhost:8080" }, fetch })).status).toBe("ok");
  });

  it("fails closed to 'unavailable' on a timeout", async () => {
    const fetch = ((_u: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch, timeoutMs: 20 })).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("fails closed on a network error, without throwing", async () => {
    const fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch })).toEqual({ status: "unavailable", reason: "network" });
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "http_error"],
    [500, "http_error"],
    [503, "http_error"],
  ])("fails closed on HTTP %i", async (status, reason) => {
    const fetch = (async () => json({ error: "nope" }, { status })) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch })).toEqual({ status: "unavailable", reason });
  });

  it("fails closed on a body that is not JSON", async () => {
    const fetch = (async () => new Response("<html>gateway</html>", { status: 200 })) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch })).toEqual({ status: "unavailable", reason: "malformed" });
  });

  it("fails closed on JSON that has the wrong shape", async () => {
    const fetch = (async () => json({ reports: [row({ health: "great" })] })) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch })).toEqual({ status: "unavailable", reason: "malformed" });
  });

  it("fails closed on an oversized body", async () => {
    const fetch = (async () => new Response("x".repeat(600_000), { status: 200 })) as typeof globalThis.fetch;
    expect(await readReports({ env, fetch })).toEqual({ status: "unavailable", reason: "too_large" });
  });

  it("never puts the key, or anything BOSS sent, into the result", async () => {
    const fetch = (async () => json({ error: `bad key ${KEY}`, detail: "<script>alert(1)</script>" }, { status: 500 })) as typeof globalThis.fetch;
    expect(JSON.stringify(await readReports({ env, fetch }))).not.toContain(KEY);
    expect(JSON.stringify(await readReports({ env, fetch }))).not.toContain("script");
  });
});
