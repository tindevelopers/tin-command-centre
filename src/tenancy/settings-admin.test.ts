import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantQuery = vi.fn();
const tenantWrite = vi.fn(async () => {});
vi.mock("./db", () => ({
  tenantQuery: (...a: unknown[]) => tenantQuery(...a),
  tenantWrite: (...a: unknown[]) => (tenantWrite as (...x: unknown[]) => unknown)(...a),
  isMissingFunction: (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "42883",
}));

import { readTenantSettings, writeTenantSettings } from "./settings-admin";

beforeEach(() => { tenantQuery.mockReset(); tenantWrite.mockClear(); });

describe("readTenantSettings", () => {
  it("parses the row the function returns and reports who changed it last", async () => {
    tenantQuery.mockResolvedValue([{ brand_name: "Acme", accent: "#112233", logo_path: null, modules: ["projects"], updated_at: "2026-11-03T10:00:00Z", updated_by: "gene@tin.info" }]);
    const r = await readTenantSettings("platform-id", "acme");
    expect(tenantQuery).toHaveBeenCalledWith("platform-id", "select * from get_tenant_settings($1)", ["acme"]);
    expect(r?.hasRow).toBe(true);
    expect(r?.settings.brand).toEqual({ name: "Acme", accent: "#112233", logoPath: null });
    expect(r?.settings.modules).toEqual(["overview", "operators", "workspace", "projects"]);
    expect(r?.updatedBy).toBe("gene@tin.info");
  });
  it("no row gives the defaults and says there is no row", async () => {
    tenantQuery.mockResolvedValue([]);
    const r = await readTenantSettings("platform-id", "acme");
    expect(r?.hasRow).toBe(false);
    expect(r?.settings.brand).toEqual({ name: null, accent: null, logoPath: null });
  });
  it("is null when db/012 is not applied, and rethrows anything else", async () => {
    tenantQuery.mockRejectedValueOnce({ code: "42883" });
    expect(await readTenantSettings("platform-id", "acme")).toBeNull();
    tenantQuery.mockRejectedValueOnce(new Error("boom"));
    await expect(readTenantSettings("platform-id", "acme")).rejects.toThrow("boom");
  });
});

describe("writeTenantSettings", () => {
  it("calls the function once, as the platform tenant with the actor, passing every value as a parameter", async () => {
    await writeTenantSettings("platform-id", "gene@tin.info", "acme", { brandName: "Acme", accent: null, logoPath: null, modules: [] });
    const [tenantId, actor, statements] = tenantWrite.mock.calls[0] as unknown as [string, string, { text: string; params: unknown[] }[]];
    expect([tenantId, actor]).toEqual(["platform-id", "gene@tin.info"]);
    expect(statements).toEqual([{ text: "select set_tenant_settings($1, $2, $3, $4, $5)", params: ["acme", "Acme", null, null, []] }]);
  });
});
