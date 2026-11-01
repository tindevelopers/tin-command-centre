import { ValidationError } from "@/src/registry/validate";
import { isTenantSlug } from "./host";

/**
 * Form input for the tenant and operator screens, checked before it reaches SQL. The database's constraints are the backstop;
 * these give a person a sentence they can act on instead of a constraint name.
 */
export const ISOLATIONS = ["shared", "dedicated"] as const;
export type Isolation = (typeof ISOLATIONS)[number];

export const OPERATOR_ROLES = ["viewer", "admin"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export type CreateTenantInput = { slug: string; name: string; isolation: Isolation; connectionRef: string | null };
export type InviteOperatorInput = { email: string; role: OperatorRole };

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** The NAME of a secret (an environment variable or Secret Manager entry), never its value. */
const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCreateTenant(f: FormData): CreateTenantInput {
  const slug = field(f, "slug").toLowerCase();
  const name = field(f, "name");
  const isolation = field(f, "isolation") || "shared";
  const connectionRef = field(f, "connectionRef");
  if (!isTenantSlug(slug)) throw new ValidationError("Slug: 1 to 30 lower-case letters, digits or hyphens, starting and ending with a letter or digit, and not a reserved word (admin, api, auth, control…).");
  if (name.length === 0 || name.length > 80) throw new ValidationError("Name: 1 to 80 characters.");
  if (!(ISOLATIONS as readonly string[]).includes(isolation)) throw new ValidationError("Isolation: shared or dedicated.");
  if (isolation === "dedicated" && !SECRET_NAME.test(connectionRef)) {
    throw new ValidationError("A dedicated tenant needs the NAME of the secret that will hold its connection string (for example TENANT_ACME_DATABASE_URL): upper-case letters, digits and underscores. Never the connection string itself.");
  }
  if (isolation === "shared" && connectionRef) throw new ValidationError("A shared tenant has no connection secret; leave it empty or choose dedicated.");
  return { slug, name, isolation: isolation as Isolation, connectionRef: isolation === "dedicated" ? connectionRef : null };
}

export function parseRetireTenant(f: FormData): { slug: string } {
  const slug = field(f, "slug").toLowerCase();
  if (!isTenantSlug(slug)) throw new ValidationError("Not a tenant slug.");
  return { slug };
}

export function parseInviteOperator(f: FormData): InviteOperatorInput {
  const email = field(f, "email").toLowerCase();
  const role = field(f, "role") || "viewer";
  if (!EMAIL.test(email) || email.length > 254) throw new ValidationError("Email: a valid address.");
  if (!(OPERATOR_ROLES as readonly string[]).includes(role)) throw new ValidationError("Role: viewer or admin.");
  return { email, role: role as OperatorRole };
}

export function parseOperatorRole(f: FormData): { userId: string; role: OperatorRole } {
  const userId = field(f, "userId");
  const role = field(f, "role");
  if (userId.length === 0 || userId.length > 255) throw new ValidationError("Not an operator.");
  if (!(OPERATOR_ROLES as readonly string[]).includes(role)) throw new ValidationError("Role: viewer or admin.");
  return { userId, role: role as OperatorRole };
}

export function parseOperatorId(f: FormData): { userId: string } {
  const userId = field(f, "userId");
  if (userId.length === 0 || userId.length > 255) throw new ValidationError("Not an operator.");
  return { userId };
}

/** The user_id an invited person holds until they first sign in; the real Neon Auth id replaces it then. */
export const pendingUserId = (email: string) => `pending:${email.toLowerCase()}`;
export const isPendingUserId = (userId: string) => userId.startsWith("pending:");
