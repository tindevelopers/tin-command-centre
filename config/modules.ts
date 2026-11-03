/**
 * The console's modules: what a tenant can have in its menu. A module owns route prefixes; a tenant's settings list the module ids
 * it uses (db/011_tenant_settings.sql). Always-on modules cannot be switched off, so no tenant can lock itself out.
 *
 * This decides what a tenant SEES. It is not access control: roles, BOSS scopes and row-level security decide what a person may do.
 */
export type ModuleDef = { id: string; label: string; paths: readonly string[]; always?: true };

export const MODULES: readonly ModuleDef[] = [
  { id: "overview", label: "Overview", paths: ["/"], always: true },
  { id: "operators", label: "Operators", paths: ["/operators"], always: true },
  { id: "projects", label: "Projects", paths: ["/projects"] },
  { id: "packages", label: "Hubs and packages", paths: ["/packages"] },
  { id: "cells", label: "Cells", paths: ["/cells"] },
  { id: "drift", label: "Drift", paths: ["/drift"] },
  { id: "keys", label: "Consumers and keys", paths: ["/keys"] },
  { id: "boss", label: "BOSS", paths: ["/boss"] },
  { id: "automation", label: "Automation", paths: ["/automation"] },
  { id: "collector", label: "Collector", paths: ["/collector"] },
  { id: "settings", label: "Settings", paths: ["/tenants", "/settings"] },
];

export const MODULE_IDS: readonly string[] = MODULES.map((m) => m.id);
