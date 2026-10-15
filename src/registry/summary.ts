import { KINDS } from "./types";
import type { Finding, Kind, Registry } from "./types";

export type KindRow = { kind: Kind; projects: number; red: number; amber: number };
export type Lifecycles = { active: number; planned: number; retired: number };

/** One row per project type that has at least one live (not retired) project, with its open findings. Retired projects are not counted. */
export function estateByKind(reg: Registry, findings: Finding[]): KindRow[] {
  const kindOf = new Map(reg.projects.filter((p) => p.lifecycle !== "retired").map((p) => [p.slug, p.kind]));
  const rows = new Map<Kind, KindRow>();
  for (const p of reg.projects) {
    if (p.lifecycle === "retired") continue;
    const row = rows.get(p.kind) ?? { kind: p.kind, projects: 0, red: 0, amber: 0 };
    row.projects += 1;
    rows.set(p.kind, row);
  }
  for (const f of findings) {
    const kind = kindOf.get(f.projectSlug);
    const row = kind && rows.get(kind);
    if (!row) continue;
    if (f.colour === "red") row.red += 1;
    else if (f.colour === "amber") row.amber += 1;
  }
  return KINDS.flatMap((k) => (rows.has(k) ? [rows.get(k)!] : []));
}

export function lifecycleCounts(reg: Registry): Lifecycles {
  const c: Lifecycles = { active: 0, planned: 0, retired: 0 };
  for (const p of reg.projects) c[p.lifecycle] += 1;
  return c;
}
