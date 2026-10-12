import { compareVersions, parseVersion } from "@/src/registry/drift";

export type AgentTask = { repo: string; title: string; body: string; labels: string[] };
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export type PinTaskInput = {
  repo: string;
  /** Folder inside the repo, from the registry; null when not recorded. */
  path: string | null;
  project: string;
  environment: string;
  pkg: string;
  /** The version the registry declares. */
  declared: string;
  /** The version the repo's package.json actually pins today, when we could read it; null when unverified. */
  repoVersion: string | null;
  latest: string;
  /** When the collector last observed the package. */
  observedAt: Date | null;
  /** Repo that publishes the package, from the collector. */
  packageRepo: string | null;
  /** Console origin, e.g. https://console.tinconnect.com; null omits the links. */
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

/** The version the upgrade starts from: what the repo really has when we know it, else what the registry declares. */
export const fromVersion = (i: Pick<PinTaskInput, "declared" | "repoVersion">) => i.repoVersion ?? i.declared;

export const issueTitle = (i: Pick<PinTaskInput, "pkg" | "declared" | "repoVersion" | "latest" | "project" | "environment">) =>
  `Upgrade ${i.pkg} ${fromVersion(i)} to ${i.latest} (${i.project}, ${i.environment})`;

/** A major bump is the risky one, so it is the one that gets the queue's attention first. */
export const priorityFor = (size: "major" | "minor" | "patch"): TicketPriority => (size === "major" ? "high" : size === "minor" ? "medium" : "low");

/**
 * The work order, written as a ticket: where the code is, the evidence behind it, what to do, and when it is done.
 * It asks for a draft PR only: a person merges, and the console's declared pin is changed afterwards, so the registry
 * stays the authority on what should be running.
 */
export function buildPinTask(i: PinTaskInput): AgentTask {
  const from = fromVersion(i);
  const size = bumpSize(from, i.latest);
  if (!size) throw new Error(`${i.pkg} ${from} is not behind ${i.latest}.`);
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
      `@claude Upgrade \`${i.pkg}\` from \`${from}\` to \`${i.latest}\` for \`${i.project}\` (${i.environment}).`,
      "",
      "## Where this lives",
      `- Repository: ${i.repo}`,
      `- App folder: ${where}`,
      "",
      "## Evidence",
      `- Declared in the TIN ops console (the registry is the source of truth): \`${i.declared}\``,
      i.repoVersion === null
        ? "- Could not be checked against the repo before this ticket was raised; confirm the current pin first."
        : i.repoVersion === i.declared
          ? `- Checked against the repo: it pins \`${i.repoVersion}\`, matching the registry.`
          : `- Checked against the repo: it pins \`${i.repoVersion}\`, which differs from the registry. Start from the repo's version; the registry will need correcting too.`,
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
      "- [ ] The PR description ends with: after merge, set this project's declared pin to the new version in the TIN ops console.",
      "",
      "## Rules",
      "- Do not merge the PR and do not enable auto-merge.",
      "- If a check fails for a reason unrelated to this upgrade, say so in the PR instead of fixing it.",
      "",
      `Requested by ${i.requestedBy} from the TIN ops console.`,
    ].join("\n"),
  };
}

/** The platform support ticket for the same work. It points at the work order; the issue links back through a marker comment. */
export function buildCareHubTicket(i: PinTaskInput, issueUrl: string): { subject: string; description: string; priority: TicketPriority } {
  const from = fromVersion(i);
  const size = bumpSize(from, i.latest);
  if (!size) throw new Error(`${i.pkg} ${from} is not behind ${i.latest}.`);
  return {
    subject: issueTitle(i),
    priority: priorityFor(size),
    description: [
      `${i.project} (${i.environment}) is behind on ${i.pkg}: ${from} now, ${i.latest} latest (${size} bump).`,
      "",
      `Work order (the agent runs from this issue): ${issueUrl}`,
      ...(i.origin ? [`Project in the TIN ops console: ${i.origin}/projects/${i.project}`, `Drift: ${i.origin}/drift?q=${encodeURIComponent(i.pkg)}`] : []),
      `Repository: ${i.repo}${i.path ? ` (${i.path})` : ""}`,
      "",
      "This ticket moves to in progress when the agent opens a draft PR, notes the merge, and resolves itself when the declared pin is updated in the console.",
      `Requested by ${i.requestedBy}.`,
    ].join("\n"),
  };
}

/**
 * Posted on the issue after the ticket exists. The hidden marker is how the agent-ticket-sync workflow in the
 * repo finds the ticket from a PR that references the issue; its pattern must stay in step with that workflow.
 */
export const ticketMarkerComment = (t: { id: string; number: string }) =>
  `Platform support ticket **${t.number}** is the record for this work order.\n\n<!-- care-hub-ticket id=${t.id} number=${t.number} -->`;
