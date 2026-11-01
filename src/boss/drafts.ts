import { bumpSize } from "@/src/agent/task";
import { pinFinding } from "@/src/registry/drift";
import type { EnvName, Registry } from "@/src/registry/types";
import type { PackageSnapshot } from "@/src/status/types";

/**
 * Draft pin proposals, assembled from drift: for each platform environment, every declared pin that is behind the version the
 * collector last saw on `latest`, as the `@scope/package@version` strings BOSS accepts, at most ten per proposal. Pure, so the
 * page and its tests share it; sending is src/boss/propose.ts.
 *
 * Only pins behind `latest` qualify. A pin on `next`, an unpublished package, or a version the collector has not seen gives
 * nothing to propose; a declared version newer than any published one is a registry error, not a proposal.
 */
export const HUB_SCOPE = "@tindevelopers";
export const MAX_PINS = 10;
const PIN = new RegExp(`^${HUB_SCOPE}/[a-z0-9-]+@\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$`);
const PLATFORM = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type DraftPin = {
  pin: string;
  package: string;
  to: string;
  /** Distinct declared versions across the projects behind, oldest first. */
  from: string[];
  bump: "major" | "minor" | "patch";
  projects: string[];
};

export type Draft = {
  platform: string;
  environment: EnvName;
  pins: DraftPin[];
  /** The largest step in the draft, which is what a reviewer weighs. */
  bump: "major" | "minor" | "patch";
  /** True when the newest recorded proposal for this platform environment already carries exactly these pins. */
  alreadySent: boolean;
  /** 1-based part number and count when one platform environment needs more than ten pins. */
  part: { n: number; of: number } | null;
};

export type SentProposal = { platform: string; environment: string; pins: string[]; bossId: string; requestedBy: string; requestedAt: Date };

const BUMP_RANK = { major: 0, minor: 1, patch: 2 } as const;
const worstBump = (pins: DraftPin[]) => pins.map((p) => p.bump).sort((a, b) => BUMP_RANK[a] - BUMP_RANK[b])[0];

export const isPinString = (s: string) => PIN.test(s);
export const isPlatform = (s: string) => PLATFORM.test(s);

export function buildDrafts(reg: Pick<Registry, "projects" | "pins">, packages: PackageSnapshot[] | null, sent: SentProposal[] = []): Draft[] {
  if (!packages) return [];
  const snap = new Map(packages.map((p) => [p.package, p]));
  const live = new Map(reg.projects.filter((p) => p.lifecycle !== "retired" && p.client && isPlatform(p.client)).map((p) => [p.slug, p]));
  // (platform, environment) -> package -> draft pin
  const groups = new Map<string, Map<string, DraftPin>>();
  for (const pin of reg.pins) {
    const project = live.get(pin.projectSlug);
    const s = snap.get(pin.package);
    if (!project || !s?.latest) continue;
    const bump = bumpSize(pin.version, s.latest);
    if (!bump) continue;
    if (pinFinding(pin, s).colour === "green") continue;
    const target = `${pin.package}@${s.latest}`;
    if (!isPinString(target)) continue; // only hub packages, only exact versions
    const key = `${project.client}\u0000${pin.environment}`;
    const byPkg = groups.get(key) ?? new Map<string, DraftPin>();
    const d = byPkg.get(pin.package) ?? { pin: target, package: pin.package, to: s.latest, from: [], bump, projects: [] };
    if (!d.from.includes(pin.version)) d.from.push(pin.version);
    if (!d.projects.includes(pin.projectSlug)) d.projects.push(pin.projectSlug);
    if (BUMP_RANK[bump] < BUMP_RANK[d.bump]) d.bump = bump;
    byPkg.set(pin.package, d);
    groups.set(key, byPkg);
  }

  const latestSent = new Map<string, SentProposal>();
  for (const s of [...sent].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())) latestSent.set(`${s.platform}\u0000${s.environment}`, s);

  const drafts: Draft[] = [];
  for (const [key, byPkg] of groups) {
    const [platform, environment] = key.split("\u0000") as [string, EnvName];
    const pins = [...byPkg.values()]
      .map((d) => ({ ...d, from: d.from.sort(), projects: d.projects.sort() }))
      .sort((a, b) => BUMP_RANK[a.bump] - BUMP_RANK[b.bump] || a.package.localeCompare(b.package));
    const parts = Math.ceil(pins.length / MAX_PINS);
    const previous = latestSent.get(key);
    for (let i = 0; i < parts; i++) {
      const slice = pins.slice(i * MAX_PINS, (i + 1) * MAX_PINS);
      const strings = slice.map((p) => p.pin).sort();
      drafts.push({
        platform, environment, pins: slice, bump: worstBump(slice),
        alreadySent: Boolean(previous) && parts === 1 && sameSet(strings, previous!.pins),
        part: parts > 1 ? { n: i + 1, of: parts } : null,
      });
    }
  }
  return drafts.sort((a, b) => BUMP_RANK[a.bump] - BUMP_RANK[b.bump] || a.platform.localeCompare(b.platform) || a.environment.localeCompare(b.environment) || (a.part?.n ?? 0) - (b.part?.n ?? 0));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** The draft a form names, re-derived from the registry so the form can carry nothing but its key. */
export function findDraft(drafts: Draft[], platform: string, environment: string, part: number | null): Draft | undefined {
  return drafts.find((d) => d.platform === platform && d.environment === environment && (d.part?.n ?? null) === part);
}

export type DeployedState = "deployed" | "partly" | "not-deployed" | "not-reported";

/**
 * Whether a sent proposal's pins are what the platform now reports (BOSS GET /v1/reports). Deployed means every pin's package
 * is reported at the proposed version by some component of that platform environment; nothing else counts.
 */
export function deployedState(sent: SentProposal, reported: { platform: string; environment: string; versions: Record<string, string> }[]): DeployedState {
  const here = reported.filter((r) => r.platform === sent.platform && r.environment === sent.environment);
  if (here.length === 0) return "not-reported";
  let hits = 0;
  for (const pin of sent.pins) {
    const at = pin.lastIndexOf("@");
    const pkg = pin.slice(0, at);
    const version = pin.slice(at + 1);
    if (here.some((r) => r.versions[pkg] === version)) hits += 1;
  }
  return hits === sent.pins.length ? "deployed" : hits > 0 ? "partly" : "not-deployed";
}
