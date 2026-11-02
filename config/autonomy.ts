/**
 * Autonomy policy: which agent task types may do what (central nervous system strategy §6; `policy/autonomy.yaml` in the harness
 * templates, 2026-10-29). A decision record, like `config/topology.ts`: it is read, never edited from a page. When `tin-programme`
 * publishes `policy/autonomy.yaml`, that file replaces this one; until then this is the owner-approved text, copied by hand.
 *
 * The console's own buttons run under these classes too (`CONSOLE_ACTIONS`), so the Autonomy page can say what each one is allowed
 * to do and why nothing here merges anything.
 */
export const AUTONOMY_CLASSES = ["A0", "A1", "A2", "A3"] as const;
export type AutonomyClass = (typeof AUTONOMY_CLASSES)[number];

export type ClassDefinition = {
  name: string;
  may: string[];
  merge: string;
  examples: string;
};

export const CLASSES: Record<AutonomyClass, ClassDefinition> = {
  A0: { name: "observe", may: ["read", "comment", "open an issue"], merge: "nothing to merge", examples: "Reviewer, Migration Auditor" },
  A1: { name: "propose", may: ["read", "comment", "open an issue", "open a draft PR on an agent/* branch"], merge: "a person merges (today's X-gates)", examples: "most fixes and upgrades at the start" },
  A2: { name: "merge on evidence", may: ["everything in A1", "mark the PR ready"], merge: "automatic when every required check passes and the policy allows the type; a person samples 1 in 5 after merge", examples: "patch upgrades of non-security packages with green canaries; regenerated docs sections; evidence PRs" },
  A3: { name: "act with rollback", may: ["run an operational action that has an automatic rollback"], merge: "automatic, logged, time-boxed; needs SLO budget remaining and an owner listed", examples: "not used until OD-1 and SLOs exist" },
};

/** What a task type's record must show before the owner may move it up one class. */
export const PROMOTE_WHEN = {
  consecutiveMergedWithoutHumanChanges: 20,
  revertsLast30Days: 0,
  reviewerHumanAgreementKappaMin: 0.6,
} as const;

/** It moves down automatically, for this long, after any of these. */
export const DEMOTE_ON = ["reverted", "incident"] as const;
export const DEMOTE_FOR_DAYS = 30;

/** Never above A1, whatever the record says. Paths are globs the workflow enforces; topics are what a reviewer reads for. */
export const NEVER_ABOVE_A1 = {
  paths: ["**/migrations/**", ".github/workflows/**", "release-targets.json", "**/api/*.api.md", "**/auth/**", "**/*rls*", "src/routes/**", "cells/**"],
  topics: ["auth", "tenant-isolation", "rls", "crypto", "secrets", "migrations", "release-config", "public-api-major"],
} as const;

/** Hard limits for every agent, enforced in the workflow rather than the prompt. */
export const LIMITS = {
  pushBranchPrefix: "agent/",
  forbiddenPermissions: ["contents: write on the default branch", "packages: write", "deployments", "secrets", "administration"],
  forbiddenSecrets: ["NODE_AUTH_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "*_DATABASE_URL", "*_PRIVATE_JWK"],
  allowedInInstallStepOnly: ["PACKAGES_READ_TOKEN"],
  maxFilesPerPr: 25,
  oneRepositoryPerPr: true,
} as const;

export type TaskType = {
  type: string;
  class: AutonomyClass;
  capUsd: number;
  note?: string;
  /** True when the type's subject is on the never-above-A1 list, so no record can promote it. */
  cappedAtA1?: boolean;
};

export const TASK_TYPES: readonly TaskType[] = [
  { type: "docs.generated-section", class: "A1", capUsd: 2, note: "candidate for A2 first" },
  { type: "release.evidence-pr", class: "A1", capUsd: 2 },
  { type: "upgrade.patch.non-security", class: "A1", capUsd: 5, note: "candidate for A2 once canaries exist" },
  { type: "upgrade.minor", class: "A1", capUsd: 5 },
  { type: "upgrade.major", class: "A1", capUsd: 15, note: "never auto-merges", cappedAtA1: true },
  { type: "ci.fix", class: "A1", capUsd: 10 },
  { type: "ci.flaky-quarantine", class: "A1", capUsd: 3 },
  { type: "security.advisory-fix", class: "A1", capUsd: 10 },
  { type: "hygiene.metadata", class: "A1", capUsd: 3 },
  { type: "review.cross-family", class: "A0", capUsd: 3 },
  { type: "migration.audit", class: "A0", capUsd: 2 },
  { type: "learning.rule-proposal", class: "A1", capUsd: 5 },
];

export const taskType = (type: string): TaskType | undefined => TASK_TYPES.find((t) => t.type === type);

/** The task type a "Fix with agent" hand-off runs as, from the size of the step. Security advisories are not detected here. */
export function upgradeTaskType(bump: "major" | "minor" | "patch"): string {
  return bump === "major" ? "upgrade.major" : bump === "minor" ? "upgrade.minor" : "upgrade.patch.non-security";
}

/** What the console itself can start, and the class each action runs under. None of them merges or deploys. */
export type ConsoleAction = { id: string; title: string; class: AutonomyClass; what: string; records: string; page: string };

export const CONSOLE_ACTIONS: readonly ConsoleAction[] = [
  { id: "agent", title: "Fix with agent", class: "A1", what: "Opens an issue that asks an agent for a draft PR; a person merges and then sets the declared pin here.", records: "agent_runs", page: "/drift" },
  { id: "propose", title: "Send pin proposal to BOSS", class: "A1", what: "An admin sends; BOSS records; the platform's pin-bump job opens its own PR and its CI is the gate.", records: "pin_proposals", page: "/boss/proposals" },
  { id: "collect", title: "Collect now", class: "A0", what: "Starts the collector workflow, which reads and records; it changes nothing it observes.", records: "collector_runs", page: "/collector" },
];

/** The prerequisite the strategy names for anything above A1. */
export const A2_PREREQUISITE = "A2 needs required checks that GitHub actually enforces (OD-1, the plan upgrade). Without it the owner is the only gate and everything stays A1.";
