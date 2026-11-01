import { cellColour, worst } from "@/src/status/rules";
import type { CellSnapshot, Colour, PackageSnapshot } from "@/src/status/types";
import type { EnvName, Environment, Finding, Pin, Project, Registry } from "./types";

type Semver = { core: [number, number, number]; pre: string | null };

export function parseVersion(v: string | null): Semver | null {
  const m = v?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

/** Orders by major.minor.patch; at equal cores a prerelease sorts before the release, prereleases compare as text. */
export function compareVersions(a: Semver, b: Semver): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

export const sameVersion = (a: string | null, b: string) => {
  const pa = parseVersion(a), pb = parseVersion(b);
  return pa && pb ? compareVersions(pa, pb) === 0 : a === b;
};

/** Declared pin versus what the collector last saw published for that package. */
export function pinFinding(pin: Pin, snap: PackageSnapshot | undefined): Finding {
  const base = { projectSlug: pin.projectSlug, environment: pin.environment, kind: "pin" as const, subject: pin.package };
  const out = (colour: Colour, message: string): Finding => ({ ...base, colour, message });
  const declared = parseVersion(pin.version);
  if (!declared) return out("red", `Declared version "${pin.version}" is not an exact version.`);
  if (!snap) return out("amber", "The collector has not seen this package.");
  if (!snap.latest && !snap.next) return out("amber", "No published versions observed.");
  if (snap.latest && sameVersion(snap.latest, pin.version)) return out("green", `Matches latest ${snap.latest}.`);
  if (snap.next && sameVersion(snap.next, pin.version)) {
    return out("amber", `On next ${snap.next}; latest is ${snap.latest ?? "unpublished"}, awaiting promotion.`);
  }
  const latest = parseVersion(snap.latest);
  if (!latest) return out("red", `Declared ${pin.version} is not a published version.`);
  if (compareVersions(declared, latest) > 0) return out("red", `Declared ${pin.version} is newer than any published version (latest ${snap.latest}).`);
  if (declared.core[0] < latest.core[0]) return out("red", `Behind latest ${snap.latest} by a major version.`);
  return out("amber", `Behind latest ${snap.latest}.`);
}

/** Declared cell versus its health at the last collector run. null when the environment declares no cell. */
export function cellFinding(env: Environment, cells: CellSnapshot[] | null): Finding | null {
  if (!env.cell) return null;
  const base = { projectSlug: env.projectSlug, environment: env.name, kind: "cell" as const, subject: env.cell };
  if (!cells) return { ...base, colour: "amber", message: "No collector data yet." };
  const seen = cells.find((c) => c.cell === env.cell);
  if (!seen) return { ...base, colour: "red", message: "Declared cell was not observed by the collector." };
  if (cellColour(seen) === "red") return { ...base, colour: "red", message: `Cell unhealthy: healthz ${seen.healthzStatus ?? "none"}, readyz ${seen.readyzStatus ?? "none"}.` };
  return { ...base, colour: "green", message: "Cell healthy." };
}

export function ownerFinding(project: Project, ownerCount: number): Finding | null {
  if (ownerCount > 0 || project.ownerProject) return null;
  return { projectSlug: project.slug, environment: null, kind: "owner", subject: "owner", colour: "amber", message: "No owner: set an owning project or assign a person." };
}

/** All findings for every non-retired project. packages and cells are null when the collector has produced no data. */
export function computeDrift(reg: Registry, packages: PackageSnapshot[] | null, cells: CellSnapshot[] | null): Finding[] {
  const live = new Map(reg.projects.filter((p) => p.lifecycle !== "retired").map((p) => [p.slug, p]));
  const bySlug = new Map((packages ?? []).map((p) => [p.package, p]));
  const findings: Finding[] = [];
  for (const p of live.values()) {
    const owners = reg.assignments.filter((a) => a.projectSlug === p.slug && a.role === "owner").length;
    const o = ownerFinding(p, owners);
    if (o) findings.push(o);
  }
  for (const pin of reg.pins) if (live.has(pin.projectSlug)) findings.push(pinFinding(pin, bySlug.get(pin.package)));
  for (const env of reg.environments) {
    if (!live.has(env.projectSlug)) continue;
    const f = cellFinding(env, cells);
    if (f) findings.push(f);
  }
  return findings;
}

const RANK: Record<Colour, number> = { red: 0, amber: 1, green: 2 };
export const bySeverity = (a: Finding, b: Finding) => RANK[a.colour] - RANK[b.colour] || a.projectSlug.localeCompare(b.projectSlug);

export function projectColour(slug: string, findings: Finding[]): Colour {
  return worst(findings.filter((f) => f.projectSlug === slug).map((f) => f.colour));
}

export const envLabel = (e: EnvName | null) => e ?? "—";
