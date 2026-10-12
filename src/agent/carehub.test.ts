import { afterEach, describe, expect, it, vi } from "vitest";
import { createCareHubTicket, resolveCareHubTicket } from "./carehub";

const cfg = { url: "https://ops.example.com/api/platform/support/intake", token: "s3cret" };
const ticketJson = { ok: true, ticket: { id: "22222222-2222-4222-8222-222222222222", ticket_number: "PLT-0007", status: "open" } };

describe("care hub client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: object) => {
    const m = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", m);
    return m;
  };

  it("creates a ticket with the bearer token and returns its id and number", async () => {
    const m = stub({ ok: true, status: 201, json: async () => ticketJson });
    const t = await createCareHubTicket({ subject: "Upgrade x", description: "d", priority: "high" }, cfg);
    expect(t).toEqual({ id: ticketJson.ticket.id, number: "PLT-0007", status: "open" });
    expect(m.mock.calls[0][0]).toBe(cfg.url);
    expect(m.mock.calls[0][1].headers.authorization).toBe("Bearer s3cret");
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ action: "create", subject: "Upgrade x", description: "d", priority: "high" });
  });
  it("resolves a ticket with a note", async () => {
    const m = stub({ ok: true, status: 200, json: async () => ({ ...ticketJson, ticket: { ...ticketJson.ticket, status: "resolved" } }) });
    expect((await resolveCareHubTicket({ ticketId: ticketJson.ticket.id, note: "done" }, cfg)).status).toBe("resolved");
    expect(JSON.parse(m.mock.calls[0][1].body)).toEqual({ action: "update", ticket_id: ticketJson.ticket.id, event: "resolved", note: "done" });
  });
  it("reports the care hub's own error, never the token", async () => {
    stub({ ok: false, status: 401, json: async () => ({ ok: false, error: "Unauthorized." }) });
    const err = (await createCareHubTicket({ subject: "x", description: "", priority: "low" }, cfg).catch((e) => e)) as Error;
    expect(err.message).toBe("Care hub answered 401: Unauthorized.");
    expect(err.message).not.toContain("s3cret");
  });
  it("survives a non-JSON error body", async () => {
    stub({ ok: false, status: 502, json: async () => { throw new Error("html"); } });
    await expect(createCareHubTicket({ subject: "x", description: "", priority: "low" }, cfg)).rejects.toThrow("Care hub answered 502.");
  });
  it("is not callable when unconfigured, and refuses to send the token over plain http", async () => {
    await expect(createCareHubTicket({ subject: "x", description: "", priority: "low" }, null)).rejects.toThrow(/not configured/);
    const m = stub({ ok: true, status: 201, json: async () => ticketJson });
    await expect(createCareHubTicket({ subject: "x", description: "", priority: "low" }, { url: "http://ops.example.com/x", token: "t" })).rejects.toThrow(/https/);
    expect(m).not.toHaveBeenCalled();
    await expect(createCareHubTicket({ subject: "x", description: "", priority: "low" }, { url: "http://localhost:3013/x", token: "t" })).resolves.toBeDefined();
  });
});
