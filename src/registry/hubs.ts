import { HUB_TOPOLOGY, topologyByRepo } from "@/config/topology";
import type { HubTopology, TopologyStatus } from "@/config/topology";
import type { Colour, PackageSnapshot } from "@/src/status/types";
import { packageColour, worst } from "@/src/status/rules";
import type { Registry } from "./types";

/**
 * Hubs and packages, as one row per hub: what the collector saw published (package_snapshots, grouped by repo) joined to the
 * topology plan (config/topology.ts, or a project's annotations when the registry carries them). Pure, so the page and its tests
 * share it.
 */

/** What a package's dist-tags say, read from the collector's `divergence` text (its vocabulary is the registry report's). */
export type PackageState = "ok" | "awaiting-promotion" | "unpublished" | "known-drift" | "divergent";

export function packageState(divergence: string): PackageState {
  if (divergence.startsWith("OK (forward")) return "awaiting-promotion";
  if (divergence.startsWith("OK (unpublished")) return "unpublished";
  if (divergence.startsWith("OK")) return "ok";
  if (divergence.startsWith("KNOWN DRIFT")) return "known-drift";
  return "divergent";
}

export const PACKAGE_STATE_LABEL: Record<PackageState, string> = {
  ok: "OK",
  "awaiting-promotion": "Awaiting promotion",
  unpublished: "Unpublished",
  "known-drift": "Known drift",
  divergent: "Divergent",
};

export type HubPackage = {
  package: string;
  branchVersion: string | null;
  latest: string | null;
  next: string | null;
  state: PackageState;
  colour: Colour;
  /** In-estate packages that depend on this one, when the collector recorded them as names. */
  dependents: string[];
  divergence: string;
};

export type HubRow = {
  /** Repository name without the owner; the key that joins snapshots to the topology. */
  repo: string;
  nickname: string | null;
  layer: string | null;
  riskClass: string | null;
  topologyStatus: TopologyStatus | null;
  topologyNote: string | null;
  tasks: string[];
  packages: HubPackage[];
  counts: Record<PackageState, number>;
  /** Distinct in-estate dependents across the hub's packages. */
  dependents: string[];
  /** Worst package colour; planned hubs with no packages are null (nothing to judge yet). */
  colour: Colour | null;
  /** The registry project with this repo, if one is declared. */
  projectSlug: string | null;
  ownerGroup: string | null;
};

const emptyCounts = (): Record<PackageState, number> => ({ ok: 0, "awaiting-promotion": 0, unpublished: 0, "known-drift": 0, divergent: 0 });

/** `owner/repo` or `repo` → `repo`. */
export const repoName = (repo: string): string => repo.split("/").pop() ?? repo;

const names = (dependents: unknown): string[] => (Array.isArray(dependents) ? dependents.filter((d): d is string => typeof d === "string") : []);

const annotation = (a: Record<string, unknown>, key: string): string | null => (typeof a[key] === "string" ? (a[key] as string) : null);

/** Topology from the registry's annotations when present (`tin.info/layer`, `tin.info/risk-class`, `tin.info/topology`), else the decision file. */
function topologyFor(repo: string, registry: Pick<Registry, "projects"> | null, fallback: Map<string, HubTopology>): { t: Partial<HubTopology> | null; projectSlug: string | null; ownerGroup: string | null } {
  const project = registry?.projects.find((p) => p.repo && repoName(p.repo) === repo) ?? null;
  const file = fallback.get(repo) ?? null;
  if (!project) return { t: file, projectSlug: null, ownerGroup: null };
  const a = project.annotations ?? {};
  const status = annotation(a, "tin.info/topology");
  const fromAnnotations: Partial<HubTopology> = {
    layer: (annotation(a, "tin.info/layer") as HubTopology["layer"] | null) ?? file?.layer,
    riskClass: (annotation(a, "tin.info/risk-class") as HubTopology["riskClass"] | null) ?? file?.riskClass,
    status: status && (["existing", "planned", "rename", "archive", "shrink"] as const).includes(status as TopologyStatus) ? (status as TopologyStatus) : file?.status,
    note: annotation(a, "tin.info/topology-note") ?? file?.note,
    nickname: file?.nickname ?? null,
    tasks: file?.tasks ?? [],
  };
  return { t: fromAnnotations, projectSlug: project.slug, ownerGroup: project.ownerGroup ?? null };
}

/**
 * One row per hub. Hubs come from the snapshots (every repo that published a package) plus every hub in the topology file,
 * so a planned hub with no packages still appears. Rows are ordered worst first, then planned hubs, then by name.
 */
export function hubRows(packages: PackageSnapshot[] | null, registry: Pick<Registry, "projects"> | null = null, topology: readonly HubTopology[] = HUB_TOPOLOGY): HubRow[] {
  const fallback = new Map(topology.map((h) => [h.repo, h]));
  const byRepo = new Map<string, PackageSnapshot[]>();
  for (const p of packages ?? []) {
    const r = repoName(p.repo);
    byRepo.set(r, [...(byRepo.get(r) ?? []), p]);
  }
  const repos = new Set<string>([...byRepo.keys(), ...topology.map((h) => h.repo)]);
  const rows: HubRow[] = [];
  for (const repo of repos) {
    const { t, projectSlug, ownerGroup } = topologyFor(repo, registry, fallback);
    const pkgs: HubPackage[] = (byRepo.get(repo) ?? [])
      .map((p) => ({ package: p.package, branchVersion: p.branchVersion, latest: p.latest, next: p.next, state: packageState(p.divergence), colour: packageColour(p), dependents: names(p.dependents), divergence: p.divergence }))
      .sort((a, b) => a.package.localeCompare(b.package));
    const counts = emptyCounts();
    for (const p of pkgs) counts[p.state] += 1;
    rows.push({
      repo,
      nickname: t?.nickname ?? null,
      layer: t?.layer ?? null,
      riskClass: t?.riskClass ?? null,
      topologyStatus: t?.status ?? null,
      topologyNote: t?.note ?? null,
      tasks: t?.tasks ?? [],
      packages: pkgs,
      counts,
      dependents: [...new Set(pkgs.flatMap((p) => p.dependents))].sort(),
      colour: pkgs.length === 0 ? null : worst(pkgs.map((p) => p.colour)),
      projectSlug,
      ownerGroup,
    });
  }
  const RANK: Record<string, number> = { red: 0, amber: 1, green: 2, none: 3 };
  return rows.sort((a, b) => RANK[a.colour ?? "none"] - RANK[b.colour ?? "none"] || a.repo.localeCompare(b.repo));
}

export type HubFilters = { view: "all" | "existing" | "planned" | "changing"; state: "" | PackageState; q: string };

const one = (p: Record<string, string | string[] | undefined>, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};

/** Reads the URL. Anything unrecognised is ignored rather than trusted. */
export function parseHubFilters(p: Record<string, string | string[] | undefined>): HubFilters {
  const view = one(p, "view");
  const state = one(p, "state");
  return {
    view: view === "existing" || view === "planned" || view === "changing" ? view : "all",
    state: (Object.keys(PACKAGE_STATE_LABEL) as PackageState[]).includes(state as PackageState) ? (state as PackageState) : "",
    q: one(p, "q"),
  };
}

const CHANGING: TopologyStatus[] = ["rename", "archive", "shrink"];

export function filterHubRows(rows: HubRow[], f: HubFilters): HubRow[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) =>
    (f.view === "all" ||
      (f.view === "existing" && r.packages.length > 0) ||
      (f.view === "planned" && r.topologyStatus === "planned") ||
      (f.view === "changing" && r.topologyStatus !== null && CHANGING.includes(r.topologyStatus))) &&
    (!f.state || r.counts[f.state] > 0) &&
    (!q || r.repo.toLowerCase().includes(q) || (r.nickname ?? "").toLowerCase().includes(q) || r.packages.some((p) => p.package.toLowerCase().includes(q))));
}

export type HubTotals = { hubs: number; withPackages: number; packages: number; published: number } & Record<PackageState, number>;

export function hubTotals(rows: HubRow[]): HubTotals {
  const t: HubTotals = { hubs: rows.length, withPackages: 0, packages: 0, published: 0, ...emptyCounts() };
  for (const r of rows) {
    if (r.packages.length > 0) t.withPackages += 1;
    t.packages += r.packages.length;
    t.published += r.packages.filter((p) => p.latest !== null || p.next !== null).length;
    for (const s of Object.keys(r.counts) as PackageState[]) t[s] += r.counts[s];
  }
  return t;
}

export const topologyRepos = () => [...topologyByRepo().keys()];
