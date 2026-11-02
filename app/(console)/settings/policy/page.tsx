import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { KIND_LABEL, OWNER_GATES, POLICIES } from "@/src/settings/policy";
import type { PolicyKind } from "@/src/settings/policy";
import { currentTenant } from "@/src/tenancy/tenant";
import { PageHeader, Panel, buttonPrimary } from "@/components/ControlPlane";
import { Table, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const KIND_TONE: Record<PolicyKind, string> = {
  "decision-record": "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  code: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  deployment: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

/**
 * Policy: the rules the console runs under, each with where it is recorded, who approves it, how it changes and whether anything
 * overrides it. Read-only by design. Values are computed from the same constants the code uses, so the page cannot drift.
 */
export default async function PolicyPage() {
  await requireOperator();
  const tenant = await currentTenant();
  const counts = { "decision-record": 0, code: 0, deployment: 0 } as Record<PolicyKind, number>;
  for (const p of POLICIES) counts[p.kind]++;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Policy" crumb="Policy" crumbParent="Settings" subtitle="The rules this console runs under: decision records the owner approved, constants in the code, and settings of this deployment. A policy changes where it is recorded, never from a page.">
        {(Object.keys(counts) as PolicyKind[]).map((k) => <span key={k} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_TONE[k]}`}>{counts[k]} {KIND_LABEL[k]}{counts[k] === 1 ? "" : "s"}</span>)}
        <Link href="/settings/integrations" className={buttonPrimary}>Integrations</Link>
      </PageHeader>

      <div className="space-y-6">
        {POLICIES.map((p) => (
          <Panel key={p.id} title={p.title} link={p.page ? { href: p.page, label: "open the page" } : undefined}>
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_TONE[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                <p className="text-sm text-gray-700 dark:text-gray-200">{p.governs}</p>
              </div>
              <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-xs text-gray-500 dark:text-gray-400">Recorded in</dt><dd className={mono}>{p.recordedIn}</dd>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Approved by</dt><dd>{p.approvedBy}</dd>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Changed by</dt><dd>{p.changedBy}</dd>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Overridable by</dt><dd>{p.overridableBy}</dd>
              </dl>
              <Table head={["Rule", "Today"]}>
                {p.values().map((v) => (
                  <tr key={v.label}>
                    <td className={`${td} whitespace-nowrap text-xs text-gray-500 dark:text-gray-400`}>{v.label}</td>
                    <td className={`${td} ${/[A-Z_]{6,}|\//.test(v.value) && v.value.length < 80 ? mono : ""}`}>{v.value}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </Panel>
        ))}

        <Panel title="Owner gates: what the console and its agents never do">
          <ul className="grid gap-1 text-sm text-gray-700 dark:text-gray-200 sm:grid-cols-2">
            {OWNER_GATES.map((g) => <li key={g} className="flex items-start gap-2"><span className={neutral}>never</span><span>{g}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Standard §11 and this repository&apos;s CLAUDE.md. Every button on this console stays below these: it reads, records, proposes and invites; a person merges, publishes, migrates, deploys and mints.</p>
        </Panel>
      </div>
    </div>
  );
}
