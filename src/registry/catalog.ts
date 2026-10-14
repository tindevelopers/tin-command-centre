import type { Group, Project, Registry } from "./types";

// Declared registry -> Backstage catalog entities (strategy 2026-10-12, section 4, phase 1).
// Pure: no I/O, so the same function serves the export script now and an EntityProvider later.
// Values follow Backstage (kinds, relations, lifecycle); column names stay ours and are renamed here only.

export type Entity = {
  apiVersion: "backstage.io/v1alpha1";
  kind: "Component" | "System" | "Domain" | "Group" | "User" | "Location";
  metadata: { name: string; title?: string; description?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
  spec: Record<string, unknown>;
};

export type CatalogExport = { entities: Entity[]; warnings: string[] };

export const UNOWNED = "unowned";
const NAME = /^[a-z0-9]([a-z0-9._-]{0,61}[a-z0-9])?$/;
const LIFECYCLE = { planned: "experimental", active: "production", retired: "deprecated" } as const;

type Ref = { kind: Entity["kind"]; name: string };
const refOf = (e: Ref) => `${e.kind.toLowerCase()}:default/${e.name}`;

/** The Backstage kind and Component type a project becomes. Hubs and shell-bases own packages, so they are Systems. */
function shape(p: Project): { kind: "Component" | "System"; type?: string } {
  switch (p.kind) {
    case "hub":
    case "shell-base":
      return { kind: "System" };
    case "package":
      return { kind: "Component", type: "library" };
    case "app":
      return { kind: "Component", type: "website" };
    case "boss":
    case "spoke":
      return { kind: "Component", type: "service" };
  }
}

const userName = (email: string) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export function toCatalogEntities(registry: Registry, groups: Group[]): CatalogExport {
  const warnings: string[] = [];
  const bySlug = new Map(registry.projects.map((p) => [p.slug, p]));
  const refs = new Map<string, Ref>(registry.projects.map((p) => [p.slug, { kind: shape(p).kind, name: p.slug }]));
  const groupSlugs = new Set(groups.map((g) => g.slug));
  const users = new Set<string>();

  const ownerOf = (p: Project): string => {
    if (p.ownerGroup) return refOf({ kind: "Group", name: p.ownerGroup });
    const parent = p.ownerProject ? bySlug.get(p.ownerProject) : undefined;
    if (parent?.ownerGroup) return refOf({ kind: "Group", name: parent.ownerGroup });
    const person = registry.assignments.find((a) => a.projectSlug === p.slug && a.role === "owner");
    if (person) {
      const name = userName(person.assignee);
      if (NAME.test(name)) {
        users.add(name);
        return refOf({ kind: "User", name });
      }
    }
    warnings.push(`${p.slug}: no owner group, owning project or owner assignment; exported as group:default/${UNOWNED}`);
    return refOf({ kind: "Group", name: UNOWNED });
  };

  const entities: Entity[] = [];

  for (const p of registry.projects) {
    if (!NAME.test(p.slug)) {
      warnings.push(`${p.slug}: not a valid Backstage name (63 characters of a-z 0-9 . _ -); skipped`);
      continue;
    }
    const { kind, type } = shape(p);
    const annotations: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.annotations ?? {})) if (typeof v === "string") annotations[k] = v;
    if (p.repo) annotations["github.com/project-slug"] = p.repo;
    if (p.path) annotations["tin.info/path"] = p.path;
    const envs = registry.environments.filter((e) => e.projectSlug === p.slug).map((e) => e.name);
    if (envs.length > 0) annotations["tin.info/environments"] = envs.join(",");

    const spec: Record<string, unknown> = { owner: ownerOf(p), lifecycle: LIFECYCLE[p.lifecycle] };
    if (type) spec.type = type;
    if (p.tier && kind === "System") spec.domain = p.tier; // Components reach the Domain through their System

    const owning = p.ownerProject && p.ownerProject !== p.slug ? refs.get(p.ownerProject) : undefined;
    if (kind === "Component" && owning?.kind === "System") spec.system = owning.name;

    // Relations. depends_on and consumes_api become dependsOn / consumesApis; has_part is the inverse of a System's membership.
    const outgoing = registry.relations.filter((r) => r.fromSlug === p.slug);
    const dependsOn = outgoing.filter((r) => r.relation === "depends_on" && refs.has(r.toSlug)).map((r) => refOf(refs.get(r.toSlug)!));
    const consumes = outgoing.filter((r) => r.relation === "consumes_api" && refs.has(r.toSlug)).map((r) => refOf(refs.get(r.toSlug)!));
    if (kind === "Component" && dependsOn.length > 0) spec.dependsOn = dependsOn;
    if (kind === "Component" && consumes.length > 0) {
      // consumesApis targets API entities. The registry holds no API definitions yet (they come from each cell's openapi.json),
      // so keep the fact as dependsOn plus a label rather than dangle a reference.
      spec.dependsOn = [...((spec.dependsOn as string[] | undefined) ?? []), ...consumes];
      annotations["tin.info/consumes-api"] = outgoing.filter((r) => r.relation === "consumes_api").map((r) => r.toSlug).join(",");
    }
    if (kind === "System" && dependsOn.length + consumes.length > 0) {
      annotations["tin.info/depends-on"] = [...outgoing.filter((r) => r.relation !== "has_part")].map((r) => r.toSlug).join(",");
    }
    for (const r of outgoing.filter((x) => x.relation === "has_part")) {
      const target = refs.get(r.toSlug);
      if (kind === "System" && target?.kind === "Component") continue; // expressed on the child as spec.system below
      annotations["tin.info/has-part"] = [annotations["tin.info/has-part"], r.toSlug].filter(Boolean).join(",");
    }

    entities.push({
      apiVersion: "backstage.io/v1alpha1",
      kind,
      metadata: {
        name: p.slug,
        title: p.name,
        ...(p.notes ? { description: p.notes } : {}),
        labels: { "tin.info/kind": p.kind, ...(p.client ? { "tin.info/client": p.client } : {}), ...(p.tier ? { "tin.info/tier": p.tier } : {}) },
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
      },
      spec,
    });
  }

  // has_part from a System to a Component sets that Component's system, unless the owning project already did.
  for (const r of registry.relations.filter((x) => x.relation === "has_part")) {
    const parent = refs.get(r.fromSlug);
    const child = entities.find((e) => e.metadata.name === r.toSlug && e.kind === "Component");
    if (parent?.kind === "System" && child && child.spec.system === undefined) child.spec.system = parent.name;
  }

  // Domains: one per tier that a System uses.
  const tiers = [...new Set(registry.projects.filter((p) => p.tier && shape(p).kind === "System").map((p) => p.tier!))].sort();
  for (const tier of tiers) {
    entities.push({
      apiVersion: "backstage.io/v1alpha1",
      kind: "Domain",
      metadata: { name: tier, title: `Tier: ${tier}` },
      spec: { owner: refOf({ kind: "Group", name: groupSlugs.has("tin-platform") ? "tin-platform" : UNOWNED }) },
    });
  }

  // Groups, with the children Backstage requires.
  const usedGroups = new Set(groupSlugs);
  for (const e of entities) {
    const owner = e.spec.owner;
    if (typeof owner === "string" && owner === refOf({ kind: "Group", name: UNOWNED })) usedGroups.add(UNOWNED);
  }
  for (const g of groups) {
    entities.push({
      apiVersion: "backstage.io/v1alpha1",
      kind: "Group",
      metadata: { name: g.slug, title: g.name },
      spec: { type: "team", ...(g.parent ? { parent: g.parent } : {}), children: groups.filter((c) => c.parent === g.slug).map((c) => c.slug).sort() },
    });
  }
  if (usedGroups.has(UNOWNED) && !groupSlugs.has(UNOWNED)) {
    entities.push({ apiVersion: "backstage.io/v1alpha1", kind: "Group", metadata: { name: UNOWNED, title: "Unowned (fix in the console)" }, spec: { type: "team", children: [] } });
  }
  for (const name of [...users].sort()) {
    entities.push({ apiVersion: "backstage.io/v1alpha1", kind: "User", metadata: { name }, spec: { memberOf: [] } });
  }

  for (const g of groups) if (g.parent && !groupSlugs.has(g.parent)) warnings.push(`group ${g.slug}: parent ${g.parent} is not a declared group`);

  entities.sort((a, b) => fileName(a).localeCompare(fileName(b)));
  return { entities, warnings };
}

export const fileName = (e: Entity) => `${e.kind.toLowerCase()}-${e.metadata.name}.yaml`;

/** One Location that lists every entity file; Backstage reads this single URL. */
export function locationEntity(entities: Entity[]): Entity {
  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "Location",
    metadata: { name: "tin-catalog", description: "Generated from the TIN Command Center registry. Do not edit by hand." },
    spec: { targets: entities.map((e) => `./${fileName(e)}`) },
  };
}

// Minimal YAML writer for the shapes above (strings, string lists, nested maps). Strings are always double-quoted JSON, which is valid YAML.
function emit(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "\n" + value.map((v) => `${pad}- ${emit(v, indent + 1).trimStart()}`).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return "\n" + entries.map(([k, v]) => `${pad}${JSON.stringify(k)}:${scalarOrBlock(v, indent + 1)}`).join("\n");
  }
  return JSON.stringify(value);
}
const scalarOrBlock = (v: unknown, indent: number) => {
  const out = emit(v, indent);
  return out.startsWith("\n") ? out : ` ${out}`;
};

export function toYaml(entity: Entity): string {
  const body = Object.entries(entity)
    .map(([k, v]) => `${k}:${scalarOrBlock(v, 1)}`)
    .join("\n");
  return `${body}\n`;
}
