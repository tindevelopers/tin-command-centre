import { describe, expect, it } from "vitest";
import { canRevoke, describeCredentialsFailure, describeRevokeFailure, listCredentials, otherActive, parseCredential, revokeCredential, validateRevoke } from "./credentials";
import type { BossCredential } from "./credentials";

const env = { BOSS_API_URL: "https://boss.example.com", BOSS_CREDENTIALS_KEY: "console_creds_key" };
const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const PAW = "urn:tin:pawpointers:production";

const wire = (over: Record<string, unknown> = {}) => ({
  id: OLD,
  name: "pawpointers-production",
  identity: PAW,
  scopes: ["boss.reports.write"],
  status: "active",
  createdAt: "2026-10-27T22:29:39.567Z",
  lastUsedAt: "2026-10-27T22:29:44.072Z",
  revokedAt: null,
  ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchWith = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
    const url = u instanceof URL ? u : new URL(String(u));
    calls.push({ url, init: init! });
    return handler(url, init!);
  }) as typeof fetch;
  return { f, calls };
};
const cred = (over: Partial<BossCredential> = {}): BossCredential => ({
  id: OLD, name: "pawpointers-production", identity: PAW, scopes: ["boss.reports.write"], status: "active",
  createdAt: new Date("2026-10-27T22:29:39Z"), lastUsedAt: null, revokedAt: null, ...over,
});

describe("listCredentials", () => {
  it("sends the credentials key and the bearer, asks for one identity, and returns plain parsed data", async () => {
    const { f, calls } = fetchWith(() => json(200, { credentials: [wire()], truncated: false }));
    const r = await listCredentials("jwt.token.here", { platform: "pawpointers", environment: "production" }, { env, fetch: f });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.truncated).toBe(false);
    expect(r.credentials).toEqual([cred({ lastUsedAt: new Date("2026-10-27T22:29:44.072Z"), createdAt: new Date("2026-10-27T22:29:39.567Z") })]);
    expect(calls[0].url.pathname).toBe("/v1/credentials");
    expect(calls[0].url.searchParams.get("platform")).toBe("pawpointers");
    expect(calls[0].url.searchParams.get("environment")).toBe("production");
    expect(calls[0].url.searchParams.get("limit")).toBe("200");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("console_creds_key");
    expect(h.authorization).toBe("Bearer jwt.token.here");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.method).toBe("GET");
  });

  it("lists across identities when no filter is given", async () => {
    const { f, calls } = fetchWith(() => json(200, { credentials: [], truncated: false }));
    await listCredentials("t", {}, { env, fetch: f });
    expect(calls[0].url.searchParams.has("platform")).toBe(false);
  });

  it("says what is missing and refuses a bad filter before calling BOSS", async () => {
    const { f, calls } = fetchWith(() => json(200, { credentials: [], truncated: false }));
    expect(await listCredentials("t", {}, { env: {}, fetch: f })).toEqual({ status: "unconfigured", missing: ["BOSS_API_URL", "BOSS_CREDENTIALS_KEY"] });
    expect(await listCredentials(null, {}, { env, fetch: f })).toEqual({ status: "no-operator-token" });
    expect(await listCredentials("t", { platform: "pawpointers" }, { env, fetch: f })).toMatchObject({ status: "invalid" });
    expect(await listCredentials("t", { platform: "Paw Pointers", environment: "production" }, { env, fetch: f })).toMatchObject({ status: "invalid" });
    expect(await listCredentials("t", { platform: "pawpointers", environment: "live" }, { env, fetch: f })).toMatchObject({ status: "invalid" });
    expect(await listCredentials("t", {}, { env: { ...env, BOSS_API_URL: "http://boss.example.com" }, fetch: f })).toEqual({ status: "unavailable", reason: "misconfigured" });
    expect(calls).toHaveLength(0);
  });

  it("maps refusals and faults to fixed reasons and never passes BOSS's text through", async () => {
    const r = async (status: number, body?: unknown) => listCredentials("t", {}, { env, fetch: fetchWith(() => json(status, body ?? {})).f });
    expect(await r(401, { detail: "<script>" })).toEqual({ status: "unavailable", reason: "unauthorized" });
    expect(await r(403)).toEqual({ status: "unavailable", reason: "forbidden" });
    expect(await r(404)).toEqual({ status: "unavailable", reason: "forbidden" });
    expect(await r(500)).toEqual({ status: "unavailable", reason: "http_error" });
    expect(await r(503)).toEqual({ status: "unavailable", reason: "http_error" });
    const timeout = await listCredentials("t", {}, { env, fetch: (async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }) as typeof fetch });
    const network = await listCredentials("t", {}, { env, fetch: (async () => { throw new Error("secret-host"); }) as typeof fetch });
    expect(timeout).toEqual({ status: "unavailable", reason: "timeout" });
    expect(network).toEqual({ status: "unavailable", reason: "network" });
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["no credentials array", () => json(200, { truncated: false })],
    ["no truncated flag", () => json(200, { credentials: [] })],
    ["a row with a bad id", () => json(200, { credentials: [wire({ id: "kn_live_abcdef" })], truncated: false })],
    ["a row with an unknown status", () => json(200, { credentials: [wire({ status: "deleted" })], truncated: false })],
    ["a row with an identity that is not a platform identity", () => json(200, { credentials: [wire({ identity: "javascript:alert(1)" })], truncated: false })],
    ["a row with a scope that has markup", () => json(200, { credentials: [wire({ scopes: ["<b>x</b>"] })], truncated: false })],
    ["a row with a malformed date", () => json(200, { credentials: [wire({ createdAt: "yesterday" })], truncated: false })],
    ["more than 200 rows", () => json(200, { credentials: Array.from({ length: 201 }, () => wire()), truncated: true })],
  ])("treats %s as malformed and shows nothing", async (_label, make) => {
    expect(await listCredentials("t", {}, { env, fetch: fetchWith(make).f })).toEqual({ status: "unavailable", reason: "malformed" });
  });

  it("refuses a response body that is too large", async () => {
    const big = () => new Response(" ".repeat(300 * 1024), { status: 200 });
    expect(await listCredentials("t", {}, { env, fetch: fetchWith(big).f })).toEqual({ status: "unavailable", reason: "too_large" });
  });
});

describe("parseCredential", () => {
  it("keeps only the known fields, so a stray digest or public id can never reach the page", () => {
    const parsed = parseCredential(wire({ digest: "abc", publicId: "kn_live_x", kid: "k1" }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual(["createdAt", "id", "identity", "lastUsedAt", "name", "revokedAt", "scopes", "status"]);
  });
  it("accepts a key with no identity and a revoked key with its date", () => {
    expect(parseCredential(wire({ identity: null }))?.identity).toBeNull();
    expect(parseCredential(wire({ status: "revoked", revokedAt: "2026-10-27T22:34:34.083Z" }))?.revokedAt).toEqual(new Date("2026-10-27T22:34:34.083Z"));
  });
});

describe("validateRevoke", () => {
  it("mirrors BOSS's shape", () => {
    expect(validateRevoke({ id: OLD, identity: PAW })).toBeNull();
    expect(validateRevoke({ id: "kn_live_abc", identity: PAW })).toMatch(/id/);
    expect(validateRevoke({ id: OLD, identity: "pawpointers" })).toMatch(/identity/);
    expect(validateRevoke({ id: OLD, identity: "urn:tin:pawpointers:live" })).toMatch(/identity/);
    expect(validateRevoke({ id: OLD, identity: PAW, reason: "a;drop" })).toMatch(/reason/);
  });
});

describe("revokeCredential", () => {
  const ok = () => json(200, { id: OLD, status: "revoked" });

  it("posts the identity to the key's own revoke route with both credentials and nothing else", async () => {
    const { f, calls } = fetchWith(ok);
    expect(await revokeCredential({ id: OLD, identity: PAW }, "jwt.token.here", { env, fetch: f })).toEqual({ status: "ok", id: OLD });
    expect(calls[0].url.toString()).toBe(`https://boss.example.com/v1/credentials/${OLD}/revoke`);
    expect(calls[0].init.method).toBe("POST");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("console_creds_key");
    expect(h.authorization).toBe("Bearer jwt.token.here");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ identity: PAW });
    expect(calls[0].init.redirect).toBe("error");
  });

  it("sends allowLast only when asked, and the reason when given", async () => {
    const { f, calls } = fetchWith(ok);
    await revokeCredential({ id: OLD, identity: PAW, reason: "key lost", allowLast: true }, "t", { env, fetch: f });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ identity: PAW, reason: "key lost", allowLast: true });
  });

  it("says what is missing and refuses a bad request before calling BOSS", async () => {
    const { f, calls } = fetchWith(ok);
    expect(await revokeCredential({ id: OLD, identity: PAW }, "t", { env: {}, fetch: f })).toEqual({ status: "unconfigured", missing: ["BOSS_API_URL", "BOSS_CREDENTIALS_KEY"] });
    expect(await revokeCredential({ id: OLD, identity: PAW }, null, { env, fetch: f })).toEqual({ status: "no-operator-token" });
    expect(await revokeCredential({ id: "../x", identity: PAW }, "t", { env, fetch: f })).toMatchObject({ status: "invalid" });
    expect(await revokeCredential({ id: OLD, identity: PAW }, "t", { env: { ...env, BOSS_API_URL: "http://boss.example.com" }, fetch: f })).toEqual({ status: "failed", reason: "misconfigured" });
    expect(calls).toHaveLength(0);
  });

  it("maps BOSS's answers to fixed reasons", async () => {
    const r = async (status: number, body?: unknown) => revokeCredential({ id: OLD, identity: PAW }, "t", { env, fetch: fetchWith(() => json(status, body ?? {})).f });
    expect(await r(401)).toEqual({ status: "failed", reason: "unauthorized" });
    expect(await r(403)).toEqual({ status: "failed", reason: "forbidden" });
    expect(await r(404)).toEqual({ status: "failed", reason: "not_found" });
    expect(await r(400)).toEqual({ status: "failed", reason: "rejected" });
    expect(await r(503)).toEqual({ status: "failed", reason: "http_error" });
    expect(await r(409, { detail: "The credential is not active." })).toEqual({ status: "failed", reason: "not_active" });
    expect(await r(409, { detail: "The credential is its identity's only active key; confirm to revoke it anyway." })).toEqual({ status: "failed", reason: "last_active" });
    expect(await r(409, { detail: "A credential cannot revoke itself." })).toEqual({ status: "failed", reason: "own_credential" });
    expect(await r(409, { detail: "something new" })).toEqual({ status: "failed", reason: "http_error" });
  });

  it("does not report success unless the body names the same key as revoked", async () => {
    const r = async (body: unknown) => revokeCredential({ id: OLD, identity: PAW }, "t", { env, fetch: fetchWith(() => json(200, body)).f });
    expect(await r({ id: NEW, status: "revoked" })).toEqual({ status: "failed", reason: "malformed" });
    expect(await r({ id: OLD, status: "active" })).toEqual({ status: "failed", reason: "malformed" });
    expect(await r({})).toEqual({ status: "failed", reason: "malformed" });
    expect(await revokeCredential({ id: OLD, identity: PAW }, "t", { env, fetch: fetchWith(() => new Response("nope", { status: 200 })).f })).toEqual({ status: "failed", reason: "malformed" });
  });

  it("treats a timeout and a network fault as such, with no text from the cause", async () => {
    const timeout = await revokeCredential({ id: OLD, identity: PAW }, "t", { env, fetch: (async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); }) as typeof fetch });
    const network = await revokeCredential({ id: OLD, identity: PAW }, "t", { env, fetch: (async () => { throw new Error("password=hunter2"); }) as typeof fetch });
    expect(timeout).toEqual({ status: "failed", reason: "timeout" });
    expect(network).toEqual({ status: "failed", reason: "network" });
    expect(JSON.stringify(network)).not.toContain("hunter2");
  });
});

describe("page helpers", () => {
  it("counts the other active keys of the same identity only", () => {
    const a = cred();
    expect(otherActive([a], a)).toBe(0);
    expect(otherActive([a, cred({ id: NEW })], a)).toBe(1);
    expect(otherActive([a, cred({ id: NEW, status: "revoked" })], a)).toBe(0);
    expect(otherActive([a, cred({ id: NEW, status: "disabled" })], a)).toBe(0);
    expect(otherActive([a, cred({ id: NEW, identity: "urn:tin:console:production" })], a)).toBe(0);
  });
  it("lets a key be revoked until it is revoked", () => {
    expect(canRevoke(cred())).toBe(true);
    expect(canRevoke(cred({ status: "disabled" }))).toBe(true);
    expect(canRevoke(cred({ status: "revoked" }))).toBe(false);
  });
  it("describes every failure with fixed text and no secrets", () => {
    const all = [
      describeCredentialsFailure({ status: "unconfigured", missing: ["BOSS_CREDENTIALS_KEY"] }),
      describeCredentialsFailure({ status: "no-operator-token" }),
      describeCredentialsFailure({ status: "unavailable", reason: "forbidden" }),
      describeRevokeFailure({ status: "failed", reason: "last_active" }),
      describeRevokeFailure({ status: "failed", reason: "own_credential" }),
      describeRevokeFailure({ status: "invalid", reason: "the key id is not valid." }),
    ];
    for (const text of all) expect(text.length).toBeGreaterThan(10);
    expect(all.join(" ")).not.toMatch(/console_creds_key|jwt/);
  });
});
