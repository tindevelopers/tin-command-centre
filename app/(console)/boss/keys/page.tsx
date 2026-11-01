import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { canRevoke, describeCredentialsFailure, isPlatformEnvironment, isPlatformName, listCredentials, otherActive, PLATFORM_ENVIRONMENTS, STATUS_COLOUR } from "@/src/boss/credentials";
import type { BossCredential } from "@/src/boss/credentials";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary, buttonSecondary } from "@/components/ControlPlane";
import { Notice, Table, fmt, td } from "@/components/StatusUi";
import { revokeKey } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const field = "min-h-9 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 dark:border-gray-700 dark:bg-transparent dark:text-gray-100";
const danger = "inline-flex min-h-9 items-center rounded-md bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-red-700";

/**
 * BOSS keys: the spoke credentials platforms and tools use to call BOSS, listed from BOSS (metadata only: never a key) and revocable
 * by an admin. Minting stays with the owner: a new key is minted first, the platform is updated, and only then is the old key revoked
 * here. Reads and revokes go through BOSS's operator routes with the console's credentials key and the signed-in person's token.
 */
export default async function KeysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const op = await requireOperator();
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const platform = one("platform").trim();
  const environment = one("environment").trim();
  const filtered = isPlatformName(platform) && isPlatformEnvironment(environment);
  const tenant = await currentTenant();
  const isAdmin = op.role === "admin";
  const now = new Date();

  const result = await listCredentials(await operatorBearer(), filtered ? { platform, environment } : {});
  const keys = result.status === "ok" ? result.credentials : [];
  const count = (s: BossCredential["status"]) => keys.filter((k) => k.status === s).length;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Keys" crumb="Keys" crumbParent="BOSS" subtitle="The keys platforms and tools use to call BOSS. BOSS never shows a key: this lists who holds one, what it may do and when it was last used. An admin can revoke a key; minting a new one is an owner step.">
        <Link href="/boss/reports" className={buttonPrimary}>Reports</Link>
      </PageHeader>

      {one("revoked") && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200">
          Revoked <span className={mono}>{one("revoked")}</span>. It stops working at once; BOSS recorded who did it.
        </p>
      )}
      {one("error") && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{one("error")}</p>}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filter keys">
        <label className="text-sm text-gray-600 dark:text-gray-300">Platform
          <input name="platform" defaultValue={platform} placeholder="pawpointers" pattern="[a-z0-9][a-z0-9-]{0,62}" className={`${field} mt-1 block`} />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">Environment
          <select name="environment" defaultValue={environment || "production"} className={`${field} mt-1 block`}>
            {PLATFORM_ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <button className={buttonSecondary}>Show keys</button>
        {filtered && <Link href="/boss/keys" className="text-sm underline">All keys</Link>}
      </form>

      {result.status !== "ok" ? (
        <Notice>{describeCredentialsFailure(result)}</Notice>
      ) : (
        <Panel title={filtered ? `${platform} · ${environment}` : "All keys"}>
          {keys.length === 0 ? (
            <EmptyRow>{filtered ? "BOSS has no key for this identity." : "BOSS lists no keys."}</EmptyRow>
          ) : (
            <>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {count("active")} active · {count("disabled")} disabled · {count("revoked")} revoked
                {result.truncated && " · the list is cut short; filter by platform to see the rest"}
              </p>
              <Table head={["Name", "Identity", "Scopes", "Status", "Created", "Last used", "Action"]}>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td className={`${td} ${mono} font-medium`}>{k.name}</td>
                    <td className={`${td} ${mono}`}>{k.identity ?? "no identity"}</td>
                    <td className={`${td} ${mono}`}>{k.scopes.join(", ") || "none"}</td>
                    <td className={td}><StatusChip colour={STATUS_COLOUR[k.status]} label={k.status} /></td>
                    <td className={td} title={fmt(k.createdAt)}>{ageLabel(k.createdAt, now)}</td>
                    <td className={td} title={fmt(k.lastUsedAt)}>{k.lastUsedAt ? ageLabel(k.lastUsedAt, now) : "never"}</td>
                    <td className={td}>
                      {canRevoke(k) && k.identity ? (
                        isAdmin ? <RevokeForm k={k} last={k.status === "active" && otherActive(keys, k) === 0} /> : <span className="text-xs text-gray-500 dark:text-gray-400">Admins revoke</span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{k.revokedAt ? `revoked ${ageLabel(k.revokedAt, now)}` : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </Panel>
      )}

      <Panel title="Replacing a lost or leaked key" className="mt-8">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>The owner mints the replacement and puts it in the platform&apos;s secret store (<span className={mono}>scripts/mint-spoke-credential.ts</span> in tin-boss-api).</li>
          <li>The platform is updated and redeployed, and its next report arrives.</li>
          <li>Revoke the old key here. BOSS refuses to revoke an identity&apos;s only active key unless you confirm it.</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Revoking is final. A revoked key cannot be turned back on; mint a new one.</p>
      </Panel>
    </div>
  );
}

function RevokeForm({ k, last }: { k: BossCredential; last: boolean }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-red-700 underline dark:text-red-400" aria-label={`Revoke ${k.name}`}>Revoke…</summary>
      <form action={revokeKey} className="mt-2 w-64 space-y-2">
        <input type="hidden" name="id" value={k.id} />
        <input type="hidden" name="identity" value={k.identity!} />
        <label className="block text-xs text-gray-600 dark:text-gray-300">Type <span className={mono}>{k.name}</span> to confirm
          <input name="confirm" autoComplete="off" required className={`${field} mt-1 block w-full`} />
        </label>
        {last && (
          <label className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
            <input type="checkbox" name="confirmLast" className="mt-0.5" />
            <span>This is the only active key for this identity. Revoking it cuts the platform off until a replacement exists.</span>
          </label>
        )}
        <button className={danger}>Revoke key</button>
      </form>
    </details>
  );
}
