import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportedPins } from "@/components/ReportedPins";
import type { PinComparison } from "./compare";
import type { ReportsResult } from "./reports";

const cmp = (over: Partial<PinComparison> = {}): PinComparison => ({
  projectSlug: "konnect-knowledge-worker", environment: "staging", platform: "konnect", package: "@tindevelopers/knowledge", declared: "0.5.0",
  state: "not-deployed", reported: [{ component: "knowledge-worker", version: "0.4.2", health: "ok", reportedAt: new Date("2026-10-14T10:00:00Z") }],
  message: "Not deployed: declared 0.5.0, reported 0.4.2 by knowledge-worker. Merging a pin does not deploy it.", ...over,
});
const html = (comparisons: PinComparison[], result: ReportsResult) => renderToStaticMarkup(createElement(ReportedPins, { comparisons, result }));

describe("ReportedPins", () => {
  it("shows declared, reported and marks a mismatch as Not deployed", () => {
    const out = html([cmp()], { status: "ok", reports: [] });
    expect(out).toContain("0.5.0");
    expect(out).toContain("0.4.2");
    expect(out).toContain("Not deployed");
    expect(out).not.toContain("BOSS reports are unavailable");
  });

  it("says plainly that BOSS is unavailable and shows nothing as deployed", () => {
    const out = html([cmp({ state: "unavailable", reported: [], message: "x" })], { status: "unavailable", reason: "timeout" });
    expect(out).toContain("BOSS reports are unavailable");
    expect(out).toContain("Unavailable");
    expect(out).not.toMatch(/>Deployed</);
  });

  it("escapes anything that is not plain text", () => {
    const out = html([cmp({ declared: "<img src=x onerror=alert(1)>" })], { status: "ok", reports: [] });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});
