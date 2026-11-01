import { ASSIGN_ROLES, ENV_NAMES, KINDS, LIFECYCLES, RELATIONS, TIERS } from "./types";
import type { AssignRole, EnvName, Kind, Lifecycle, Relation, Tier } from "./types";

/** A message that is safe to show the operator. Anything else is reported generically. */
export class ValidationError extends Error {}

export type Command =
  | { type: "upsertProject"; slug: string; name: string; kind: Kind; client: string | null; repo: string | null; lifecycle: Lifecycle; notes: string | null; ownerProject: string | null; path: string | null; ownerGroup: string | null; tier: Tier | null }
  | { type: "upsertEnvironment"; slug: string; name: EnvName; cell: string | null; region: string | null; url: string | null }
  | { type: "setPin"; slug: string; environment: EnvName; package: string; version: string }
  | { type: "removePin"; slug: string; environment: EnvName; package: string }
  | { type: "assign"; slug: string; assignee: string; role: AssignRole }
  | { type: "unassign"; slug: string; id: string }
  | { type: "addRelation"; slug: string; to: string; relation: Relation }
  | { type: "removeRelation"; slug: string; to: string; relation: Relation };

type Form = { get(name: string): unknown };

const text = (f: Form, k: string) => String(f.get(k) ?? "").trim();
const required = (f: Form, k: string, label: string) => {
  const v = text(f, k);
  if (!v) throw new ValidationError(`${label} is required.`);
  return v;
};
const optional = (f: Form, k: string) => text(f, k) || null;
const oneOf = <T extends string>(f: Form, k: string, allowed: readonly T[], label: string): T => {
  const v = text(f, k);
  if (!(allowed as readonly string[]).includes(v)) throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}.`);
  return v as T;
};
const optionalOneOf = <T extends string>(f: Form, k: string, allowed: readonly T[], label: string): T | null => (text(f, k) ? oneOf(f, k, allowed, label) : null);
const slug = (f: Form, k = "slug", label = "Project") => {
  const v = required(f, k, label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(v)) throw new ValidationError(`${label} id may only use lower-case letters, digits and hyphens.`);
  return v;
};
/** A relative folder inside the repo: no leading slash, no "..", no odd characters. */
const optionalPath = (f: Form) => {
  const v = optional(f, "path")?.replace(/\/+$/, "") ?? null;
  if (v && (!/^[A-Za-z0-9_.@-]+(\/[A-Za-z0-9_.@-]+)*$/.test(v) || v.split("/").includes(".."))) throw new ValidationError("Path must be a folder inside the repo, like apps/ops.");
  return v;
};
const optionalSlug = (f: Form, k: string, label: string) => {
  const v = optional(f, k);
  if (v && !/^[a-z0-9][a-z0-9-]*$/.test(v)) throw new ValidationError(`${label} id may only use lower-case letters, digits and hyphens.`);
  return v;
};
const email = (f: Form, k: string) => {
  const v = required(f, k, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError("Enter a valid email address.");
  return v;
};
const url = (f: Form, k: string) => {
  const v = optional(f, k);
  if (v && !/^https:\/\/\S+$/.test(v)) throw new ValidationError("URL must start with https://.");
  return v;
};
const exactVersion = (f: Form, k: string) => {
  const v = required(f, k, "Version");
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) throw new ValidationError("Version must be exact, like 1.2.0 (no ranges).");
  return v;
};

export function parseCommand(type: Command["type"], f: Form): Command {
  switch (type) {
    case "upsertProject":
      return { type, slug: slug(f), name: required(f, "name", "Name"), kind: oneOf(f, "kind", KINDS, "Kind"), client: optional(f, "client"), repo: optional(f, "repo"), lifecycle: oneOf(f, "lifecycle", LIFECYCLES, "Lifecycle"), notes: optional(f, "notes"), ownerProject: optionalSlug(f, "ownerProject", "Owning project"), path: optionalPath(f), ownerGroup: optionalSlug(f, "ownerGroup", "Owning group"), tier: optionalOneOf(f, "tier", TIERS, "Tier") };
    case "upsertEnvironment":
      return { type, slug: slug(f), name: oneOf(f, "name", ENV_NAMES, "Environment"), cell: optional(f, "cell"), region: optional(f, "region"), url: url(f, "url") };
    case "setPin":
      return { type, slug: slug(f), environment: oneOf(f, "environment", ENV_NAMES, "Environment"), package: required(f, "package", "Package"), version: exactVersion(f, "version") };
    case "removePin":
      return { type, slug: slug(f), environment: oneOf(f, "environment", ENV_NAMES, "Environment"), package: required(f, "package", "Package") };
    case "assign":
      return { type, slug: slug(f), assignee: email(f, "assignee"), role: oneOf(f, "role", ASSIGN_ROLES, "Role") };
    case "unassign": {
      const id = required(f, "id", "Assignment");
      if (!/^\d+$/.test(id)) throw new ValidationError("Unknown assignment.");
      return { type, slug: slug(f), id };
    }
    case "addRelation":
    case "removeRelation": {
      const to = slug(f, "to", "Related project");
      const s = slug(f);
      if (to === s) throw new ValidationError("A project cannot relate to itself.");
      return { type, slug: s, to, relation: oneOf(f, "relation", RELATIONS, "Relation") };
    }
  }
}
