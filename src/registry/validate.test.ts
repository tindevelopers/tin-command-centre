import { describe, expect, it } from "vitest";
import { ValidationError, parseCommand } from "./validate";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const bad = (type: Parameters<typeof parseCommand>[0], o: Record<string, string>) => {
  try { parseCommand(type, form(o)); } catch (e) { return e; }
  return null;
};

describe("parseCommand", () => {
  it("parses a project and trims, with blank optionals as null", () => {
    expect(parseCommand("upsertProject", form({ slug: "konnect", name: " Konnect ", kind: "app", lifecycle: "active", client: "", repo: "tindevelopers/konnect-caas-base" })))
      .toEqual({ type: "upsertProject", slug: "konnect", name: "Konnect", kind: "app", client: null, repo: "tindevelopers/konnect-caas-base", lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null });
  });

  it.each([
    ["upsertProject", { slug: "Bad Slug", name: "x", kind: "app", lifecycle: "active" }],
    ["upsertProject", { slug: "ok", name: "", kind: "app", lifecycle: "active" }],
    ["upsertProject", { slug: "ok", name: "x", kind: "wizard", lifecycle: "active" }],
    ["upsertProject", { slug: "ok", name: "x", kind: "app", lifecycle: "dead" }],
    ["upsertEnvironment", { slug: "ok", name: "qa" }],
    ["upsertEnvironment", { slug: "ok", name: "production", url: "http://insecure" }],
    ["setPin", { slug: "ok", environment: "production", package: "p", version: "^1.2.0" }],
    ["setPin", { slug: "ok", environment: "production", package: "p", version: "1.2" }],
    ["setAdoption", { slug: "ok", environment: "production", domainMode: "yolo" }],
    ["assign", { slug: "ok", assignee: "not-an-email", role: "owner" }],
    ["assign", { slug: "ok", assignee: "a@tin.info", role: "boss" }],
    ["unassign", { slug: "ok", id: "1; drop table x" }],
    ["addRelation", { slug: "ok", to: "ok", relation: "depends_on" }],
    ["addRelation", { slug: "ok", to: "other", relation: "consumes" }],
    ["upsertProject", { slug: "ok", name: "x", kind: "app", lifecycle: "active", tier: "sky" }],
  ] as const)("rejects invalid %s input", (type, o) => {
    expect(bad(type, o)).toBeInstanceOf(ValidationError);
  });

  it("accepts exact and prerelease versions", () => {
    for (const version of ["1.2.0", "1.2.0-next.4"]) {
      expect(parseCommand("setPin", form({ slug: "a", environment: "development", package: "p", version }))).toMatchObject({ version });
    }
  });

  it("reads an optional owning project and rejects a malformed one", () => {
    const base = { slug: "konnect-ops", name: "Konnect ops", kind: "app", lifecycle: "active" };
    expect(parseCommand("upsertProject", form({ ...base, ownerProject: "konnect-caas-base" }))).toMatchObject({ ownerProject: "konnect-caas-base" });
    expect(parseCommand("upsertProject", form({ ...base, ownerProject: "" }))).toMatchObject({ ownerProject: null });
    expect(bad("upsertProject", { ...base, ownerProject: "Not A Slug" })).toBeInstanceOf(ValidationError);
  });
  it("accepts a folder path in the repo and rejects anything that could escape it", () => {
    const base = { slug: "konnect-ops", name: "Konnect ops", kind: "app", lifecycle: "active" };
    expect(parseCommand("upsertProject", form({ ...base, path: " apps/ops/ " }))).toMatchObject({ path: "apps/ops" });
    expect(parseCommand("upsertProject", form({ ...base, path: "" }))).toMatchObject({ path: null });
    for (const p of ["/etc", "../x", "a/../b", "a b", "a//b", "apps/ops;rm"]) expect(bad("upsertProject", { ...base, path: p })).toBeInstanceOf(ValidationError);
  });

  it("reads an optional owning group and tier", () => {
    const base = { slug: "boss", name: "BOSS", kind: "boss", lifecycle: "active" };
    expect(parseCommand("upsertProject", form({ ...base, ownerGroup: "tin-platform", tier: "foundation" }))).toMatchObject({ ownerGroup: "tin-platform", tier: "foundation" });
    expect(parseCommand("upsertProject", form({ ...base, ownerGroup: "", tier: "" }))).toMatchObject({ ownerGroup: null, tier: null });
  });

  it("lower-cases assignee emails", () => {
    expect(parseCommand("assign", form({ slug: "a", assignee: "Gene@TIN.info", role: "owner" }))).toMatchObject({ assignee: "gene@tin.info" });
  });
});
