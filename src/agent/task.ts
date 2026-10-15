import { compareVersions, parseVersion } from "@/src/registry/drift";

export type AgentTask = { repo: string; title: string; body: string; labels: string[] };

export type PinTaskInput = {
  repo: string;
  /** Folder inside the repo, from the registry; null when not recorded. */
  path: string | null;
  project: string;
  environment: string;
  pkg: string;
  declared: string;
  latest: string;
  /** When the collector last observed the package. */
  observedAt: Date | null;
  /** Repo that publishes the package, from the collector. */
  packageRepo: string | null;
  /** Command Center origin, e.g. https://command.tinconnect.com; null omits the links. */
  origin: string | null;
  /** Other live projects declaring the same package behind the latest version. */
  alsoBehind: { slug: string; environment: string; version: string }[];
  requestedBy: string;
};

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const validRepo = (s: string | null | undefined): s is string => !!s && REPO.test(s);

/** major / minor / patch step from declared to latest, or null when either is not an exact version. */
export function bumpSize(declared: string, latest: string): "major" | "minor" | "patch" | null {
  const d = parseVersion(declared);
  const l = parseVersion(latest);
  if (!d || !l || compareVersions(d, l) >= 0) return null;
  return d.core[0] < l.core[0] ? "major" : d.core[1] < l.core[1] ? "minor" : "patch";
}

export const issueTitle = (i: Pick<PinTaskInput, "pkg" | "declared" | "latest" | "project" | "environment">) =>
  `Upgrade ${i.pkg} ${i.declared} to ${i.latest} (${i.project}, ${i.environment})`;

/**
 * The work order, written as a ticket: where the code is, the evidence behind it, what to do, and when it is done.
 * It asks for a draft PR only: a person merges, and the console's declared pin is changed afterwards, so the registry
 * stays the authority on what should be running.
 */
export function buildPinTask(i: PinTaskInput): AgentTask {
  const size = bumpSize(i.declared, i.latest);
  if (!size) throw new Error(`${i.pkg} ${i.declared} is not behind ${i.latest}.`);
  const where = i.path
    ? `\`${i.path}\` (from the registry). Update the dependency in \`${i.path}/package.json\`, and in any workspace package that app depends on and that declares it too.`
    : "Not recorded in the registry. Find the app for this project by name under `apps/`, then update the dependency in its `package.json` and in any workspace package it depends on that declares it too.";
  const links = i.origin
    ? [`- Project in the console: ${i.origin}/projects/${i.project}`, `- Drift view: ${i.origin}/drift?q=${encodeURIComponent(i.pkg)}`]
    : [];
  const pkgLinks = i.packageRepo ? [`- Package source: https://github.com/${i.packageRepo} (releases: https://github.com/${i.packageRepo}/releases)`] : [];
  const others = i.alsoBehind.filter((o) => !(o.slug === i.project && o.environment === i.environment));
  const careful = size === "major"
    ? "This is a **major** upgrade. Read the release notes first, list the breaking changes that affect this app in the PR description, and fix every call site."
    : `This is a ${size} upgrade and should be low risk. Still run every check below.`;

  return {
    repo: i.repo,
    labels: ["agent", "dependencies"],
    title: issueTitle(i),
    body: [
      `@claude Upgrade \`${i.pkg}\` from \`${i.declared}\` to \`${i.latest}\` for \`${i.project}\` (${i.environment}).`,
      "",
      "## Where this lives",
      `- Repository: ${i.repo}`,
      `- App folder: ${where}`,
      "",
      "## Evidence",
      `- Declared in the TIN Command Center (the registry is the source of truth): \`${i.declared}\``,
      `- Latest published: \`${i.latest}\` (${size} bump)${i.observedAt ? `, observed ${i.observedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`,
      ...pkgLinks,
      ...links,
      others.length
        ? `- Also behind on this package: ${others.map((o) => `${o.slug} (${o.environment}, ${o.version})`).join(", ")}. **Do not change those here**; each has its own ticket.`
        : "- No other project is behind on this package.",
      "",
      "## What to do",
      careful,
      "",
      "## Done when",
      "- [ ] Only this app's dependency on this package changed; no other packages bumped.",
      "- [ ] `pnpm lint:enforced`, `pnpm type-check` and `pnpm build` pass (the same checks as the PR check workflow).",
      "- [ ] The PR is a **draft**, links this issue, and says what changed and what a reviewer must check.",
      "- [ ] The PR description ends with: after merge, set this project's declared pin to the new version in the TIN Command Center.",
      "",
      "## Rules",
      "- Do not merge the PR and do not enable auto-merge.",
      "- If a check fails for a reason unrelated to this upgrade, say so in the PR instead of fixing it.",
      "",
      `Requested by ${i.requestedBy} from the TIN Command Center.`,
    ].join("\n"),
  };
}
