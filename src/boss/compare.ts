import { sameVersion } from "@/src/registry/drift";
import type { EnvName, Pin, Project } from "@/src/registry/types";
import { describeUnavailable } from "./reports";
import type { BossReport, ReportHealth, ReportsResult } from "./reports";

/**
 * Declared pin versus what the platform REPORTED to BOSS (BOSS upstream replan, section 1.6 and Task 4b.5).
 *
 * "Merged pin = deployed" is false: merging a pin bump changes the repo, not the running system. A pin counts as deployed only when the
 * version the platform reported matches it. Anything else, including no report and an unreachable BOSS, is never shown as deployed.
 *
 * This is deliberately separate from drift (declared versus what the collector saw published): drift asks "is the pin current",
 * this asks "is the pin what is actually running".
 */

/** The packages whose rollout is manual today (migrations and the worker image), so they are the ones worth proving. */
export const WATCHED_PACKAGES = ["@tindevelopers/knowledge", "@tindevelopers/knowledge-worker"] as const;
const WATCHED = new Set<string>(WATCHED_PACKAGES);

export type DeployState = "deployed" | "not-deployed" | "not-reported" | "unavailable";

export type ReportedVersion = { component: string; version: string; health: ReportHealth; reportedAt: Date };

export type PinComparison = {
  projectSlug: string;
  environment: EnvName;
  /** The BOSS platform, taken from the project's `client`. */
  platform: string;
  package: string;
  declared: string;
  state: DeployState;
  reported: ReportedVersion[];
  /** Fixed text built from validated values only. */
  message: string;
};

type Scope = { projects: Pick<Project, "slug" | "client" | "lifecycle">[]; pins: Pin[] };

/** Only active projects that name a BOSS platform (their `client`) and declare a watched pin can be compared. */
const platformOf = (p: Pick<Project, "client" | "lifecycle"> | undefined) => (p && p.lifecycle !== "retired" && p.client ? p.client : null);

export function needsReports(project: Pick<Project, "slug" | "client" | "lifecycle">, pins: Pin[]): boolean {
  return Boolean(platformOf(project)) && pins.some((p) => p.projectSlug === project.slug && WATCHED.has(p.package));
}

/**
 * BOSS names a report by component. The component for `konnect-knowledge-worker` on platform `konnect` is taken to be `knowledge-worker`
 * (the slug without the platform prefix). If no such component reported the package, every component that did is considered.
 */
const componentHint = (slug: string, platform: string) => (slug.startsWith(`${platform}-`) ? slug.slice(platform.length + 1) : slug);

export function compareReported(scope: Scope, result: ReportsResult): PinComparison[] {
  const projects = new Map(scope.projects.map((p) => [p.slug, p]));
  const out: PinComparison[] = [];

  for (const pin of scope.pins) {
    if (!WATCHED.has(pin.package)) continue;
    const platform = platformOf(projects.get(pin.projectSlug));
    if (!platform) continue;
    const base = { projectSlug: pin.projectSlug, environment: pin.environment, platform, package: pin.package, declared: pin.version };

    if (result.status !== "ok") {
      out.push({ ...base, state: "unavailable", reported: [], message: `${describeUnavailable(result)} Deployed state is unknown.` });
      continue;
    }

    const here = result.reports.filter((r) => r.platform === platform && r.environment === pin.environment);
    if (here.length === 0) {
      out.push({ ...base, state: "not-reported", reported: [], message: `No report from ${platform} ${pin.environment}. Not shown as deployed.` });
      continue;
    }
    let reporters = here.filter((r) => pin.package in r.versions);
    if (reporters.length === 0) {
      out.push({ ...base, state: "not-reported", reported: [], message: `${platform} ${pin.environment} reports, but not ${pin.package}. Not shown as deployed.` });
      continue;
    }
    const hint = componentHint(pin.projectSlug, platform);
    const named = reporters.filter((r) => r.component === hint);
    if (named.length > 0) reporters = named;

    const reported = reporters.map((r: BossReport) => ({ component: r.component, version: r.versions[pin.package], health: r.health, reportedAt: r.reportedAt }));
    const wrong = reported.filter((r) => !sameVersion(r.version, pin.version));
    if (wrong.length === 0) {
      out.push({ ...base, state: "deployed", reported, message: `Reported ${pin.version} matches the declared version.` });
    } else {
      const seen = wrong.map((r) => `${r.version} by ${r.component}`).join(", ");
      out.push({ ...base, state: "not-deployed", reported, message: `Not deployed: declared ${pin.version}, reported ${seen}. Merging a pin does not deploy it.` });
    }
  }

  return out.sort((a, b) => a.projectSlug.localeCompare(b.projectSlug) || a.environment.localeCompare(b.environment) || a.package.localeCompare(b.package));
}
