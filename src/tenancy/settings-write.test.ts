import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/src/registry/validate";

const tenantWrite = vi.fn(async () => {});
vi.mock("./db", () => ({ tenantWrite: (...a: unknown[]) => (tenantWrite as (...x: unknown[]) => unknown)(...a) }));

import { parseSettingsForm, saveSettings } from "./settings-write";

const form = (fields: Record<string, string | string[]>) => {
  const m = new Map(Object.entries(fields));
  return { get: (k: string) => { const v = m.get(k); return Array.isArray(v) ? v[0] : v ?? null; }, getAll: (k: string) => { const v = m.get(k); return v === undefined ? [] : Array.isArray(v) ? v : [v]; } };
};
const ALL = ["projects", "packages", "cells", "drift", "keys", "boss", "automation", "collector", "settings"];

describe("parseSettingsForm", () => {
  it("accepts a full submission and lowercases the accent", () => {
    expect(parseSettingsForm(form({ brandName: " Implexus Ops ", accent: "#0A84FF", logoPath: "/images/logo/implexus.svg", module: ["projects", "drift"] }))).toEqual({
      brandName: "Implexus Ops", accent: "#0a84ff", logoPath: "/images/logo/implexus.svg", modules: ["projects", "drift"],
    });
  });
  it("blank fields are not set, and every optional module ticked means all (null)", () => {
    expect(parseSettingsForm(form({ module: ALL }))).toEqual({ brandName: null, accent: null, logoPath: null, modules: null });
  });
  it("no module ticked is an empty list: only the always-on modules remain", () => {
    expect(parseSettingsForm(form({})).modules).toEqual([]);
  });
  it("refuses a bad value with a sentence the admin can act on", () => {
    for (const bad of [{ brandName: "x".repeat(41) }, { brandName: "a\u0007b" }, { accent: "red" }, { accent: "#12345" }, { accent: "#12345g" },
      { logoPath: "https://evil.example/x.svg" }, { logoPath: "//evil.example/x.svg" }, { logoPath: "/a/../b.svg" }, { logoPath: "images/x.svg" }, { module: ["nonsense"] }] as Record<string, string | string[]>[]) {
      expect(() => parseSettingsForm(form(bad)), JSON.stringify(bad)).toThrow(ValidationError);
    }
  });
  it("accepts an always-on module id in the submission without storing it", () => {
    expect(parseSettingsForm(form({ module: ["overview", "projects"] })).modules).toEqual(["projects"]);
  });
});

describe("saveSettings", () => {
  it("is one audited write through tenantWrite, carrying the actor and the values as parameters", async () => {
    await saveSettings("tenant-1", "gene@tin.info", { brandName: "Acme", accent: "#112233", logoPath: null, modules: ["projects"] });
    expect(tenantWrite).toHaveBeenCalledTimes(1);
    const [tenantId, actor, statements] = tenantWrite.mock.calls[0] as unknown as [string, string, { text: string; params: unknown[] }[]];
    expect([tenantId, actor]).toEqual(["tenant-1", "gene@tin.info"]);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toMatch(/insert into tenant_settings[\s\S]*on conflict \(tenant_id\) do update/);
    expect(statements[0].text).not.toMatch(/Acme|112233/);
    expect(statements[0].params).toEqual(["Acme", "#112233", null, ["projects"], "gene@tin.info"]);
  });
});
