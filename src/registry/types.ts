import type { Colour } from "@/src/status/types";

// These lists mirror the CHECK constraints in db/002_authority.sql and db/005_catalog_shape.sql; the database is the backstop.
// Values follow Backstage's vocabulary where one exists (relations, environments) so the registry exports without a translation table.
export const KINDS = ["boss", "hub", "spoke", "package", "shell-base", "app"] as const;
export const LIFECYCLES = ["planned", "active", "retired"] as const;
export const ENV_NAMES = ["development", "preview", "staging", "production", "ci"] as const;
export const DOMAIN_MODES = ["inprocess", "shadow", "remote"] as const;
export const RELATIONS = ["depends_on", "consumes_api", "has_part"] as const;
export const TIERS = ["foundation", "capability", "domain", "design", "governance", "product", "internal"] as const;
export const ASSIGN_ROLES = ["owner", "maintainer"] as const;

export type Kind = (typeof KINDS)[number];
export type Lifecycle = (typeof LIFECYCLES)[number];
export type EnvName = (typeof ENV_NAMES)[number];
export type DomainMode = (typeof DOMAIN_MODES)[number];
export type Relation = (typeof RELATIONS)[number];
export type Tier = (typeof TIERS)[number];
export type AssignRole = (typeof ASSIGN_ROLES)[number];

export type Project = { slug: string; name: string; kind: Kind; client: string | null; repo: string | null; lifecycle: Lifecycle; notes: string | null; ownerProject: string | null; path: string | null; ownerGroup: string | null; tier: Tier | null; annotations: Record<string, unknown> };
export type Group = { slug: string; name: string; parent: string | null };
export type Environment = { projectSlug: string; name: EnvName; cell: string | null; region: string | null; url: string | null };
export type Pin = { projectSlug: string; environment: EnvName; package: string; version: string };
export type Adoption = { projectSlug: string; environment: EnvName; domainMode: DomainMode };
export type Assignment = { id: string; projectSlug: string; assignee: string; role: AssignRole; assignedBy: string; assignedAt: Date };
export type ProjectRelation = { fromSlug: string; toSlug: string; relation: Relation };

export type Registry = {
  projects: Project[];
  environments: Environment[];
  pins: Pin[];
  adoption: Adoption[];
  assignments: Assignment[]; // active only
  relations: ProjectRelation[];
};

export type Finding = {
  projectSlug: string;
  environment: EnvName | null;
  kind: "pin" | "cell" | "owner";
  subject: string;
  colour: Colour;
  message: string;
};
