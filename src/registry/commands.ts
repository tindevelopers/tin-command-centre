import type { Command } from "./validate";

export type Statement = { text: string; params: unknown[] };

/** The SQL for one registry command. All writes run as console_admin inside a transaction that sets console.actor (see db.ts). */
export function statementsFor(c: Command): Statement[] {
  switch (c.type) {
    case "upsertProject":
      return [{
        text: `INSERT INTO projects (slug, name, kind, client, repo, lifecycle, notes, owner_project, path, owner_group, tier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, client = EXCLUDED.client,
                 repo = EXCLUDED.repo, lifecycle = EXCLUDED.lifecycle, notes = EXCLUDED.notes, owner_project = EXCLUDED.owner_project, path = EXCLUDED.path, owner_group = EXCLUDED.owner_group, tier = EXCLUDED.tier, updated_at = now()`,
        params: [c.slug, c.name, c.kind, c.client, c.repo, c.lifecycle, c.notes, c.ownerProject, c.path, c.ownerGroup, c.tier],
      }];
    case "upsertEnvironment":
      return [{
        text: `INSERT INTO environments (project_slug, name, cell, region, url) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (tenant_id, project_slug, name) DO UPDATE SET cell = EXCLUDED.cell, region = EXCLUDED.region, url = EXCLUDED.url`,
        params: [c.slug, c.name, c.cell, c.region, c.url],
      }];
    case "setPin":
      return [{
        text: `INSERT INTO declared_pins (project_slug, environment, package, version) VALUES ($1,$2,$3,$4)
               ON CONFLICT (tenant_id, project_slug, environment, package) DO UPDATE SET version = EXCLUDED.version`,
        params: [c.slug, c.environment, c.package, c.version],
      }];
    case "removePin":
      return [{ text: "DELETE FROM declared_pins WHERE project_slug = $1 AND environment = $2 AND package = $3", params: [c.slug, c.environment, c.package] }];
    case "assign":
      // assigned_by is filled from the audited actor, not from form input.
      return [{
        text: `INSERT INTO assignments (project_slug, assignee, role, assigned_by) VALUES ($1,$2,$3, current_setting('console.actor'))
               ON CONFLICT (tenant_id, project_slug, assignee, role) WHERE removed_at IS NULL DO NOTHING`,
        params: [c.slug, c.assignee, c.role],
      }];
    case "unassign":
      return [{ text: "UPDATE assignments SET removed_at = now() WHERE id = $1 AND project_slug = $2 AND removed_at IS NULL", params: [c.id, c.slug] }];
    case "addRelation":
      return [{ text: "INSERT INTO project_relations (from_slug, to_slug, relation) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", params: [c.slug, c.to, c.relation] }];
    case "removeRelation":
      return [{ text: "DELETE FROM project_relations WHERE from_slug = $1 AND to_slug = $2 AND relation = $3", params: [c.slug, c.to, c.relation] }];
  }
}
