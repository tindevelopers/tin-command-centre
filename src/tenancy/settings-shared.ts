import { MODULES, MODULE_IDS } from "@/config/modules";

/** What a tenant's console looks like: its brand and the modules in its menu. Plain data, safe to pass to a client component. */
export type TenantSettings = {
  brand: { name: string | null; accent: string | null; logoPath: string | null };
  /** Module ids that are on, always including the always-on ones. */
  modules: string[];
};

const ALWAYS = MODULES.filter((m) => m.always).map((m) => m.id);
const HEX = /^#[0-9a-f]{6}$/i;
const LOGO = /^\/[A-Za-z0-9._/-]{1,200}$/;

export const defaultSettings = (): TenantSettings => ({ brand: { name: null, accent: null, logoPath: null }, modules: [...MODULE_IDS] });

/**
 * The settings from a database row, validated again here. A field that is not exactly what the migration allows is dropped, and a
 * row that is not an object gives the defaults, so a bad row can only make a console plainer, never break it or inject markup.
 */
export function parseSettings(row: unknown): TenantSettings {
  const out = defaultSettings();
  if (typeof row !== "object" || row === null) return out;
  const r = row as Record<string, unknown>;
  if (typeof r.brand_name === "string" && r.brand_name.length >= 1 && r.brand_name.length <= 40 && !/\p{Cc}/u.test(r.brand_name)) out.brand.name = r.brand_name.trim() || null;
  if (typeof r.accent === "string" && HEX.test(r.accent)) out.brand.accent = r.accent.toLowerCase();
  if (typeof r.logo_path === "string" && LOGO.test(r.logo_path) && !r.logo_path.includes("//") && !r.logo_path.includes("..")) out.brand.logoPath = r.logo_path;
  if (Array.isArray(r.modules)) {
    const wanted = new Set(r.modules.filter((m): m is string => typeof m === "string"));
    out.modules = MODULE_IDS.filter((id) => ALWAYS.includes(id) || wanted.has(id));
  }
  return out;
}

/** The module that owns a route, or null for a route that belongs to none (sign-in, API). Longest matching prefix wins; "/" matches only itself. */
export function moduleForPath(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.paths) {
      const hit = p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/");
      if (hit && (!best || p.length > best.len)) best = { id: m.id, len: p.length };
    }
  }
  return best?.id ?? null;
}

export const pathAllowed = (settings: TenantSettings, pathname: string): boolean => {
  const id = moduleForPath(pathname);
  return id === null || settings.modules.includes(id);
};

type NavLike = { path?: string; subItems?: NavLike[] };

/** The menu a tenant gets: items whose module is off are removed, and a parent left with no children goes too. Pure; the input is not changed. */
export function filterNavigation<T extends NavLike>(items: T[], settings: TenantSettings): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (item.subItems) {
      const subItems = filterNavigation(item.subItems, settings);
      if (subItems.length > 0) out.push({ ...item, subItems });
    } else if (!item.path || pathAllowed(settings, item.path)) out.push(item);
  }
  return out;
}


/** The browser tab title and page description when a tenant has set no display name. */
export const DEFAULT_TITLE = "TIN Control Plane";
export const DEFAULT_DESCRIPTION = "What TIN runs, who owns it, and whether it matches what was declared";

/**
 * The document title for a tenant: its display name when it has one (so a white-labelled tenant never shows TIN in the tab),
 * otherwise the default. The name is already validated (at most 40 characters, no control characters) and Next escapes it.
 */
export const tabTitle = (settings: TenantSettings): string => settings.brand.name ?? DEFAULT_TITLE;

/** The description follows the same rule: a branded tenant's description does not name TIN. */
export const tabDescription = (settings: TenantSettings): string => (settings.brand.name ? `${settings.brand.name}: the registry of what runs, who owns it, and whether it matches what was declared` : DEFAULT_DESCRIPTION);
