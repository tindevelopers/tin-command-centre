import { compareVersions, parseVersion } from "@/src/registry/drift";

export type RepoPin = { status: "found"; versions: string[]; file: string } | { status: "unverified"; reason: string };

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/** Exact versions of `pkg` a package.json depends on, whether declared directly or through an alias (`"@base/x": "npm:pkg@1.2.3"`). */
export function pinsInPackageJson(json: unknown, pkg: string): string[] {
  const out = new Set<string>();
  if (typeof json !== "object" || json === null) return [];
  for (const section of SECTIONS) {
    const deps = (json as Record<string, unknown>)[section];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== "string") continue;
      const raw = name === pkg ? spec : spec.startsWith(`npm:${pkg}@`) ? spec.slice(`npm:${pkg}@`.length) : null;
      if (raw === null) continue;
      const exact = raw.replace(/^[=v]/, "");
      if (parseVersion(exact)) out.add(exact); // ranges, workspace: and catalog: specs say nothing exact about the repo
    }
  }
  return [...out];
}

/** True when `version` is the same as, or newer than, `latest`. Unparseable versions are never "at least". */
export function isAtLeast(version: string, latest: string): boolean {
  const a = parseVersion(version), b = parseVersion(latest);
  return !!a && !!b && compareVersions(a, b) >= 0;
}

/** The lowest of several versions, so a half-upgraded app is still treated as needing the upgrade. */
export function lowest(versions: string[]): string {
  return [...versions].sort((x, y) => compareVersions(parseVersion(x)!, parseVersion(y)!))[0];
}

/**
 * What the repo actually pins today, read from the project's package.json on the default branch.
 * Never throws: anything that stops us checking is `unverified`, with a reason an operator can act on.
 */
export async function readRepoPin(repo: string, path: string | null, pkg: string, token = process.env.AGENT_GITHUB_TOKEN): Promise<RepoPin> {
  if (!token) return { status: "unverified", reason: "AGENT_GITHUB_TOKEN is not set" };
  if (!path) return { status: "unverified", reason: "no path in the repo is recorded for this project" };
  const file = `${path}/package.json`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { status: "unverified", reason: `${file} was not found (or the token cannot read repository contents: it needs Contents: read)` };
    if (res.status === 403) return { status: "unverified", reason: "the token cannot read repository contents (it needs Contents: read)" };
    if (!res.ok) return { status: "unverified", reason: `GitHub answered ${res.status}` };
    const versions = pinsInPackageJson(JSON.parse(await res.text()), pkg);
    return versions.length ? { status: "found", versions, file } : { status: "unverified", reason: `${pkg} has no exact version in ${file}` };
  } catch (e) {
    return { status: "unverified", reason: e instanceof Error ? e.message : "could not read the repository" };
  }
}
