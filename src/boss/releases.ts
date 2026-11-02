import { dateOf, describeCall, isObject, isUuid, operatorCall } from "./operator";
import type { Call, Options } from "./operator";

/**
 * Knowledge releases (tin-boss-api src/routes/releases.ts, task 4b.2): the signed, immutable bundles platforms pull.
 * The console lists release metadata and lets an admin build one (operator route, scope boss.releases.write). It never fetches a
 * bundle: that is the platforms' route, with their own scope, and BOSS never serves a key to trust.
 */
export type Release = { version: string; sha256: string; createdBy: string; createdAt: Date };

export type ReleasesResult =
  | { status: "ok"; releases: Release[] }
  | Exclude<Call, { status: "ok" }>;

export type BuildResult =
  | { status: "ok"; version: string; sha256: string }
  | { status: "invalid"; reason: string }
  | Exclude<Call, { status: "ok" }>;

export const RELEASES_SCOPE = "boss.releases.write";
export const MAX_SPACES = 50;
export const LIST_LIMIT = 100;
/** semver.org 2.0.0, at most 64 characters: BOSS's version rule. */
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ACTOR = /^[\x21-\x7e]{1,128}$/;

export const isSemver = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && SEMVER.test(v);

const ROUTE = {
  scope: RELEASES_SCOPE,
  notServed: "This BOSS cell does not serve releases: only a cell with the upstream store and the release key mounts them (tin-production has no knowledge login).",
  notFound: "BOSS has no such release.",
  conflict: "A release with that version already exists. Releases are immutable; choose the next version.",
};

export const describeReleasesFailure = (r: Exclude<ReleasesResult, { status: "ok" }>) => describeCall(r, ROUTE);
export const describeBuildFailure = (r: Exclude<BuildResult, { status: "ok" }>) => (r.status === "invalid" ? `Nothing was built: ${r.reason}` : `Nothing was built: ${describeCall(r, ROUTE)}`);

/** One wire row; null when any field is not exactly what BOSS promises. */
export function parseRelease(row: unknown): Release | null {
  if (!isObject(row)) return null;
  const { version, sha256, createdBy } = row;
  if (!isSemver(version) || typeof sha256 !== "string" || !SHA256.test(sha256) || typeof createdBy !== "string" || !ACTOR.test(createdBy)) return null;
  const createdAt = dateOf(row.createdAt);
  if (!createdAt) return null;
  return { version, sha256, createdBy, createdAt };
}

export async function listReleases(bearer: string | null, opts: Options = {}): Promise<ReleasesResult> {
  const r = await operatorCall("/v1/knowledge/releases", { method: "GET", search: `limit=${LIST_LIMIT}`, okCodes: [200], notFoundMeans: "not_served" }, bearer, opts);
  if (r.status !== "ok") return r;
  if (!isObject(r.body) || !Array.isArray(r.body.releases) || r.body.releases.length > LIST_LIMIT) return { status: "failed", reason: "malformed", detail: "" };
  const releases: Release[] = [];
  for (const row of r.body.releases) {
    const parsed = parseRelease(row);
    if (!parsed) return { status: "failed", reason: "malformed", detail: "" };
    releases.push(parsed);
  }
  return { status: "ok", releases };
}

export type BuildInput = { version: string; spaceIds: string[] };

/** Splits what a person typed into space ids: one per line, comma or space; lower-cased; duplicates dropped. */
export function parseSpaceIds(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** The same shape BOSS enforces, checked here so a bad request never leaves the console. */
export function validateBuild(input: BuildInput): string | null {
  if (!isSemver(input.version)) return "the version is not a semantic version (for example 1.4.0).";
  if (input.spaceIds.length === 0) return "name at least one platform space id.";
  if (input.spaceIds.length > MAX_SPACES) return `a release names at most ${MAX_SPACES} spaces.`;
  if (new Set(input.spaceIds).size !== input.spaceIds.length) return "a space id is repeated.";
  const bad = input.spaceIds.find((s) => !isUuid(s));
  if (bad) return "a space id is not a UUID.";
  return null;
}

/** Builds, signs and stores a release. Autonomy class A1: an admin presses the button; BOSS verifies its own output before storing. */
export async function buildRelease(input: BuildInput, bearer: string | null, opts: Options = {}): Promise<BuildResult> {
  const invalid = validateBuild(input);
  if (invalid) return { status: "invalid", reason: invalid };
  const r = await operatorCall("/v1/knowledge/releases", { method: "POST", body: { version: input.version, spaceIds: input.spaceIds.map((s) => s.toLowerCase()) }, okCodes: [201], notFoundMeans: "not_served" }, bearer, { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
  if (r.status !== "ok") return r;
  const b = r.body;
  return isObject(b) && b.version === input.version && typeof b.sha256 === "string" && SHA256.test(b.sha256) ? { status: "ok", version: input.version, sha256: b.sha256 } : { status: "failed", reason: "malformed", detail: "" };
}

/** The next patch, minor and major after the newest release, for the form's suggestions. */
export function nextVersions(releases: Release[]): { patch: string; minor: string; major: string } | null {
  const core = releases.map((r) => r.version.split(/[-+]/)[0].split(".").map(Number)).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
  if (!core) return null;
  const [M, m, p] = core;
  return { patch: `${M}.${m}.${p + 1}`, minor: `${M}.${m + 1}.0`, major: `${M + 1}.0.0` };
}
