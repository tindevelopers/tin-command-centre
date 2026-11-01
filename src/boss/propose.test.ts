import { describe, expect, it } from "vitest";
import { describeProposeFailure, sendProposal, validateProposal, type ProposeResult } from "./propose";

const env = { BOSS_API_URL: "https://boss.example.com", BOSS_OPERATOR_KEY: "op_secret_key" };
const input = { platform: "konnect", pins: ["@tindevelopers/api-mcp@1.0.1", "@tindevelopers/domain-support@6.0.1"] };
const reply = (status: number, body: unknown = { id: "pp_1" }) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchWith = (handler: (url: URL, init: RequestInit) => Response | Promise<Response>) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
    const url = u instanceof URL ? u : new URL(String(u));
    calls.push({ url, init: init! });
    return handler(url, init!);
  }) as typeof fetch;
  return { f, calls };
};

describe("validateProposal", () => {
  it("mirrors BOSS's shape", () => {
    expect(validateProposal(input)).toBeNull();
    expect(validateProposal({ platform: "Bad", pins: input.pins })).toMatch(/platform/);
    expect(validateProposal({ platform: "konnect", pins: [] })).toMatch(/no pins/);
    expect(validateProposal({ platform: "konnect", pins: Array.from({ length: 11 }, (_, i) => `@tindevelopers/p${i}@1.0.0`) })).toMatch(/at most 10/);
    expect(validateProposal({ platform: "konnect", pins: [input.pins[0], input.pins[0]] })).toMatch(/repeated/);
    expect(validateProposal({ platform: "konnect", pins: ["@other/x@1.0.0"] })).toMatch(/hub package/);
  });
});

describe("sendProposal", () => {
  it("posts the operator key and the bearer to /v1/pin-proposals and returns BOSS's id", async () => {
    const { f, calls } = fetchWith(() => reply(201));
    expect(await sendProposal(input, "jwt.token.here", { env, fetch: f })).toEqual({ status: "ok", id: "pp_1" });
    expect(calls[0].url.toString()).toBe("https://boss.example.com/v1/pin-proposals");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("op_secret_key");
    expect(h.authorization).toBe("Bearer jwt.token.here");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ platform: "konnect", pins: input.pins });
    expect(calls[0].init.redirect).toBe("error");
  });
  it("says what is missing before sending anything", async () => {
    const { f, calls } = fetchWith(() => reply(201));
    expect(await sendProposal(input, "t", { env: {}, fetch: f })).toEqual({ status: "unconfigured", missing: ["BOSS_API_URL", "BOSS_OPERATOR_KEY"] });
    expect(await sendProposal(input, null, { env, fetch: f })).toEqual({ status: "no-operator-token" });
    expect(await sendProposal({ platform: "konnect", pins: [] }, "t", { env, fetch: f })).toMatchObject({ status: "invalid" });
    expect(await sendProposal(input, "t", { env: { ...env, BOSS_API_URL: "http://boss.example.com" }, fetch: f })).toEqual({ status: "failed", reason: "misconfigured" });
    expect(calls).toHaveLength(0);
  });
  it("maps BOSS's refusals to fixed reasons and never passes its text through", async () => {
    const r = async (status: number, body?: unknown) => sendProposal(input, "t", { env, fetch: fetchWith(() => reply(status, body)).f });
    expect(await r(401, { detail: "<script>" })).toEqual({ status: "failed", reason: "unauthorized" });
    expect(await r(403)).toEqual({ status: "failed", reason: "forbidden" });
    expect(await r(400)).toEqual({ status: "failed", reason: "rejected" });
    expect(await r(500)).toEqual({ status: "failed", reason: "http_error" });
    expect(await r(201, { id: "<img src=x>" })).toEqual({ status: "failed", reason: "malformed" });
    expect(await r(201, "not json object")).toEqual({ status: "failed", reason: "malformed" });
    const failures: Exclude<ProposeResult, { status: "ok" }>[] = [{ status: "failed", reason: "unauthorized" }, { status: "failed", reason: "rejected" }, { status: "no-operator-token" }, { status: "unconfigured", missing: ["BOSS_OPERATOR_KEY"] }];
    for (const res of failures) {
      expect(describeProposeFailure(res)).not.toContain("<");
    }
  });
  it("a timeout or network failure is reported as such", async () => {
    const timeout = fetchWith(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    expect(await sendProposal(input, "t", { env, fetch: timeout.f })).toEqual({ status: "failed", reason: "timeout" });
    const network = fetchWith(() => { throw new TypeError("fetch failed"); });
    expect(await sendProposal(input, "t", { env, fetch: network.f })).toEqual({ status: "failed", reason: "network" });
  });
});
