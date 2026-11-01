import type { Project, Registry } from "@/src/registry/types";
import type { BossReport, ReportHealth, ReportsResult } from "./reports";

/**
 * What each platform environment reports to BOSS, one row per platform and environment, for the Overview and the BOSS pages.
 *
 * A platform is a `client` named by an active project in the registry. Every such platform appears, so a platform that has never
 * reported is visible as "not reported" rather than missing. Pure: no I/O, so the same function serves the page and its tests.
 */
export type PlatformRow = {
  platform: string;
  environment: string;
  /** Worst health among the components that reported, or null when nothing has. */
  health: ReportHealth | null;
  /** Each component's latest report, by component name. */
  components: { component: string; health: ReportHealth; versions: Record<string, string>; errorCount: number; reportedAt: Date }[];
  /** The newest report in the row, or null. */
  reportedAt: Date | null;
  state: "reported" | "not-reported" | "unavailable";
};

const HEALTH_RANK: Record<ReportHealth, number> = { down: 0, degraded: 1, ok: 2 };
const worstHealth = (hs: ReportHealth[]): ReportHealth | null => (hs.length === 0 ? null : hs.sort((a, b) => HEALTH_RANK[a] - HEALTH_RANK[b])[0]);

/** Registered platforms: distinct `client` of projects that are not retired, in alphabetical order. */
export function registeredPlatforms(projects: Pick<Project, "client" | "lifecycle">[]): string[] {
  return [...new Set(projects.filter((p) => p.lifecycle !== "retired" && p.client).map((p) => p.client as string))].sort();
}

/** The latest report per (platform, environment, component). BOSS already returns one row per component, but the reader does not promise it. */
function latestByComponent(reports: BossReport[]): Map<string, BossReport> {
  const out = new Map<string, BossReport>();
  for (const r of reports) {
    const k = `${r.platform}\u0000${r.environment}\u0000${r.component}`;
    const prev = out.get(k);
    if (!prev || r.reportedAt > prev.reportedAt) out.set(k, r);
  }
  return out;
}

export function platformSummary(registry: Pick<Registry, "projects">, result: ReportsResult): PlatformRow[] {
  const platforms = registeredPlatforms(registry.projects);
  if (result.status !== "ok") {
    return platforms.map((platform) => ({ platform, environment: "—", health: null, components: [], reportedAt: null, state: "unavailable" }));
  }
  const latest = [...latestByComponent(result.reports).values()];
  const rows = new Map<string, PlatformRow>();
  for (const r of latest) {
    const k = `${r.platform}\u0000${r.environment}`;
    const row = rows.get(k) ?? { platform: r.platform, environment: r.environment, health: null, components: [], reportedAt: null, state: "reported" as const };
    row.components.push({ component: r.component, health: r.health, versions: r.versions, errorCount: r.errors.reduce((n, e) => n + e.count, 0), reportedAt: r.reportedAt });
    rows.set(k, row);
  }
  for (const row of rows.values()) {
    row.components.sort((a, b) => a.component.localeCompare(b.component));
    row.health = worstHealth(row.components.map((c) => c.health));
    row.reportedAt = row.components.reduce<Date | null>((m, c) => (m && m > c.reportedAt ? m : c.reportedAt), null);
  }
  // Registered platforms that reported nothing still get a row, so their silence is on the page.
  for (const platform of platforms) {
    if (![...rows.values()].some((r) => r.platform === platform)) {
      rows.set(`${platform}\u0000`, { platform, environment: "—", health: null, components: [], reportedAt: null, state: "not-reported" });
    }
  }
  return [...rows.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.environment.localeCompare(b.environment));
}

export type PlatformCounts = { reporting: number; registered: number };

/** How many registered platforms have at least one report. Unknown platforms that report are counted as reporting but not as registered. */
export function platformCounts(rows: PlatformRow[], registered: string[]): PlatformCounts {
  const reporting = new Set(rows.filter((r) => r.state === "reported").map((r) => r.platform));
  return { reporting: registered.filter((p) => reporting.has(p)).length, registered: registered.length };
}
