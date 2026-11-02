import { ALLOWED, HOLDER_LABEL, SCOPES } from "@/config/scopes";
import type { Holder } from "@/config/scopes";
import type { Colour } from "@/src/status/types";
import type { KeyRecord } from "./port";

/**
 * Keys and identities for the Consumers and keys page. Pure, so the page and its tests share it.
 *
 * An identity is one platform environment (`urn:tin:<platform>:<environment>`), Unkey's `externalId` shape and BOSS's
 * identityExternalId in the minting plan; its keys share its scopes and, later, its limits. Which rule a key is judged by comes
 * from its platform: `console` keys are the reader or an operator key, `tin` is the hub, anything else is a platform key.
 */
export type ScopeCheck = { ok: true } | { ok: false; reason: string };

export type KeyRow = KeyRecord & { identity: string; holder: Holder; check: ScopeCheck; colour: Colour };

export type IdentityRow = {
  identity: string;
  platform: string;
  environment: string;
  holder: Holder;
  keys: KeyRow[];
  active: number;
  scopes: string[];
  lastUsedAt: Date | null;
  /** Worst key colour: red when any active key breaks its scope rule, amber when a key has never been used, green otherwise. */
  colour: Colour;
  /** The registry project(s) whose `client` is this platform, so the page can link to them. */
  projects: string[];
};

export const identityOf = (platform: string, environment: string) => `urn:tin:${platform}:${environment}`;

export function holderOf(key: Pick<KeyRecord, "platform" | "scopes">): Holder {
  if (key.platform === "tin") return "tin-hub";
  if (key.platform !== "console") return "platform";
  // The console has two keys that must never mix: the reader (reports.read alone) and the operator (writes).
  return key.scopes.includes("boss.reports.read") ? "console-reader" : "console-operator";
}

/** The same rule as BOSS's minting script (config/scopes.ts): a non-empty subset for a platform or operator key, exactly the set for the reader and the hub. */
export function checkScopes(holder: Holder, scopes: string[]): ScopeCheck {
  if (scopes.length === 0) return { ok: false, reason: "No scopes." };
  const dup = scopes.find((s, i) => scopes.indexOf(s) !== i);
  if (dup) return { ok: false, reason: `Duplicate scope ${dup}.` };
  const known = new Set(SCOPES.map((s) => s.scope));
  const unknown = scopes.find((s) => !known.has(s));
  if (unknown) return { ok: false, reason: `Unknown scope ${unknown}.` };
  const rule = ALLOWED[holder];
  const outside = scopes.filter((s) => !rule.scopes.includes(s));
  if (outside.length > 0) return { ok: false, reason: `${HOLDER_LABEL[holder]} may not hold ${outside.join(", ")}.` };
  if (rule.exact && scopes.length !== rule.scopes.length) return { ok: false, reason: `${HOLDER_LABEL[holder]} takes exactly ${rule.scopes.join(", ")}.` };
  return { ok: true };
}

const isActive = (k: KeyRecord) => k.status === "active";

export function keyRows(keys: KeyRecord[]): KeyRow[] {
  return keys
    .map((k) => {
      const holder = holderOf(k);
      const check = checkScopes(holder, k.scopes);
      const colour: Colour = !isActive(k) ? "green" : !check.ok ? "red" : k.lastUsedAt === null ? "amber" : "green";
      return { ...k, identity: identityOf(k.platform, k.environment), holder, check, colour };
    })
    .sort((a, b) => a.identity.localeCompare(b.identity) || a.publicId.localeCompare(b.publicId));
}

const RANK: Record<Colour, number> = { red: 0, amber: 1, green: 2 };

/** One row per platform environment, from its keys. `projects` are the live registry projects whose client is the platform. */
export function identityRows(keys: KeyRecord[], projects: { slug: string; client: string | null; lifecycle: string }[] = []): IdentityRow[] {
  const rows = new Map<string, IdentityRow>();
  for (const k of keyRows(keys)) {
    const row = rows.get(k.identity) ?? {
      identity: k.identity, platform: k.platform, environment: k.environment, holder: k.holder, keys: [], active: 0, scopes: [], lastUsedAt: null, colour: "green" as Colour,
      projects: projects.filter((p) => p.lifecycle !== "retired" && p.client === k.platform).map((p) => p.slug).sort(),
    };
    row.keys.push(k);
    if (isActive(k)) {
      row.active += 1;
      for (const s of k.scopes) if (!row.scopes.includes(s)) row.scopes.push(s);
      if (k.lastUsedAt && (!row.lastUsedAt || k.lastUsedAt > row.lastUsedAt)) row.lastUsedAt = k.lastUsedAt;
    }
    rows.set(k.identity, row);
  }
  for (const row of rows.values()) {
    row.scopes.sort();
    const active = row.keys.filter(isActive);
    row.colour = active.length === 0 ? "amber" : active.map((k) => k.colour).sort((a, b) => RANK[a] - RANK[b])[0];
  }
  return [...rows.values()].sort((a, b) => RANK[a.colour] - RANK[b.colour] || a.identity.localeCompare(b.identity));
}

export type KeyTotals = { identities: number; keys: number; active: number; neverUsed: number; outsideRule: number; platforms: number };

export function keyTotals(rows: IdentityRow[]): KeyTotals {
  const all = rows.flatMap((r) => r.keys);
  const active = all.filter(isActive);
  return {
    identities: rows.length,
    keys: all.length,
    active: active.length,
    neverUsed: active.filter((k) => k.lastUsedAt === null).length,
    outsideRule: active.filter((k) => !k.check.ok).length,
    platforms: new Set(rows.filter((r) => r.holder === "platform").map((r) => r.platform)).size,
  };
}

export type KeyFilters = { holder: "" | Holder; status: "" | "active" | "other"; q: string };

const one = (p: Record<string, string | string[] | undefined>, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};

/** Reads the URL. Anything unrecognised is ignored rather than trusted. */
export function parseKeyFilters(p: Record<string, string | string[] | undefined>): KeyFilters {
  const holder = one(p, "holder");
  const status = one(p, "status");
  return {
    holder: (Object.keys(HOLDER_LABEL) as Holder[]).includes(holder as Holder) ? (holder as Holder) : "",
    status: status === "active" || status === "other" ? status : "",
    q: one(p, "q"),
  };
}

export function filterIdentityRows(rows: IdentityRow[], f: KeyFilters): IdentityRow[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) =>
    (!f.holder || r.holder === f.holder) &&
    (!f.status || (f.status === "active" ? r.active > 0 : r.keys.length > r.active)) &&
    (!q || r.identity.toLowerCase().includes(q) || r.scopes.some((s) => s.includes(q)) || r.keys.some((k) => k.publicId.toLowerCase().includes(q) || k.cell.toLowerCase().includes(q))));
}
