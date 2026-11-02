import { describe, expect, it } from "vitest";
import { commandItems, stateLabel } from "./command";

const all = { collectConfigured: true, agentConfigured: true, registryWritable: true };
const states = (o: Parameters<typeof commandItems>[0]) => Object.fromEntries(commandItems(o).map((i) => [i.id, i.state]));

describe("commandItems", () => {
  it("an admin with everything configured has every action live", () => {
    expect(states({ isAdmin: true, ...all })).toEqual({ registry: "live", collect: "live", agent: "live", autonomy: "live", access: "live", next: "next" });
  });
  it("a viewer sees the actions as admin-only, whatever is configured; the read-only item stays live", () => {
    expect(states({ isAdmin: false, ...all })).toEqual({ registry: "admin", collect: "admin", agent: "admin", autonomy: "live", access: "admin", next: "next" });
  });
  it("an admin sees which actions still need their setting", () => {
    expect(states({ isAdmin: true, collectConfigured: false, agentConfigured: true, registryWritable: false })).toEqual({ registry: "setup", collect: "setup", agent: "live", autonomy: "live", access: "setup", next: "next" });
  });
  it("labels", () => {
    expect(["live", "admin", "setup", "next"].map((s) => stateLabel(s as never))).toEqual(["LIVE", "ADMIN", "SETUP", "NEXT"]);
  });
});
