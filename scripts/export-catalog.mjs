// Writes the declared registry as a Backstage catalog: one YAML file per entity plus all.yaml (a Location).
// Usage: CONSOLE_DATABASE_URL=... node --experimental-strip-types scripts/export-catalog.mjs [outDir]
// Or, without a database: node --experimental-strip-types scripts/export-catalog.mjs [outDir] --from registry.json
// The mapping lives in src/registry/catalog.ts so a later Backstage EntityProvider can call the same function in-process.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileName, locationEntity, toCatalogEntities, toYaml } from "../src/registry/catalog.ts";

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
const outDir = args.find((a, i) => !a.startsWith("--") && i !== fromIdx + 1) ?? "catalog";

async function loadFromDatabase() {
  const url = process.env.CONSOLE_DATABASE_URL;
  if (!url) throw new Error("Set CONSOLE_DATABASE_URL (read-only login) or pass --from registry.json.");
  const { neon } = await import("@neondatabase/serverless");
  const q = (text) => neon(url).query(text);
  // Same shape as loadRegistry() in src/registry/db.ts; only the fields the export reads.
  const [projects, environments, assignments, relations, groups] = await Promise.all([
    q("select * from projects order by slug"),
    q("select * from environments order by project_slug, name"),
    q("select * from assignments where removed_at is null order by assigned_at"),
    q("select * from project_relations order by from_slug, to_slug"),
    q("select slug, name, parent from groups order by slug"),
  ]);
  return {
    registry: {
      projects: projects.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, client: r.client, repo: r.repo, lifecycle: r.lifecycle, notes: r.notes, ownerProject: r.owner_project ?? null, path: r.path ?? null, ownerGroup: r.owner_group ?? null, tier: r.tier ?? null, annotations: r.annotations ?? {} })),
      environments: environments.map((r) => ({ projectSlug: r.project_slug, name: r.name, cell: r.cell, region: r.region, url: r.url })),
      pins: [],
      adoption: [],
      assignments: assignments.map((r) => ({ id: String(r.id), projectSlug: r.project_slug, assignee: r.assignee, role: r.role, assignedBy: r.assigned_by, assignedAt: new Date(r.assigned_at) })),
      relations: relations.map((r) => ({ fromSlug: r.from_slug, toSlug: r.to_slug, relation: r.relation })),
    },
    groups: groups.map((r) => ({ slug: r.slug, name: r.name, parent: r.parent ?? null })),
  };
}

const { registry, groups } = fromFile ? JSON.parse(readFileSync(fromFile, "utf8")) : await loadFromDatabase();
const { entities, warnings } = toCatalogEntities(registry, groups);
mkdirSync(outDir, { recursive: true });
for (const e of entities) writeFileSync(join(outDir, fileName(e)), toYaml(e));
writeFileSync(join(outDir, "all.yaml"), toYaml(locationEntity(entities)));
for (const w of warnings) console.warn(`warning: ${w}`);
console.log(`wrote ${entities.length} entities and all.yaml to ${outDir}`);
