/**
 * The integrations this console can be given, by environment-variable NAME. Values are never read into a page, a log or an
 * error: each entry is judged present or absent and nothing more.
 *
 * One process serves every tenant today (interface strategy §6, P1), so every integration is deployment-scoped. The `scope`
 * field says what P4 changes: `tenant` integrations move into per-tenant settings (names only; secrets stay in the manager),
 * `deployment` ones stay with the process. This is the catalogue the Integrations page reads; `src/tenancy/admin.ts` keeps its
 * shorter list for the Tenants page.
 */
export type IntegrationGroup = "store" | "auth" | "boss" | "github" | "tenancy";
export type IntegrationScope = "deployment" | "tenant";

export type Integration = {
  id: string;
  group: IntegrationGroup;
  label: string;
  /** Every name must be set for the integration to be configured. */
  required: readonly string[];
  /** Names that refine it when set. */
  optional?: readonly string[];
  scope: IntegrationScope;
  /** What switches on when it is configured. */
  enables: string;
  /** Where it is used, for the link. */
  page: string | null;
  /** What the owner sets, and the rule it must obey. */
  setup: string;
  /** How absence shows: a page notice, a hidden button, a dash. */
  without: string;
};

export const GROUP_LABEL: Record<IntegrationGroup, string> = { store: "Status store", auth: "Sign-in", boss: "BOSS", github: "GitHub", tenancy: "Tenancy" };

export const INTEGRATIONS: readonly Integration[] = [
  { id: "store-read", group: "store", label: "Status store, read", required: ["CONSOLE_DATABASE_URL"], scope: "deployment", enables: "Every page that reads the registry, the collector's snapshots and the console's own records.", page: "/", setup: "The console_reader login (SELECT only). The console never writes observed state.", without: "Every page says the status store is not connected." },
  { id: "store-write", group: "store", label: "Registry writes", required: ["CONSOLE_ADMIN_DATABASE_URL"], scope: "deployment", enables: "Admin forms: projects, pins, owners, operators, tenants, and the console's records of hand-offs and proposals.", page: "/projects", setup: "The console_admin login. Every write runs with an audited actor; retire, never delete.", without: "The registry is read-only and the admin forms are hidden." },
  { id: "neon-auth", group: "auth", label: "Neon Auth", required: ["NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"], scope: "deployment", enables: "Sign-in, the session cookie, and the operator token forwarded to BOSS for operator routes.", page: "/operators", setup: "Managed Better Auth for the tin-ops-console project; the cookie secret is at least 32 characters.", without: "Nobody can sign in." },
  { id: "boss-reports", group: "boss", label: "BOSS reports", required: ["BOSS_API_URL", "BOSS_REPORTS_KEY"], scope: "tenant", enables: "Reports page, the Overview BOSS panel, declared-versus-reported on projects, and the deployed state of proposals.", page: "/boss/reports", setup: "The console's OWN spoke key with boss.reports.read as its only scope, minted by the owner in program tin. BOSS_API_URL is https (http only for localhost).", without: "Those panels say BOSS reports are not configured; nothing is shown as deployed." },
  { id: "boss-operator", group: "boss", label: "BOSS operator key", required: ["BOSS_API_URL", "BOSS_OPERATOR_KEY"], scope: "tenant", enables: "Send to BOSS on the Pin proposals page (autonomy class A1: an admin sends, every time).", page: "/boss/proposals", setup: "An operator spoke key for platform console with boss.pins.write, never mixed with boss.reports.read. BOSS also needs the signed-in person on its operator list.", without: "Drafts still build; the Send button stays off and says why." },
  { id: "boss-credentials", group: "boss", label: "BOSS credentials key", required: ["BOSS_API_URL", "BOSS_CREDENTIALS_KEY"], scope: "tenant", enables: "The Keys page: list BOSS's spoke keys (metadata only) and let an admin revoke one.", page: "/boss/keys", setup: "A key of its own with boss.credentials.write ONLY; it reaches every platform's keys, so it is never added to another key.", without: "The Keys page says keys are not configured." },
  { id: "agent", group: "github", label: "Fix with agent", required: ["AGENT_GITHUB_TOKEN"], scope: "tenant", enables: "Fix with agent on Drift: opens an issue an agent picks up. With pull-request and checks read, the platform PR and checks signals on Pin proposals.", page: "/drift", setup: "A fine-grained token with Issues read and write on the repositories the registry lists; Pull requests read and Checks read for the signals. Replaced by the tin-estate-agent App later.", without: "The button is hidden; the signals show a dash." },
  { id: "collector", group: "github", label: "Collect now", required: ["COLLECTOR_GITHUB_TOKEN"], optional: ["COLLECTOR_REPO", "COLLECTOR_WORKFLOW"], scope: "deployment", enables: "Collect now on the Collector page: dispatches the collector workflow, which records a run as collector_writer.", page: "/collector", setup: "A fine-grained token with Actions read and write on the collector repository (default tindevelopers/shell-base-github-registry, collect.yml).", without: "The button is hidden; the daily run still happens." },
  { id: "tenancy", group: "tenancy", label: "Tenant hosts", required: [], optional: ["CONTROL_BASE_DOMAIN", "DEFAULT_TENANT", "TENANT_OTHER_HOSTS"], scope: "deployment", enables: "Which tenant a request is for, from its Host header; whether unknown hosts fall back to the default tenant or are refused.", page: "/tenants", setup: "Defaults suit the single tin tenant. Set TENANT_OTHER_HOSTS=reject once tenant subdomains are live.", without: "Defaults apply: control.tinconnect.com is tin, other hosts fall back to it." },
];

export type IntegrationState = { integration: Integration; state: "configured" | "partial" | "not-set" | "defaults"; missing: string[]; set: string[] };

/** Judges each integration by the NAMES present in `env`. Never returns a value. */
export function integrationStates(env: Record<string, string | undefined> = process.env): IntegrationState[] {
  const has = (k: string) => Boolean(env[k]?.trim());
  return INTEGRATIONS.map((integration) => {
    const missing = integration.required.filter((k) => !has(k));
    const set = [...integration.required, ...(integration.optional ?? [])].filter(has);
    const state: IntegrationState["state"] =
      integration.required.length === 0 ? (set.length ? "configured" : "defaults") : missing.length === 0 ? "configured" : missing.length < integration.required.length ? "partial" : "not-set";
    return { integration, state, missing, set };
  });
}

/** Any variable with NEXT_PUBLIC_ in front of a server-only name is a leak: the value would be bundled into the browser. */
export function publicLeaks(env: Record<string, string | undefined> = process.env): string[] {
  const serverOnly = new Set(INTEGRATIONS.flatMap((i) => [...i.required, ...(i.optional ?? [])]));
  return Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && serverOnly.has(k.slice("NEXT_PUBLIC_".length))).sort();
}

/** What P4 will hold per tenant, from the catalogue: the tenant-scoped integrations, by name only. */
export const tenantScoped = () => INTEGRATIONS.filter((i) => i.scope === "tenant");
