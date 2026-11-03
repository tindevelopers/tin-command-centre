import { describe, expect, it, vi } from "vitest";

vi.mock("@tindevelopers/ui-shell/icons", () => {
  const Icon = () => null;
  return { GridIcon: Icon, BoxIcon: Icon, BoltIcon: Icon, TableIcon: Icon, ListIcon: Icon, PieChartIcon: Icon, PlugInIcon: Icon, TaskIcon: Icon, GroupIcon: Icon, LockIcon: Icon };
});
import { MODULE_IDS } from "@/config/modules";
import { consoleNavigation } from "@/config/navigation";
import { defaultSettings, filterNavigation, moduleForPath, parseSettings, pathAllowed } from "./settings-shared";

const names = (xs: { name: string; subItems?: { name: string }[] }[]) => xs.map((i) => (i.subItems ? `${i.name}[${i.subItems.map((s) => s.name).join(",")}]` : i.name));

describe("parseSettings", () => {
  it("gives today's console for no row, a non-object, or a row with nothing set", () => {
    for (const row of [undefined, null, "x", 3, {}, { modules: null }]) expect(parseSettings(row)).toEqual(defaultSettings());
  });
  it("keeps a valid brand and lowercases the accent", () => {
    const s = parseSettings({ brand_name: " Implexus Ops ", accent: "#0A84FF", logo_path: "/images/logo/implexus.svg", modules: null });
    expect(s.brand).toEqual({ name: "Implexus Ops", accent: "#0a84ff", logoPath: "/images/logo/implexus.svg" });
  });
  it("drops anything that is not exactly what the migration allows", () => {
    const s = parseSettings({ brand_name: "x".repeat(41), accent: "red; background:url(x)", logo_path: "https://evil.example/x.svg" });
    expect(s.brand).toEqual({ name: null, accent: null, logoPath: null });
    expect(parseSettings({ brand_name: "a\u0000b", logo_path: "/a/../b", accent: "#12345" }).brand).toEqual({ name: null, accent: null, logoPath: null });
    expect(parseSettings({ logo_path: "//evil.example/x.svg" }).brand.logoPath).toBeNull();
  });
  it("keeps only known modules and always keeps the always-on ones", () => {
    const s = parseSettings({ modules: ["projects", "nonsense", 7] });
    expect(s.modules).toEqual(["overview", "operators", "workspace", "projects"]);
    expect(parseSettings({ modules: [] }).modules).toEqual(["overview", "operators", "workspace"]);
    expect(defaultSettings().modules).toEqual([...MODULE_IDS]);
  });
});

describe("moduleForPath", () => {
  it("maps routes to their module, longest prefix first", () => {
    expect(moduleForPath("/")).toBe("overview");
    expect(moduleForPath("/projects/konnect")).toBe("projects");
    expect(moduleForPath("/boss/keys")).toBe("boss");
    expect(moduleForPath("/keys")).toBe("keys");
    expect(moduleForPath("/tenants")).toBe("settings");
    expect(moduleForPath("/workspace")).toBe("workspace");
    expect(moduleForPath("/settings/policy")).toBe("settings");
  });
  it("does not match a prefix that is only part of a segment, and leaves unowned routes alone", () => {
    expect(moduleForPath("/projectsx")).toBeNull();
    expect(moduleForPath("/signin")).toBeNull();
    expect(moduleForPath("/api/health")).toBeNull();
    expect(pathAllowed(parseSettings({ modules: [] }), "/signin")).toBe(true);
  });
  it("every item in the console navigation belongs to a module", () => {
    const paths = consoleNavigation.main.flatMap((i) => (i.subItems ? i.subItems : [i]).map((s) => s.path ?? ""));
    for (const p of paths) expect(moduleForPath(p), p).not.toBeNull();
  });
});

describe("filterNavigation", () => {
  it("is the whole menu by default and does not change its input", () => {
    const before = JSON.stringify(names(consoleNavigation.main));
    expect(names(filterNavigation(consoleNavigation.main, defaultSettings()))).toEqual(names(consoleNavigation.main));
    expect(JSON.stringify(names(consoleNavigation.main))).toBe(before);
  });
  it("gives a tenant only its modules, and drops a parent left empty", () => {
    const s = parseSettings({ modules: ["projects", "drift", "keys", "settings"] });
    expect(names(filterNavigation(consoleNavigation.main, s))).toEqual([
      "Overview", "Projects", "Drift", "Consumers and keys", "Operators", "Settings[Workspace,Tenants,Policy,Integrations]",
    ]);
    const bare = names(filterNavigation(consoleNavigation.main, parseSettings({ modules: [] })));
    expect(bare).toEqual(["Overview", "Operators", "Settings[Workspace]"]);
  });
});

describe("tabTitle and tabDescription", () => {
  it("default to the TIN title and description when a tenant has no display name", async () => {
    const { tabTitle, tabDescription, DEFAULT_TITLE, DEFAULT_DESCRIPTION } = await import("./settings-shared");
    expect(tabTitle(defaultSettings())).toBe(DEFAULT_TITLE);
    expect(tabDescription(defaultSettings())).toBe(DEFAULT_DESCRIPTION);
  });
  it("use the tenant's display name, and a branded description never names TIN", async () => {
    const { tabTitle, tabDescription } = await import("./settings-shared");
    const s = parseSettings({ brand_name: "Implexus Ops" });
    expect(tabTitle(s)).toBe("Implexus Ops");
    expect(tabDescription(s)).toMatch(/^Implexus Ops: /);
    expect(tabDescription(s)).not.toMatch(/TIN/);
  });
  it("a bad stored name falls back to the default title rather than showing it", async () => {
    const { tabTitle, DEFAULT_TITLE } = await import("./settings-shared");
    expect(tabTitle(parseSettings({ brand_name: "x".repeat(41) }))).toBe(DEFAULT_TITLE);
    expect(tabTitle(parseSettings({ brand_name: "a\u0007b" }))).toBe(DEFAULT_TITLE);
  });
});
