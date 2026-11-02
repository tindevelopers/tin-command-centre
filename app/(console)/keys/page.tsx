import Link from "next/link";
import { HOLDER_LABEL, SCOPES, SCOPES_RECORDED_ON, UNMINTED_SCOPES } from "@/config/scopes";
import type { Holder } from "@/config/scopes";
import { requireOperator } from "@/src/auth/access";
import { snapshotAuthority } from "@/src/credentials/snapshots";
import { filterIdentityRows, identityRows, keyTotals, parseKeyFilters } from "@/src/credentials/view";
import type { IdentityRow } from "@/src/credentials/view";
import { loadRegistry, registryConfigured } from "@/src/registry/db";
import { statusStoreConfigured } from "@/src/status/db";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import FilterBar from "@/components/FilterBar";
import type { FilterField } from "@/components/FilterBar";
import { EmptyRow, PageHeader, Panel, StatusChip } from "@/components/ControlPlane";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const scopeChip = "inline-block rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700 dark:border-gray-700 dark:bg-white/5 dark:text-gray-200";

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "red" | "amber" }) {
  const colour = tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-gray-800 dark:text-white/90";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
    </div>
  );
}

/**
 * Consumers and keys: one identity per platform environment, its keys and their scopes, as the collector last saw them in
 * api-credentials. Metadata only: the table has no secret column. Minting and rotation stay the owner's CLI; this page records.
 */
export default async function KeysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const sp = await searchParams;
  if (!statusStoreConfigured()) return <div><PageHeading title="Consumers and keys" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, snapshot, registry] = await Promise.all([currentTenant(), snapshotAuthority.read(), registryConfigured() ? loadRegistry().catch(() => null) : Promise.resolve(null)]);
  const now = new Date();
  const rows = identityRows(snapshot.keys, registry?.projects ?? []);
  const f = parseKeyFilters(sp);
  const shown = filterIdentityRows(rows, f);
  const totals = keyTotals(rows);
  const fields: FilterField[] = [
    { kind: "search", name: "q", label: "Search identities, keys or scopes", value: f.q, placeholder: "Search identity, key id, cell or scope…" },
    { kind: "select", name: "holder", label: "Holder", value: f.holder, options: [{ value: "", label: "Any holder" }, ...(Object.keys(HOLDER_LABEL) as Holder[]).map((h) => ({ value: h, label: HOLDER_LABEL[h] }))] },
    { kind: "select", name: "status", label: "Keys", value: f.status, options: [{ value: "", label: "All" }, { value: "active", label: "With active keys" }, { value: "other", label: "With revoked or expired keys" }] },
  ];

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Consumers and keys" crumb="Consumers and keys" crumbParent="Access" subtitle="One identity per platform environment; keys hang off it and share its scopes. Metadata and outcomes only: the secret is shown once at minting and never stored here.">
        <span className={neutral}>authority: api-credentials</span>
      </PageHeader>

      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Identities" value={totals.identities} sub={`${totals.platforms} platform${totals.platforms === 1 ? "" : "s"}`} />
        <Tile label="Active keys" value={totals.active} sub={`${totals.keys - totals.active} revoked or expired`} />
        <Tile label="Never used" value={totals.neverUsed} sub="active keys with no recorded use" tone={totals.neverUsed > 0 ? "amber" : undefined} />
        <Tile label="Outside their rule" value={totals.outsideRule} sub="scopes the holder may not have" tone={totals.outsideRule > 0 ? "red" : undefined} />
        <Tile label="Verifications, 24 h" value="—" sub="not collected yet" />
      </section>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {snapshot.observedAt ? <>From {snapshotAuthority.name}, run finished {fmt(snapshot.observedAt)}. </> : <>The collector has not recorded credentials yet (<span className={mono}>credential_snapshots</span> is empty), so the lists below are empty; the scope rules still apply. </>}
        Rules as recorded on {SCOPES_RECORDED_ON} from BOSS&apos;s minting script.
      </p>

      <div className="mt-6">
        <FilterBar fields={fields} shown={shown.length} total={rows.length} noun="identities" />
      </div>

      <Panel title="Identities">
        {rows.length === 0 ? (
          <EmptyRow>No credentials recorded. The collector writes <span className={mono}>credential_snapshots</span> (metadata only) once its writer for api-credentials is enabled; nothing here is read live from a cell.</EmptyRow>
        ) : shown.length === 0 ? (
          <EmptyRow>No identity matches these filters.</EmptyRow>
        ) : (
          <div className="space-y-4">
            {shown.map((r) => <IdentityCard key={r.identity} r={r} now={now} />)}
          </div>
        )}
      </Panel>

      <Panel title="Scope matrix" className="mt-8">
        <Table head={["Scope", "Route", "Purpose", "Who may hold it"]}>
          {SCOPES.map((s) => (
            <tr key={s.scope}>
              <td className={`${td} ${mono} font-medium`}>{s.scope}</td>
              <td className={`${td} ${mono}`}>{s.route}</td>
              <td className={`${td} text-gray-600 dark:text-gray-300`}>{s.purpose}</td>
              <td className={td}>{s.holders.map((h) => <span key={h} className={`${neutral} mr-1`}>{HOLDER_LABEL[h]}</span>)}</td>
            </tr>
          ))}
          {UNMINTED_SCOPES.map((s) => (
            <tr key={s.scope} className="text-gray-500 dark:text-gray-400">
              <td className={`${td} ${mono}`}>{s.scope}</td>
              <td className={`${td} ${mono}`}>{s.route}</td>
              <td className={td}>Route exists; the minting script issues no key for it yet</td>
              <td className={td}>—</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">A platform key is any non-empty subset of the three platform scopes. The console reader is exactly <span className={mono}>boss.reports.read</span>, never mixed with operator scopes, because that scope returns every platform&apos;s reports. The tin hub is exactly <span className={mono}>boss.session.issue</span>. Minting and rotation are the owner&apos;s CLI (<span className={mono}>scripts/mint-spoke-credential.ts</span> in tin-boss-api); they are not done from here.</p>
      </Panel>

      <Panel title="Where this grows" className="mt-8">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li><strong>Today:</strong> identities, keys, scopes and last use from the collector&apos;s snapshots of <span className={mono}>api-credentials</span>; the rule check flags a key whose scopes its holder may not have.</li>
          <li><strong>Next:</strong> the collector adds verification outcomes per key (valid, rate limited, forbidden), so the tile above and a per-key column light up; gates become enforced limits per identity.</li>
          <li><strong>Later:</strong> the same shape is Unkey&apos;s (identity, key, limit, outcome). Another authority is another adapter behind <span className={mono}>src/credentials/port.ts</span>, not a new page.</li>
        </ol>
      </Panel>
    </div>
  );
}

function IdentityCard({ r, now }: { r: IdentityRow; now: Date }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <span className="font-medium text-gray-800 dark:text-white/90">{r.platform}</span>
        <span className={`${mono} text-gray-500 dark:text-gray-400`}>{r.environment}</span>
        <span className={`${mono} text-gray-500 dark:text-gray-400`}>{r.identity}</span>
        <span className={neutral}>{HOLDER_LABEL[r.holder]}</span>
        <StatusChip colour={r.colour} label={r.colour === "red" ? "outside rule" : r.colour === "amber" ? (r.active === 0 ? "no active key" : "never used") : "healthy"} />
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {r.active} active key{r.active === 1 ? "" : "s"} · last used {r.lastUsedAt ? ageLabel(r.lastUsedAt, now) : "never"}
          {r.projects.length > 0 && <> · {r.projects.map((p, i) => <span key={p}>{i > 0 && ", "}<Link href={`/projects/${p}`} className="underline">{p}</Link></span>)}</>}
        </span>
      </div>
      <Table head={["Key", "Cell", "Scopes", "Last used", "Status", "Rule"]}>
        {r.keys.map((k) => (
          <tr key={`${k.cell}/${k.publicId}`}>
            <td className={`${td} ${mono} font-medium`}>{k.publicId}</td>
            <td className={`${td} ${mono} text-gray-600 dark:text-gray-300`}>{k.cell}</td>
            <td className={td}><span className="flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className={scopeChip}>{s}</span>)}</span></td>
            <td className={td} title={k.lastUsedAt ? fmt(k.lastUsedAt) : undefined}>{k.lastUsedAt ? ageLabel(k.lastUsedAt, now) : <span className="text-gray-500 dark:text-gray-400">never</span>}</td>
            <td className={td}>{k.status === "active" ? <StatusChip colour="green" label="active" /> : <span className={neutral}>{k.status}</span>}</td>
            <td className={`${td} text-xs`}>{k.check.ok ? <span className="text-gray-500 dark:text-gray-400">within rule</span> : <span className="text-red-600 dark:text-red-400">{k.check.reason}</span>}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
