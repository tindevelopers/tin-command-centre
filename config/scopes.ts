/**
 * BOSS credential scopes and who may hold them, as BOSS's minting script enforces them
 * (tin-boss-api scripts/mint-spoke-credential.ts and src/routes/*.ts at 84c47d5, 2026-10-31).
 *
 * A decision record, not telemetry: it changes when BOSS changes, in a reviewed commit. The page uses it to say what a key
 * is for and to flag a key whose scopes fall outside the rule for its holder. Isolation between platforms depends on these
 * rules: GET /v1/reports returns every platform's rows to any key holding boss.reports.read, so that scope is console-only.
 */
export type Holder = "platform" | "console-reader" | "console-operator" | "tin-hub";

export const HOLDER_LABEL: Record<Holder, string> = {
  platform: "Platform key",
  "console-reader": "Console reader",
  "console-operator": "Console operator",
  "tin-hub": "The tin hub",
};

export type ScopeRule = { scope: string; route: string; purpose: string; holders: Holder[] };

export const SCOPES: readonly ScopeRule[] = [
  { scope: "boss.reports.write", route: "POST /v1/reports", purpose: "A platform reports what it runs", holders: ["platform"] },
  { scope: "boss.pins.read", route: "GET /v1/pin-proposals/latest", purpose: "A platform pulls its latest pin proposal", holders: ["platform"] },
  { scope: "boss.knowledge.releases.read", route: "GET /v1/knowledge/releases", purpose: "A platform pulls signed knowledge releases", holders: ["platform"] },
  { scope: "boss.reports.read", route: "GET /v1/reports", purpose: "Read every platform's reports (cross-platform: console only, alone)", holders: ["console-reader"] },
  { scope: "boss.pins.write", route: "POST /v1/pin-proposals", purpose: "Propose pins to a platform", holders: ["console-operator"] },
  { scope: "boss.releases.write", route: "POST /v1/knowledge/releases", purpose: "Publish a signed knowledge release", holders: ["console-operator"] },
  { scope: "boss.knowledge.write", route: "POST /v1/knowledge/queue/…", purpose: "Accept or reject the review queue", holders: ["console-operator"] },
  { scope: "boss.session.issue", route: "POST /v1/session", purpose: "Issue claims tokens (the tin hub, exactly this scope)", holders: ["tin-hub"] },
];

/** Routes that exist in the contract but that the minting script issues no key for yet. Shown so nobody looks for a key that cannot exist. */
export const UNMINTED_SCOPES: readonly { scope: string; route: string }[] = [
  { scope: "boss.membership.read", route: "GET /v1/users/{id}/tenants · GET /v1/tenants/{id}/members" },
  { scope: "boss.jobs.membership-feed.run", route: "POST /v1/membership-feed/run" },
  { scope: "control-plane:access:read", route: "GET /v1/control-plane/access" },
];

/** The sets the script allows, per holder: a platform key is any non-empty subset; the console reader exactly one; the hub exactly one. */
export const ALLOWED: Record<Holder, { scopes: string[]; exact: boolean }> = {
  platform: { scopes: ["boss.reports.write", "boss.pins.read", "boss.knowledge.releases.read"], exact: false },
  "console-reader": { scopes: ["boss.reports.read"], exact: true },
  "console-operator": { scopes: ["boss.knowledge.write", "boss.releases.write", "boss.pins.write"], exact: false },
  "tin-hub": { scopes: ["boss.session.issue"], exact: true },
};

export const SCOPES_RECORDED_ON = "2026-10-31";
