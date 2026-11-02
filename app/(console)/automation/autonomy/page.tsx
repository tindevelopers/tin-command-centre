import Link from "next/link";
import { A2_PREREQUISITE, AUTONOMY_CLASSES, CLASSES, CONSOLE_ACTIONS, DEMOTE_FOR_DAYS, DEMOTE_ON, LIMITS, NEVER_ABOVE_A1, PROMOTE_WHEN } from "@/config/autonomy";
import { requireOperator } from "@/src/auth/access";
import { nextClass, promotionVerdict, taskTypeRecords } from "@/src/automation/ledger";
import type { Verdict } from "@/src/automation/ledger";
import { loadLedgerEvents, loadLedgerRuns, registryConfigured } from "@/src/registry/db";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { PageHeader, Panel, StatusChip, buttonPrimary } from "@/components/ControlPlane";
import { Notice, PageHeading, Table, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const VERDICT: Record<Verdict["status"], { colour: "green" | "amber" | "red" | null; label: string }> = {
  ready: { colour: "green", label: "record meets the policy" }, "not-yet": { colour: "amber", label: "not yet" }, demoted: { colour: "red", label: "held down" }, capped: { colour: null, label: "never above A1" }, top: { colour: null, label: "highest class" },
};

/**
 * Autonomy: the classes, what the owner-approved policy lets each task type do, and what each type's record says about moving up.
 * Read-only by design: a class changes when the owner edits the policy, never from a page. The record comes from the ledger (db/010).
 */
export default async function AutonomyPage() {
  await requireOperator();
  if (!registryConfigured()) return <div><PageHeading title="Autonomy" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;
  const [tenant, ledger, events] = await Promise.all([currentTenant(), loadLedgerRuns(), loadLedgerEvents()]);
  const now = new Date();
  const records = taskTypeRecords(ledger ?? [], events ?? [], now).map((r) => ({ ...r, verdict: promotionVerdict(r, now) }));
  const byClass = (c: string) => records.filter((r) => (r.policy?.class ?? "A1") === c).length;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Autonomy" crumb="Autonomy" crumbParent="Automation" subtitle="Which agent task types may do what, and what their record says. A type moves up only when the owner edits the policy after the record meets it; it moves down on its own after a revert or incident.">
        <span className={neutral}>policy: config/autonomy.ts · owner-approved</span>
        <Link href="/automation/runs" className={buttonPrimary}>Agent runs</Link>
      </PageHeader>

      <section aria-label="Classes" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {AUTONOMY_CLASSES.map((c) => (
          <div key={c} className={`rounded-lg border bg-white p-4 dark:bg-white/[0.03] ${c === "A1" ? "border-brand-400 dark:border-brand-500/60" : "border-gray-200 dark:border-gray-800"}`}>
            <p className="flex items-baseline gap-2"><span className="text-2xl font-semibold text-gray-800 dark:text-white/90">{c}</span><span className="text-sm font-medium text-gray-700 dark:text-gray-200">{CLASSES[c].name}</span><span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{byClass(c)} type{byClass(c) === 1 ? "" : "s"}</span></p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">May</p>
            <ul className="text-sm text-gray-700 dark:text-gray-200">{CLASSES[c].may.map((m) => <li key={m}>· {m}</li>)}</ul>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Merge</p>
            <p className="text-sm text-gray-700 dark:text-gray-200">{CLASSES[c].merge}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{CLASSES[c].examples}</p>
          </div>
        ))}
      </section>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{A2_PREREQUISITE} Today every type is A0 or A1 and nothing merges itself.</p>

      <Panel title="Task types and their record" className="mt-8">
        {ledger === null && <Notice>The record is empty because <span className={mono}>db/010_agent_ledger.sql</span> has not been applied. The policy still stands; every type shows its class with no runs.</Notice>}
        <div className={ledger === null ? "mt-3" : ""}>
          <Table head={["Task type", "Class", "Cap per run", "Runs", "Merged", "Consecutive clean", "Reverts 30d", "Agreement κ", "Last run", "Moving up"]}>
            {records.map((r) => (
              <tr key={r.taskType}>
                <td className={`${td} ${mono} font-medium`}>{r.taskType}{r.policy?.note && <span className="block font-sans text-xs font-normal text-gray-500 dark:text-gray-400">{r.policy.note}</span>}{!r.policy && <span className="block font-sans text-xs font-normal text-amber-600 dark:text-amber-400">not in the policy</span>}</td>
                <td className={`${td} ${mono}`}>{r.policy?.class ?? "A1"}</td>
                <td className={`${td} tabular-nums`}>{r.policy ? `$${r.policy.capUsd}` : "—"}</td>
                <td className={`${td} tabular-nums`}>{r.runs}</td>
                <td className={`${td} tabular-nums`}>{r.merged}</td>
                <td className={`${td} tabular-nums`}>{r.consecutiveMergedWithoutHumanChanges} / {PROMOTE_WHEN.consecutiveMergedWithoutHumanChanges}</td>
                <td className={`${td} tabular-nums`}>{r.reverts30d}{r.incidents30d > 0 && <span className="text-xs text-red-600"> +{r.incidents30d} incident{r.incidents30d === 1 ? "" : "s"}</span>}</td>
                <td className={`${td} tabular-nums`}>{r.kappa === null ? "—" : r.kappa.toFixed(2)}</td>
                <td className={`${td} text-xs`}>{r.lastRunAt ? ageLabel(r.lastRunAt, now) : "never"}</td>
                <td className={td}>
                  {VERDICT[r.verdict.status].colour ? <StatusChip colour={VERDICT[r.verdict.status].colour!} label={r.verdict.status === "ready" ? `ready for ${nextClass(r.policy?.class ?? "A1")}` : VERDICT[r.verdict.status].label} /> : <span className={neutral}>{VERDICT[r.verdict.status].label}</span>}
                  <ul className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.verdict.reasons.map((s) => <li key={s}>{s}</li>)}</ul>
                </td>
              </tr>
            ))}
          </Table>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Moving up needs {PROMOTE_WHEN.consecutiveMergedWithoutHumanChanges} consecutive merges without human changes, {PROMOTE_WHEN.revertsLast30Days} reverts in 30 days and reviewer–human agreement κ ≥ {PROMOTE_WHEN.reviewerHumanAgreementKappaMin}, then the owner&apos;s edit to the policy. Moving down is automatic for {DEMOTE_FOR_DAYS} days after {DEMOTE_ON.join(" or ")}. Agreement is measured where a run carries both a reviewer verdict and a human one.
        </p>
      </Panel>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <Panel title="What the console itself may do">
          <Table head={["Action", "Class", "What happens", "Recorded in"]}>
            {CONSOLE_ACTIONS.map((a) => (
              <tr key={a.id}>
                <td className={td}><Link href={a.page} className="font-medium underline">{a.title}</Link></td>
                <td className={`${td} ${mono}`}>{a.class}</td>
                <td className={`${td} text-xs`}>{a.what}</td>
                <td className={`${td} ${mono}`}>{a.records}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">No console action merges, deploys, publishes or rotates anything. Those stay owner gates (Standard §11).</p>
        </Panel>

        <Panel title="Never above A1, and the hard limits">
          <p className="text-xs text-gray-500 dark:text-gray-400">Topics</p>
          <p className="mb-3 flex flex-wrap gap-1.5">{NEVER_ABOVE_A1.topics.map((t) => <span key={t} className={neutral}>{t}</span>)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Paths</p>
          <ul className={`${mono} mb-3 text-gray-700 dark:text-gray-200`}>{NEVER_ABOVE_A1.paths.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="text-xs text-gray-500 dark:text-gray-400">Every agent, enforced in the workflow</p>
          <ul className="text-sm text-gray-700 dark:text-gray-200">
            <li>· pushes only to <span className={mono}>{LIMITS.pushBranchPrefix}*</span>; one repository per PR; at most {LIMITS.maxFilesPerPr} files</li>
            <li>· never holds: {LIMITS.forbiddenPermissions.join(", ")}</li>
            <li>· never sees: <span className={mono}>{LIMITS.forbiddenSecrets.join(", ")}</span>; <span className={mono}>{LIMITS.allowedInInstallStepOnly.join(", ")}</span> in the install step only</li>
          </ul>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">A kill switch per agent is not built; stopping an agent today means disabling its workflow in its repository.</p>
        </Panel>
      </div>
    </div>
  );
}
