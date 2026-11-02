import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { MAX_SPACES, RELEASES_SCOPE, describeReleasesFailure, listReleases, nextVersions } from "@/src/boss/releases";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, buttonPrimary } from "@/components/ControlPlane";
import { Notice, Table, fmt, td } from "@/components/StatusUi";
import { buildReleaseAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const field = "min-h-9 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 dark:border-gray-700 dark:bg-transparent dark:text-gray-100";

/**
 * Knowledge releases: the signed, immutable bundles platforms pull from BOSS, listed as metadata (version, digest, who, when) and
 * built by an admin. The console never fetches a bundle and BOSS never serves a key to trust: platforms pin the release public key
 * themselves. A cell serves this only when it has the upstream store and the release key; tin-production does not.
 */
export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await requireOperator();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const tenant = await currentTenant();
  const now = new Date();
  const result = await listReleases(await operatorBearer());
  const releases = result.status === "ok" ? result.releases : [];
  const next = nextVersions(releases);
  const canBuild = op.role === "admin" && result.status === "ok";

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Releases" crumb="Releases" crumbParent="BOSS" subtitle="Signed knowledge releases platforms pull from BOSS. Immutable once built; a bad one is followed by a higher version, never changed. Metadata only: the console never holds a bundle or a key.">
        <span className={neutral}>{result.status === "ok" ? `${releases.length} release${releases.length === 1 ? "" : "s"}` : "unavailable"}</span>
        <Link href="/boss/proposals" className={buttonPrimary}>Pin proposals</Link>
      </PageHeader>

      {one("built") && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200">
          Built and signed release <span className={mono}>{one("built")}</span>. BOSS verified its own output before storing it; platforms pull it with their own key.
        </p>
      )}
      {one("error") && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{one("error")}</p>}

      {result.status !== "ok" ? (
        <Notice>{describeReleasesFailure(result)}</Notice>
      ) : (
        <Panel title="Releases, newest first">
          {releases.length === 0 ? (
            <EmptyRow>BOSS holds no release yet.</EmptyRow>
          ) : (
            <Table head={["Version", "Built", "By", "SHA-256"]}>
              {releases.map((r) => (
                <tr key={r.version}>
                  <td className={`${td} ${mono} font-medium`}>{r.version}</td>
                  <td className={td} title={fmt(r.createdAt)}>{ageLabel(r.createdAt, now)}</td>
                  <td className={`${td} ${mono}`}>{r.createdBy}</td>
                  <td className={`${td} ${mono} text-gray-500 dark:text-gray-400`} title={r.sha256}>{r.sha256.slice(0, 16)}…</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">A platform fetches a bundle with its own key (scope boss.knowledge.releases.read) and verifies the signature against the release public key it pins. The digest here is the stored bundle&apos;s; compare it with what a platform reports.</p>
        </Panel>
      )}

      {canBuild && (
        <Panel title="Build a release" className="mt-8">
          <form action={buildReleaseAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <label className="text-sm text-gray-600 dark:text-gray-300">Version
              <input name="version" autoComplete="off" required maxLength={64} placeholder={next?.patch ?? "1.0.0"} pattern="(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?" className={`${field} mt-1 block ${mono}`} />
            </label>
            <label className="text-sm text-gray-600 dark:text-gray-300">Type it again
              <input name="confirm" autoComplete="off" required maxLength={64} className={`${field} mt-1 block ${mono}`} />
            </label>
            <label className="basis-full text-sm text-gray-600 dark:text-gray-300">Platform space ids, one per line (at most {MAX_SPACES})
              <textarea name="spaceIds" required rows={4} spellCheck={false} className={`${field} mt-1 block w-full ${mono}`} placeholder="2f1c9b1e-4f3a-4a7e-9c1d-0b2a3c4d5e6f" />
            </label>
            <button className={buttonPrimary}>Build and sign</button>
            <p className="basis-full text-xs text-gray-500 dark:text-gray-400">
              {next ? <>Newest is the top row; the next patch is <span className={mono}>{next.patch}</span>, minor <span className={mono}>{next.minor}</span>, major <span className={mono}>{next.major}</span>. </> : "This will be the first release. "}
              BOSS builds every published platform document in those spaces, signs it with the release key, verifies its own output and stores it. An existing version is refused and never changed. Needs the console&apos;s operator key with <span className={mono}>{RELEASES_SCOPE}</span> and you on BOSS&apos;s operator list. Building can take a while; the budget is 30 seconds.
            </p>
          </form>
        </Panel>
      )}
      {op.role !== "admin" && result.status === "ok" && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Admins build releases.</p>}
    </div>
  );
}
