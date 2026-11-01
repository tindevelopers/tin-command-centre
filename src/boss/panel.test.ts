import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BossPanel } from "@/components/BossPanel";
import type { ReportsResult } from "./reports";
import type { PlatformRow } from "./summary";

const now = new Date("2026-11-01T12:00:00Z");
const row = (over: Partial<PlatformRow> = {}): PlatformRow => ({
  platform: "pawpointers", environment: "production", health: "ok", state: "reported", reportedAt: new Date("2026-11-01T10:00:00Z"),
  components: [{ component: "dashboard", health: "ok", versions: { "@tindevelopers/credential-crypto": "1.0.0" }, errorCount: 0, reportedAt: new Date("2026-11-01T10:00:00Z") }],
  ...over,
});
const html = (rows: PlatformRow[], result: ReportsResult) => renderToStaticMarkup(createElement(BossPanel, { rows, result, now }));

describe("BossPanel", () => {
  it("shows platform, environment, health, component, version and age", () => {
    const out = html([row()], { status: "ok", reports: [] });
    expect(out).toContain("pawpointers");
    expect(out).toContain("production");
    expect(out).toContain("health ok");
    expect(out).toContain("credential-crypto 1.0.0");
    expect(out).toContain("2 h ago");
  });

  it("a platform that never reported says so and is never shown healthy", () => {
    const out = html([row({ state: "not-reported", health: null, components: [], reportedAt: null, environment: "—" })], { status: "ok", reports: [] });
    expect(out).toContain("not reported");
    expect(out).toContain("never");
    expect(out).not.toContain("health ok");
  });

  it("when BOSS is unavailable it says so in fixed words and shows unknown rows", () => {
    const out = html([row({ state: "unavailable", health: null, components: [], reportedAt: null })], { status: "unavailable", reason: "unauthorized" });
    expect(out).toContain("BOSS refused the console");
    expect(out).toContain("unknown");
    expect(out).not.toContain("health ok");
  });

  it("escapes anything that is not plain text", () => {
    const out = html([row({ platform: "<img src=x onerror=alert(1)>" })], { status: "ok", reports: [] });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
