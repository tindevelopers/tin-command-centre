import { describe, expect, it, vi } from "vitest";
import { dispatchPin, type DispatchDeps, type DispatchInput } from "./dispatch";

const input: DispatchInput = {
  repo: "tindevelopers/konnect-caas-base", path: "apps/ops", project: "konnect-ops", environment: "development", pkg: "@tindevelopers/adapter-kit",
  declared: "1.9.1", latest: "1.12.2", observedAt: new Date("2026-10-06T07:35:00Z"), packageRepo: "tindevelopers/shared-integration-hub",
  origin: "https://console.tinconnect.com", alsoBehind: [], requestedBy: "a@tin.info",
};
const TICKET = { id: "22222222-2222-4222-8222-222222222222", number: "PLT-0007", status: "open" };

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps & { order: string[] } {
  const order: string[] = [];
  const d: DispatchDeps = {
    readRepoPin: vi.fn(async () => ({ status: "found" as const, versions: ["1.9.1"], file: "apps/ops/package.json" })),
    findOpenIssue: vi.fn(async () => null),
    createIssue: vi.fn(async () => { order.push("issue"); return { url: "https://github.com/o/r/issues/9", number: 9 }; }),
    commentOnIssue: vi.fn(async () => { order.push("marker"); }),
    createTicket: vi.fn(async () => { order.push("ticket"); return TICKET; }),
    recordRun: vi.fn(async () => { order.push("record"); }),
    ...over,
  };
  return Object.assign(d, { order });
}

describe("dispatchPin", () => {
  it("creates the issue, then the ticket, then marks the issue with it, then records the run, in that order", async () => {
    const d = deps();
    const out = await dispatchPin(d, input);
    expect(out).toEqual({ kind: "created", issueUrl: "https://github.com/o/r/issues/9", ticket: TICKET, warnings: [] });
    expect(d.order).toEqual(["issue", "ticket", "marker", "record"]);
    expect((d.commentOnIssue as any).mock.calls[0]).toEqual(["tindevelopers/konnect-caas-base", 9, expect.stringContaining("<!-- care-hub-ticket id=22222222-2222-4222-8222-222222222222 number=PLT-0007 -->")]);
    expect((d.recordRun as any).mock.calls[0][0]).toMatchObject({ fromVersion: "1.9.1", toVersion: "1.12.2", ticketId: TICKET.id, ticketRef: "PLT-0007", issueUrl: "https://github.com/o/r/issues/9" });
  });

  it("refuses, and creates nothing, when the repo already has the latest version", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => ({ status: "found" as const, versions: ["1.12.2"], file: "apps/ops/package.json" })) });
    const out = await dispatchPin(d, input);
    expect(out.kind).toBe("refused");
    expect((out as any).reason).toContain("already pins @tindevelopers/adapter-kit 1.12.2");
    expect((out as any).reason).toContain("The registry says 1.9.1");
    for (const fn of [d.findOpenIssue, d.createIssue, d.commentOnIssue, d.recordRun]) expect(fn).not.toHaveBeenCalled();
    expect(d.createTicket).not.toHaveBeenCalled();
  });
  it("refuses when the repo is ahead of the latest published version", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => ({ status: "found" as const, versions: ["1.13.0"], file: "f" })) });
    expect((await dispatchPin(d, input)).kind).toBe("refused");
  });
  it("does not refuse a half-upgraded app: the lowest pin counts", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => ({ status: "found" as const, versions: ["1.12.2", "1.9.1"], file: "f" })) });
    expect((await dispatchPin(d, input)).kind).toBe("created");
  });

  it("starts from the repo's version when it differs from the registry, and says so", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => ({ status: "found" as const, versions: ["1.10.0"], file: "f" })) });
    const out = await dispatchPin(d, input);
    expect(out).toMatchObject({ kind: "created", warnings: ["The repo pins 1.10.0 but the registry declares 1.9.1; the registry needs correcting too."] });
    expect((d.createIssue as any).mock.calls[0][0].title).toBe("Upgrade @tindevelopers/adapter-kit 1.10.0 to 1.12.2 (konnect-ops, development)");
    // The marker on Drift is keyed to the registry's pin, so the run records what the registry declares.
    expect((d.recordRun as any).mock.calls[0][0].fromVersion).toBe("1.9.1");
  });
  it("proceeds, with a warning, when the repo cannot be checked", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => ({ status: "unverified" as const, reason: "the token cannot read repository contents (it needs Contents: read)" })) });
    const out = await dispatchPin(d, input);
    expect(out).toMatchObject({ kind: "created" });
    expect((out as any).warnings[0]).toContain("Not checked against the repo (the token cannot read repository contents");
    expect((d.createIssue as any).mock.calls[0][0].body).toContain("Could not be checked against the repo");
  });
  it("treats a throwing repo read as unverified rather than failing the click", async () => {
    const d = deps({ readRepoPin: vi.fn(async () => { throw new Error("boom"); }) });
    expect((await dispatchPin(d, input)).kind).toBe("created");
  });

  it("links to an open issue for the same upgrade instead of creating another", async () => {
    const d = deps({ findOpenIssue: vi.fn(async () => "https://github.com/o/r/issues/3") });
    expect(await dispatchPin(d, input)).toEqual({ kind: "existing", issueUrl: "https://github.com/o/r/issues/3" });
    expect(d.createIssue).not.toHaveBeenCalled();
    expect(d.createTicket).not.toHaveBeenCalled();
  });
  it("creates the issue anyway if the duplicate check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ findOpenIssue: vi.fn(async () => { throw new Error("422"); }) });
    expect((await dispatchPin(d, input)).kind).toBe("created");
  });

  it("keeps the issue when the ticket cannot be created, and says the issue is the only record", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ createTicket: vi.fn(async () => { throw new Error("Care hub answered 503: Support intake is not configured."); }) });
    const out = await dispatchPin(d, input);
    expect(out).toMatchObject({ kind: "created", ticket: null });
    expect((out as any).warnings[0]).toContain("The GitHub issue is the only record");
    expect(d.commentOnIssue).not.toHaveBeenCalled();
    expect((d.recordRun as any).mock.calls[0][0]).toMatchObject({ ticketId: null, ticketRef: null });
  });
  it("warns that PR progress will not reach a ticket whose marker could not be posted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ commentOnIssue: vi.fn(async () => { throw new Error("403"); }) });
    const out = await dispatchPin(d, input);
    expect((out as any).ticket).toEqual(TICKET);
    expect((out as any).warnings[0]).toContain("could not be linked on the issue");
  });
  it("works with no care hub configured: the issue alone is the ticket", async () => {
    const d = deps({ createTicket: null });
    expect(await dispatchPin(d, input)).toEqual({ kind: "created", issueUrl: "https://github.com/o/r/issues/9", ticket: null, warnings: [] });
    expect(d.commentOnIssue).not.toHaveBeenCalled();
  });
  it("warns, without failing, when the hand-off cannot be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ recordRun: vi.fn(async () => { throw new Error("db"); }) });
    const out = await dispatchPin(d, input);
    expect(out).toMatchObject({ kind: "created" });
    expect((out as any).warnings).toEqual(["The hand-off was not recorded, so Drift will not show it as in progress."]);
  });
  it("fails the click when the issue itself cannot be created (nothing else is attempted)", async () => {
    const d = deps({ createIssue: vi.fn(async () => { throw new Error("GitHub returned 404"); }) });
    await expect(dispatchPin(d, input)).rejects.toThrow("GitHub returned 404");
    expect(d.createTicket).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
  });
});
