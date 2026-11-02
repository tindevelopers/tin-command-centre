import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { unifyRuns } from "@/src/automation/ledger";
import type { RunRow } from "@/src/automation/ledger";
import { loadAgentRuns, loadLedgerEvents, loadLedgerRuns, loadPinProposals, registryConfigured } from "@/src/registry/db";
import { recentRuns } from "@/src/status/db";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary } from "@/components/ControlPlane";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const KIND: Record<RunRow["kind"], string> = { ledger: "agent run", "hand-off": "hand-off", proposal: "proposal", collector: "collector" };
const KINDS: RunRow["kind"][] = ["ledger", "hand-off", "proposal", "collector"];

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="min-w-[9rem] flex-1 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>
    </div>
  );
}

/**
 * Agent runs: everything automation did in this tenant, in one timeline, with the autonomy class each action ran under. The
 * ledger (db/010) is the general record; the console's own hand-offs and proposals and the collector's runs are shown beside
 * it because they predate it. Nothing here starts anything: the buttons live on the pages that own them.
 */
export default async function AgentRunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const sp = await searchParams;
  if (!registryConfigured()) return <div><PageHeading title="Agent runs" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, ledger, events, handOffs, proposals, collector] = await Promise.all([currentTenant(), loadLedgerRuns(), loadLedgerEvents(), loadAgentRuns(), loadPinProposals(), recentRuns(50)]);
  const now = new Date();
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const kindFilter = KINDS.find((k) => k === one("kind"));
  const all = unifyRuns({ ledger: ledger ?? [], events: events ?? [], handOffs, proposals: proposals ?? [], collector });
  const rows = (kindFilter ? all.filter((r) => r.kind === kindFilter) : all).slice(0, 200);
  const last7 = all.filter((r) => now.getTime() - r.at.getTime() <= 7 * 86_400_000);
  const agents = new Set((ledger ?? []).map((r) => r.agent));
  const cost7 = (ledger ?? []).filter((r) => now.getTime() - r.startedAt.getTime() <= 7 * 86_400_000).reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const merged = all.filter((r) => r.outcome === "merged").length;
  const reverted = all.filter((r) => r.outcome === "reverted").length;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Agent runs" crumb="Agent runs" crumbParent="Automation" subtitle="Every automated action in this tenant and the autonomy class it ran under. Agents propose; people merge. Nothing here changes a class: the owner does that in the policy.">
        <Link href="/automation/autonomy" className={buttonPrimary}>Autonomy</Link>
      </PageHeader>

      <section aria-label="Key figures" className="flex flex-wrap items-stretch gap-2">
        <Stat label="Last 7 days" value={last7.length} note="actions of every kind" />
        <Stat label="Agents seen" value={ledger === null ? "—" : agents.size} note={ledger === null ? "ledger not applied" : "distinct agents in the ledger"} />
        <Stat label="Merged" value={ledger === null ? "—" : merged} note="agent PRs a person merged" />
        <Stat label="Reverted" value={ledger === null ? "—" : reverted} note="the number that demotes a type" />
        <Stat label="Cost, 7 days" value={ledger === null ? "—" : `$${cost7.toFixed(2)}`} note="summed per run from the ledger" />
      </section>

      {ledger === null && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          The general ledger is not switched on yet: <span className={mono}>db/010_agent_ledger.sql</span> has not been applied, so only the console&apos;s own hand-offs, proposals and collector runs are listed. The owner applies it and grants the agent workflows&apos; login the <span className={mono}>agent_ledger_writer</span> role.
        </p>
      )}

      <Panel title="Timeline" className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">Show:</span>
          <Link href="/automation/runs" className={`${neutral} ${!kindFilter ? "ring-1 ring-brand-400" : ""}`}>all · {all.length}</Link>
          {KINDS.map((k) => <Link key={k} href={`/automation/runs?kind=${k}`} className={`${neutral} ${kindFilter === k ? "ring-1 ring-brand-400" : ""}`}>{KIND[k]} · {all.filter((r) => r.kind === k).length}</Link>)}
        </div>
        {rows.length === 0 ? (
          <EmptyRow>Nothing recorded yet{kindFilter ? ` of this kind` : ""}. A <Link href="/drift" className="underline">Fix with agent</Link> hand-off, a <Link href="/boss/proposals" className="underline">pin proposal</Link> or a <Link href="/collector" className="underline">collector run</Link> appears here.</EmptyRow>
        ) : (
          <Table head={["When", "Kind", "Class", "Task type", "What", "Where", "By", "Outcome"]}>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={td} title={fmt(r.at)}>{ageLabel(r.at, now)}</td>
                <td className={td}><span className={neutral}>{KIND[r.kind]}</span></td>
                <td className={`${td} ${mono}`}>{r.autonomy}</td>
                <td className={`${td} ${mono}`}>{r.taskType}</td>
                <td className={`${td} ${mono}`}>{r.link ? <a href={r.link} target="_blank" rel="noreferrer noopener" className="underline">{r.subject}</a> : r.subject}</td>
                <td className={`${td} text-xs`}>{r.where}</td>
                <td className={`${td} text-xs text-gray-600 dark:text-gray-300`}>{r.actor}</td>
                <td className={td}>{r.tone ? <StatusChip colour={r.tone} label={r.outcome} /> : <span className={neutral}>{r.outcome}</span>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">A hand-off&apos;s class is derived from the size of its step; a proposal is A1 because a person sends it; the collector is A0 because it only reads. Ledger rows carry the class the workflow recorded.</p>
      </Panel>
    </div>
  );
}
