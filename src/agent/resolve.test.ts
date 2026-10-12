import { describe, expect, it, vi } from "vitest";
import { resolveTicketsForPin, type ResolveDeps } from "./resolve";

const P = { project: "konnect-ops", environment: "development", pkg: "@tindevelopers/adapter-kit", version: "1.12.2", actor: "a@tin.info" };

function deps(runs: { id: number; ticketId: string; ticketRef: string | null; toVersion: string }[], over: Partial<ResolveDeps> = {}) {
  const d = { openRuns: vi.fn(async () => runs), resolveTicket: vi.fn(async () => ({})), markResolved: vi.fn(async () => {}), ...over };
  return d as typeof d & ResolveDeps;
}

describe("resolveTicketsForPin", () => {
  it("resolves a ticket once the pin reaches its target, and stamps it", async () => {
    const d = deps([{ id: 1, ticketId: "t1", ticketRef: "PLT-0007", toVersion: "1.12.2" }]);
    expect(await resolveTicketsForPin(d, P)).toEqual({ resolved: ["PLT-0007"], errors: [] });
    expect(d.resolveTicket).toHaveBeenCalledWith("t1", "Declared pin for konnect-ops (development) set to @tindevelopers/adapter-kit 1.12.2 in the TIN ops console by a@tin.info.");
    expect(d.markResolved).toHaveBeenCalledWith([1], "a@tin.info");
  });
  it("resolves when the pin goes past the target too", async () => {
    const d = deps([{ id: 1, ticketId: "t1", ticketRef: null, toVersion: "1.12.0" }]);
    expect((await resolveTicketsForPin(d, P)).resolved).toEqual(["t1"]);
  });
  it("leaves a ticket open when the pin moved but fell short of the target", async () => {
    const d = deps([{ id: 1, ticketId: "t1", ticketRef: "PLT-0007", toVersion: "1.13.0" }]);
    expect(await resolveTicketsForPin(d, P)).toEqual({ resolved: [], errors: [] });
    expect(d.resolveTicket).not.toHaveBeenCalled();
    expect(d.markResolved).not.toHaveBeenCalled();
  });
  it("does nothing when there are no open tickets for the pin or the version is not exact", async () => {
    expect(await resolveTicketsForPin(deps([]), P)).toEqual({ resolved: [], errors: [] });
    const d = deps([{ id: 1, ticketId: "t1", ticketRef: null, toVersion: "1.0.0" }]);
    expect(await resolveTicketsForPin(d, { ...P, version: "^1.0.0" })).toEqual({ resolved: [], errors: [] });
    expect(d.openRuns).not.toHaveBeenCalled();
  });
  it("one refused ticket never blocks another, and only the resolved ones are stamped", async () => {
    const d = deps(
      [{ id: 1, ticketId: "t1", ticketRef: "PLT-1", toVersion: "1.12.2" }, { id: 2, ticketId: "t2", ticketRef: "PLT-2", toVersion: "1.12.2" }],
      { resolveTicket: vi.fn(async (id: string) => { if (id === "t1") throw new Error("Care hub answered 409: escalations waiting"); }) },
    );
    expect(await resolveTicketsForPin(d, P)).toEqual({ resolved: ["PLT-2"], errors: ["PLT-1: Care hub answered 409: escalations waiting"] });
    expect(d.markResolved).toHaveBeenCalledWith([2], "a@tin.info");
  });
});
