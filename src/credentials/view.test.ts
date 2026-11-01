import { describe, expect, it } from "vitest";
import type { KeyRecord } from "./port";
import { checkScopes, filterIdentityRows, holderOf, identityOf, identityRows, keyRows, keyTotals, parseKeyFilters } from "./view";

const key = (over: Partial<KeyRecord> = {}): KeyRecord => ({
  cell: "tin-boss-api-tin-production", publicId: "k_pp1", platform: "pawpointers", environment: "production", status: "active",
  scopes: ["boss.reports.write", "boss.pins.read"], lastUsedAt: new Date("2026-10-31T10:00:00Z"), ...over,
});

describe("holderOf and identityOf", () => {
  it("classifies by platform, and splits the console's two keys by the reports.read scope", () => {
    expect(holderOf(key())).toBe("platform");
    expect(holderOf(key({ platform: "tin", scopes: ["boss.session.issue"] }))).toBe("tin-hub");
    expect(holderOf(key({ platform: "console", scopes: ["boss.reports.read"] }))).toBe("console-reader");
    expect(holderOf(key({ platform: "console", scopes: ["boss.pins.write"] }))).toBe("console-operator");
    expect(identityOf("konnect", "development")).toBe("urn:tin:konnect:development");
  });
});

describe("checkScopes mirrors the minting script", () => {
  it("a platform key is any non-empty subset of the platform scopes", () => {
    expect(checkScopes("platform", ["boss.reports.write"])).toEqual({ ok: true });
    expect(checkScopes("platform", ["boss.reports.write", "boss.pins.read", "boss.knowledge.releases.read"])).toEqual({ ok: true });
    expect(checkScopes("platform", ["boss.reports.read"]).ok).toBe(false);
    expect(checkScopes("platform", [])).toMatchObject({ ok: false, reason: "No scopes." });
  });
  it("the reader is exactly reports.read and never mixed with writes", () => {
    expect(checkScopes("console-reader", ["boss.reports.read"])).toEqual({ ok: true });
    expect(checkScopes("console-reader", ["boss.reports.read", "boss.pins.write"])).toMatchObject({ ok: false, reason: /may not hold boss\.pins\.write/ });
  });
  it("the hub takes exactly session.issue; unknown and duplicate scopes are refused", () => {
    expect(checkScopes("tin-hub", ["boss.session.issue"])).toEqual({ ok: true });
    expect(checkScopes("tin-hub", ["boss.session.issue", "boss.pins.read"]).ok).toBe(false);
    expect(checkScopes("platform", ["boss.made.up"])).toMatchObject({ ok: false, reason: /Unknown scope/ });
    expect(checkScopes("platform", ["boss.pins.read", "boss.pins.read"])).toMatchObject({ ok: false, reason: /Duplicate/ });
  });
});

describe("identityRows", () => {
  const keys = [
    key(),
    key({ publicId: "k_pp2", lastUsedAt: null, scopes: ["boss.knowledge.releases.read"] }),
    key({ publicId: "k_pp0", status: "revoked", lastUsedAt: null }),
    key({ publicId: "k_c1", platform: "console", environment: "production", scopes: ["boss.reports.read", "boss.pins.write"] }),
    key({ publicId: "k_k1", platform: "konnect", environment: "development", lastUsedAt: null }),
  ];
  const projects = [{ slug: "pawpointers-dashboard", client: "pawpointers", lifecycle: "active" }, { slug: "old", client: "pawpointers", lifecycle: "retired" }, { slug: "konnect-app", client: "konnect", lifecycle: "active" }];
  const rows = identityRows(keys, projects);
  const row = (id: string) => rows.find((r) => r.identity === id)!;

  it("groups keys by platform environment with the union of active scopes and the newest use", () => {
    const pp = row("urn:tin:pawpointers:production");
    expect(pp).toMatchObject({ holder: "platform", active: 2, projects: ["pawpointers-dashboard"] });
    expect(pp.keys).toHaveLength(3);
    expect(pp.scopes).toEqual(["boss.knowledge.releases.read", "boss.pins.read", "boss.reports.write"]);
    expect(pp.lastUsedAt?.toISOString()).toBe("2026-10-31T10:00:00.000Z");
  });
  it("a never-used active key makes the identity amber; a key outside its rule makes it red; revoked keys do not count", () => {
    expect(row("urn:tin:pawpointers:production").colour).toBe("amber");
    expect(row("urn:tin:konnect:development").colour).toBe("amber");
    const console = row("urn:tin:console:production");
    expect(console).toMatchObject({ holder: "console-reader", colour: "red" });
    expect(console.keys[0].check).toMatchObject({ ok: false, reason: /may not hold boss\.pins\.write/ });
    expect(keyRows([key({ status: "revoked", scopes: ["boss.reports.read"] })])[0].colour).toBe("green");
  });
  it("orders worst first", () => {
    expect(rows.map((r) => r.colour)).toEqual(["red", "amber", "amber"]);
  });
  it("totals", () => {
    expect(keyTotals(rows)).toEqual({ identities: 3, keys: 5, active: 4, neverUsed: 2, outsideRule: 1, platforms: 2 });
  });
  it("filters by holder, status and text; parses only what it recognises", () => {
    expect(parseKeyFilters({ holder: "platform", status: "active", q: " x " })).toEqual({ holder: "platform", status: "active", q: "x" });
    expect(parseKeyFilters({ holder: "nope", status: "nope" })).toEqual({ holder: "", status: "", q: "" });
    expect(filterIdentityRows(rows, { holder: "console-reader", status: "", q: "" }).map((r) => r.platform)).toEqual(["console"]);
    expect(filterIdentityRows(rows, { holder: "", status: "other", q: "" }).map((r) => r.platform)).toEqual(["pawpointers"]);
    expect(filterIdentityRows(rows, { holder: "", status: "", q: "k_k1" }).map((r) => r.platform)).toEqual(["konnect"]);
    expect(filterIdentityRows(rows, { holder: "", status: "", q: "releases.read" }).map((r) => r.platform)).toEqual(["pawpointers"]);
  });
  it("no keys, no rows", () => {
    expect(identityRows([])).toEqual([]);
    expect(keyTotals([])).toMatchObject({ identities: 0, keys: 0 });
  });
});
