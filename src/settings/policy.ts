import { ENV_NAMES, KINDS, LIFECYCLES, RELATIONS, TIERS } from "@/src/registry/types";
import { RESERVED_SLUGS, tenantConfig } from "@/src/tenancy/host";
import { COOLDOWN_MINUTES, RUNNING_WINDOW_MINUTES } from "@/src/status/collect";
import { MAX_PINS } from "@/src/boss/drafts";
import { TOPOLOGY_STATUSES } from "@/config/topology";

/**
 * The rules this console runs under, in one place: which are decision records (owner-approved text, changed by PR), which are
 * code constants (changed by PR, cited here from the code so the page cannot drift from what runs), and which are deployment
 * settings (environment, by name). Nothing on the Policy page is editable: a policy changes where it is recorded.
 */
export type PolicyKind = "decision-record" | "code" | "deployment";

export type PolicyRecord = {
  id: string;
  title: string;
  kind: PolicyKind;
  governs: string;
  /** Where the authoritative text lives. */
  recordedIn: string;
  approvedBy: string;
  changedBy: string;
  /** How a tenant or an operator can override it without a code change, if at all. */
  overridableBy: string;
  /** A page that shows it in full, when one exists. */
  page: string | null;
  /** The current values, for the page to list. Computed, never typed twice. */
  values: () => { label: string; value: string }[];
};

/** The owner gates: what the console and its agents never do (Standard §11, the repository CLAUDE.md). */
export const OWNER_GATES = [
  "merge or push to main",
  "publish a package or move a dist-tag",
  "apply a migration (db/** is applied by a person)",
  "deploy a cell",
  "create, rotate or print a secret",
  "change repository or registry settings",
  "delete, skip or weaken a test",
] as const;

const list = (xs: readonly string[]) => xs.join(", ");

export const POLICIES: readonly PolicyRecord[] = [
  {
    id: "topology", title: "Hub topology", kind: "decision-record",
    governs: "Which hubs exist, their layer and risk class, and which are planned, renamed, archived or shrunk.",
    recordedIn: "config/topology.ts (from tin-boss-api docs/strategy/2026-10-30-hub-topology-and-languages.md and the component register)",
    approvedBy: "owner", changedBy: "a PR to this repository", overridableBy: "a project's annotations tin.info/layer, tin.info/risk-class and tin.info/topology", page: "/packages",
    values: () => [{ label: "statuses", value: list(TOPOLOGY_STATUSES) }],
  },
  {
    id: "autonomy", title: "Autonomy classes", kind: "decision-record",
    governs: "What each agent task type may do (A0 observe, A1 propose, A2 merge on evidence, A3 act with rollback), spend caps, promotion and demotion, the never-above-A1 list.",
    recordedIn: "tin-programme policy/autonomy.yaml (harness template), mirrored in the console as a decision record",
    approvedBy: "owner", changedBy: "a PR to the policy file", overridableBy: "nothing: a class moves only when the owner edits the policy", page: "/automation/autonomy",
    values: () => [{ label: "today", value: "every type is A0 or A1; nothing merges itself until required checks are enforced (OD-1)" }],
  },
  {
    id: "support-windows", title: "Support windows", kind: "decision-record",
    governs: "How long the previous major of a hub package receives security fixes after the next major reaches latest.",
    recordedIn: "tin-programme policy/support-windows.yaml; the rule is the package standard §7.4 (proposed)",
    approvedBy: "owner", changedBy: "a PR to the policy file", overridableBy: "nothing", page: null,
    values: () => [{ label: "previous major", value: "security fixes for 6 months, as patches on release/<major>.x under the <major>-lts tag; afterwards the register flags platforms still on it and the harness opens an upgrade PR" }],
  },
  {
    id: "scopes", title: "BOSS scopes and who may hold them", kind: "decision-record",
    governs: "Which spoke scopes a platform key, the console's reader key, an operator key and the tin hub may carry, and that they are never mixed.",
    recordedIn: "tin-boss-api scripts/mint-spoke-credential.ts; mirrored in the console as config/scopes.ts with the Consumers and keys page",
    approvedBy: "owner", changedBy: "a PR to tin-boss-api", overridableBy: "nothing: minting is the owner's CLI", page: "/boss/keys",
    values: () => [
      { label: "platform keys", value: "any non-empty subset of boss.reports.write, boss.pins.read, boss.knowledge.releases.read" },
      { label: "console reader", value: "exactly boss.reports.read" },
      { label: "console operator", value: "a subset of boss.pins.write, boss.releases.write, boss.knowledge.write; never mixed with the reader scope" },
      { label: "console credentials", value: "boss.credentials.write, as a key of its own" },
      { label: "tin hub", value: "exactly boss.session.issue" },
    ],
  },
  {
    id: "tenancy", title: "Tenancy", kind: "deployment",
    governs: "Which tenant a request is for, which slugs are reserved, what an unknown host gets, and that every read and write is scoped by row-level security.",
    recordedIn: "db/006_tenants.sql, db/008_tenant_admin.sql, src/tenancy/host.ts; CONTROL_BASE_DOMAIN, DEFAULT_TENANT and TENANT_OTHER_HOSTS",
    approvedBy: "owner", changedBy: "a migration for the rules, the environment for the names", overridableBy: "nothing per tenant", page: "/tenants",
    values: () => {
      const cfg = tenantConfig();
      return [
        { label: "base domain", value: cfg.baseDomain },
        { label: "default tenant", value: cfg.defaultTenant },
        { label: "unknown hosts", value: cfg.otherHosts === "reject" ? "refused (404)" : "fall back to the default tenant" },
        { label: "reserved slugs", value: list(RESERVED_SLUGS) },
        { label: "isolation", value: "shared (row-level security) or dedicated (its own database, named by a secret's name; P5)" },
      ];
    },
  },
  {
    id: "access", title: "Access", kind: "code",
    governs: "Who may see and who may change: membership is per tenant, two roles, and the guards on operators.",
    recordedIn: "src/auth/access.ts, src/auth/operators.ts, db/006 console_operators",
    approvedBy: "owner", changedBy: "a PR to this repository", overridableBy: "nothing", page: "/operators",
    values: () => [
      { label: "roles", value: "viewer (read every page), admin (the forms and the buttons)" },
      { label: "guards", value: "nobody changes their own role or removes themself; the last active admin cannot be removed; removal is a timestamp, never a delete" },
      { label: "invites", value: "an invite is a pending row claimed on first sign-in with that address" },
    ],
  },
  {
    id: "registry", title: "Registry vocabulary", kind: "code",
    governs: "The kinds, lifecycles, environments, tiers and relations a project may declare; Backstage's words where one exists, so the catalog exports without a translation table.",
    recordedIn: "src/registry/types.ts, mirrored by the CHECK constraints in db/002 and db/005",
    approvedBy: "owner", changedBy: "a migration and the matching PR", overridableBy: "nothing; retire, never delete", page: "/projects",
    values: () => [
      { label: "kinds", value: list(KINDS) },
      { label: "lifecycles", value: list(LIFECYCLES) },
      { label: "environments", value: list(ENV_NAMES) },
      { label: "tiers", value: list(TIERS) },
      { label: "relations", value: list(RELATIONS) },
    ],
  },
  {
    id: "freshness", title: "Freshness and collection", kind: "code",
    governs: "When observed data counts as stale, and how often a collection may be started by hand.",
    recordedIn: "src/status/rules.ts, src/status/collect.ts",
    approvedBy: "owner", changedBy: "a PR to this repository", overridableBy: "nothing", page: "/collector",
    values: () => [
      { label: "freshness", value: "green under 26 hours, amber to 50 hours, red beyond or never" },
      { label: "collect now", value: `refused while a run is marked running (${RUNNING_WINDOW_MINUTES} min window) or one started under ${COOLDOWN_MINUTES} minutes ago` },
    ],
  },
  {
    id: "boss-readers", title: "BOSS readers and proposals", kind: "code",
    governs: "How the console talks to BOSS: bounded, fail-closed reads with fixed error text, and proposals a person sends.",
    recordedIn: "src/boss/reports.ts, src/boss/propose.ts, src/boss/drafts.ts, src/boss/credentials.ts",
    approvedBy: "owner", changedBy: "a PR to this repository", overridableBy: "nothing", page: "/boss/proposals",
    values: () => [
      { label: "reads", value: "server-side only, https, 3 s budget, at most 1,000 report rows, nothing BOSS sends is interpolated" },
      { label: "proposals", value: `at most ${MAX_PINS} pins each, re-derived from the registry when sent, autonomy class A1, recorded locally; BOSS is the authority` },
      { label: "keys", value: "metadata only, never a secret; revoking is final and an admin does it" },
    ],
  },
];

export const KIND_LABEL: Record<PolicyKind, string> = { "decision-record": "decision record", code: "code constant", deployment: "deployment setting" };
