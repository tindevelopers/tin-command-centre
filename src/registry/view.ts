import type { PackageSnapshot, Colour } from "@/src/status/types";
import { LIFECYCLES, KINDS } from "./types";
import type { EnvName, Finding, Lifecycle, Kind, Registry } from "./types";
import { bySeverity, pinFinding } from "./drift";

export type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};
const oneOf = <T extends string>(v: string, allowed: readonly T[]): T | "" => ((allowed as readonly string[]).includes(v) ? (v as T) : "");

// ---- projects list ---------------------------------------------------------------

export type ProjectRow = {
  slug: string; name: string; kind: Kind; client: string | null; lifecycle: Lifecycle;
  owners: string[]; ownerProject: string | null; ownerName: string | null; parent: string | null;
  /** null for retired projects, which are not checked */
  colour: Colour | null; red: number; amber: number; topFinding: Finding | null;
};

export function summarise(reg: Registry, findings: Finding[]): ProjectRow[] {
  const nameOf = new Map(reg.projects.map((p) => [p.slug, p.name]));
  const parentOf = new Map<string, string>();
  for (const r of reg.relations) if (r.relation === "has_part" && !parentOf.has(r.toSlug)) parentOf.set(r.toSlug, r.fromSlug);
  return reg.projects.map((p) => {
    const bad = findings.filter((f) => f.projectSlug === p.slug && f.colour !== "green").sort(bySeverity);
    const red = bad.filter((f) => f.colour === "red").length;
    const amber = bad.length - red;
    const retired = p.lifecycle === "retired";
    return {
      slug: p.slug, name: p.name, kind: p.kind, client: p.client, lifecycle: p.lifecycle,
      owners: reg.assignments.filter((a) => a.projectSlug === p.slug && a.role === "owner").map((a) => a.assignee),
      ownerProject: p.ownerProject, ownerName: p.ownerProject ? nameOf.get(p.ownerProject) ?? p.ownerProject : null,
      parent: parentOf.get(p.slug) ?? null,
      colour: retired ? null : red ? "red" : amber ? "amber" : "green",
      red, amber, topFinding: bad[0] ?? null,
    };
  });
}

/** Owned by neither a project nor a person. */
export const hasNoOwner = (r: ProjectRow) => !r.ownerProject && r.owners.length === 0;

export const STATUSES = ["red", "amber", "green"] as const;
export const SORT_KEYS = ["severity", "name", "kind", "client", "owner", "lifecycle"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type ProjectFilters = {
  q: string; kind: Kind | ""; client: string; status: (typeof STATUSES)[number] | ""; owner: string; lifecycle: Lifecycle | "";
  sort: SortKey; dir: "asc" | "desc";
};

const defaultDir = (s: SortKey): "asc" | "desc" => (s === "severity" ? "desc" : "asc");

/** Reads the URL. Anything unrecognised is ignored rather than trusted. */
export function parseProjectFilters(p: Params): ProjectFilters {
  const sort = oneOf(one(p, "sort"), SORT_KEYS) || "severity";
  const dir = one(p, "dir");
  return {
    q: one(p, "q"), kind: oneOf(one(p, "kind"), KINDS), client: one(p, "client"),
    status: oneOf(one(p, "status"), STATUSES), owner: one(p, "owner"), lifecycle: oneOf(one(p, "lifecycle"), LIFECYCLES),
    sort, dir: dir === "asc" || dir === "desc" ? dir : defaultDir(sort),
  };
}

export const hasFilters = (f: ProjectFilters) => Boolean(f.q || f.kind || f.client || f.status || f.owner || f.lifecycle);
/** The nested (grouped) view only applies to the default, unfiltered, severity-sorted list. */
export const isNestedView = (f: ProjectFilters) => !hasFilters(f) && f.sort === "severity" && f.dir === "desc";

export function applyProjectFilters(rows: ProjectRow[], f: ProjectFilters): ProjectRow[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) =>
    (!q || [r.name, r.slug, r.client ?? "", r.ownerName ?? "", ...r.owners].some((s) => s.toLowerCase().includes(q))) &&
    (!f.kind || r.kind === f.kind) &&
    (!f.client || (f.client === "none" ? r.client === null : r.client === f.client)) &&
    (!f.status || r.colour === f.status) &&
    (!f.owner || (f.owner === "none" ? hasNoOwner(r) : f.owner.startsWith("p:") ? r.ownerProject === f.owner.slice(2) : r.owners.includes(f.owner))) &&
    (!f.lifecycle || r.lifecycle === f.lifecycle));
}

const severity = (r: ProjectRow) => r.red * 1000 + r.amber;
const text = (r: ProjectRow, k: SortKey) => (k === "name" ? r.name : k === "kind" ? r.kind : k === "client" ? r.client ?? "" : k === "owner" ? r.ownerName ?? r.owners[0] ?? "" : r.lifecycle);

export function sortProjectRows(rows: ProjectRow[], sort: SortKey, dir: "asc" | "desc"): ProjectRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = sort === "severity" ? severity(a) - severity(b) : text(a, sort).localeCompare(text(b, sort));
    return sign * primary || a.name.localeCompare(b.name);
  });
}

export type TreeRow = { row: ProjectRow; depth: 0 | 1; childCount: number; childRed: number; childAmber: number };

/**
 * Children (projects hosted by another listed project) follow their parent, indented. Groups are ordered by their
 * worst member, so a healthy parent never hides failing children below it. Rows must already be sorted.
 */
export function nest(rows: ProjectRow[]): TreeRow[] {
  const slugs = new Set(rows.map((r) => r.slug));
  const kids = new Map<string, ProjectRow[]>();
  for (const r of rows) if (r.parent && slugs.has(r.parent)) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r]);
  const groups = rows
    .filter((r) => !(r.parent && slugs.has(r.parent)))
    .map((r) => ({ r, children: kids.get(r.slug) ?? [] }));
  const worst = (g: { r: ProjectRow; children: ProjectRow[] }) => Math.max(severity(g.r), ...g.children.map(severity));
  groups.sort((a, b) => worst(b) - worst(a) || a.r.name.localeCompare(b.r.name));
  return groups.flatMap(({ r, children }) => [
    { row: r, depth: 0 as const, childCount: children.length, childRed: children.filter((c) => c.colour === "red").length, childAmber: children.filter((c) => c.colour === "amber").length },
    ...children.map((c) => ({ row: c, depth: 1 as const, childCount: 0, childRed: 0, childAmber: 0 })),
  ]);
}

export function projectCounts(rows: ProjectRow[]) {
  const live = rows.filter((r) => r.lifecycle !== "retired");
  return {
    total: rows.length,
    red: live.filter((r) => r.colour === "red").length,
    amber: live.filter((r) => r.colour === "amber").length,
    green: live.filter((r) => r.colour === "green").length,
    noOwner: live.filter(hasNoOwner).length,
  };
}

// ---- drift -----------------------------------------------------------------------

export type DriftFilters = { view: "project" | "package"; q: string; status: "" | "red" | "amber" | "all"; kind: "" | "pin" | "cell" | "owner" };

export function parseDriftFilters(p: Params): DriftFilters {
  return {
    view: one(p, "view") === "package" ? "package" : "project",
    q: one(p, "q"),
    status: (["red", "amber", "all"] as const).find((s) => s === one(p, "status")) ?? "",
    kind: (["pin", "cell", "owner"] as const).find((s) => s === one(p, "kind")) ?? "",
  };
}

/** Default shows only what needs action or attention. */
const showsColour = (status: DriftFilters["status"], c: Colour) => (status === "all" ? true : status === "" ? c !== "green" : c === status);

export function filterFindings(findings: Finding[], f: DriftFilters): Finding[] {
  const q = f.q.toLowerCase();
  return findings.filter((x) =>
    showsColour(f.status, x.colour) && (!f.kind || x.kind === f.kind) &&
    (!q || [x.projectSlug, x.subject, x.message].some((s) => s.toLowerCase().includes(q)))).sort(bySeverity);
}

export type PackageGroup = { version: string; colour: Colour; message: string; projects: { slug: string; environment: EnvName }[] };
export type PackageRow = { package: string; latest: string | null; next: string | null; groups: PackageGroup[]; worst: Colour; behind: number };

const RANK: Record<Colour, number> = { red: 0, amber: 1, green: 2 };

/** One row per package: every declared version of it, with the projects on that version. Retired projects are skipped. */
export function packageMatrix(reg: Registry, packages: PackageSnapshot[] | null): PackageRow[] {
  const live = new Set(reg.projects.filter((p) => p.lifecycle !== "retired").map((p) => p.slug));
  const snap = new Map((packages ?? []).map((p) => [p.package, p]));
  const byPkg = new Map<string, Map<string, PackageGroup>>();
  for (const pin of reg.pins) {
    if (!live.has(pin.projectSlug)) continue;
    const f = pinFinding(pin, snap.get(pin.package));
    const groups = byPkg.get(pin.package) ?? new Map<string, PackageGroup>();
    const g = groups.get(pin.version) ?? { version: pin.version, colour: f.colour, message: f.message, projects: [] };
    g.projects.push({ slug: pin.projectSlug, environment: pin.environment });
    groups.set(pin.version, g);
    byPkg.set(pin.package, groups);
  }
  return [...byPkg.entries()].map(([pkg, groups]) => {
    const list = [...groups.values()].sort((a, b) => RANK[a.colour] - RANK[b.colour] || b.version.localeCompare(a.version, undefined, { numeric: true }));
    return {
      package: pkg, latest: snap.get(pkg)?.latest ?? null, next: snap.get(pkg)?.next ?? null, groups: list,
      worst: list[0].colour, behind: list.filter((g) => g.colour !== "green").reduce((n, g) => n + g.projects.length, 0),
    };
  }).sort((a, b) => RANK[a.worst] - RANK[b.worst] || b.behind - a.behind || a.package.localeCompare(b.package));
}

export function filterPackageRows(rows: PackageRow[], f: DriftFilters): PackageRow[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) =>
    showsColour(f.status, r.worst) &&
    (!q || r.package.toLowerCase().includes(q) || r.groups.some((g) => g.projects.some((p) => p.slug.toLowerCase().includes(q)))));
}
