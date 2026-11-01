import Link from "next/link";
import { currentOperator, requireOperator } from "@/src/auth/access";
import { buildDrafts, deployedState } from "@/src/boss/drafts";
import type { DeployedState, Draft, SentProposal } from "@/src/boss/drafts";
import { MAX_REPOS, describePlatformUnavailable, issueRef, platformRepos, pullForProposal, pullForRun, readPlatformSignals } from "@/src/boss/platform";
import type { AgentPull, CheckState, PinBumpPull, PullState } from "@/src/boss/platform";
import { readReports } from "@/src/boss/reports";
import { loadAgentRuns, loadObserved, loadPinProposals, loadRegistry, registryConfigured, registryWritable } from "@/src/registry/db";
import type { AgentRun } from "@/src/registry/db";
import { ageLabel } from "@/src/status/format";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary } from "@/components/ControlPlane";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";
import { sendDraft } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const BUMP: Record<Draft["bump"], { colour: "red" | "amber" | "green"; label: string }> = { major: { colour: "red", label: "major" }, minor: { colour: "amber", label: "minor" }, patch: { colour: "green", label: "patch" } };
const DEPLOYED: Record<DeployedState, { colour: "green" | "amber" | "red"; label: string }> = {
  deployed: { colour: "green", label: "deployed" }, partly: { colour: "amber", label: "partly deployed" }, "not-deployed": { colour: "red", label: "not deployed" }, "not-reported": { colour: "amber", label: "not reported" },
};
const CHECKS: Record<CheckState, { colour: "green" | "amber" | "red" | null; label: string }> = {
  green: { colour: "green", label: "checks green" }, red: { colour: "red", label: "checks red" }, pending: { colour: "amber", label: "checks running" }, none: { colour: null, label: "no checks" },
};
const PULL: Record<PullState, string> = { open: "open", merged: "merged", closed: "closed, not merged" };

function PullChip({ p }: { p: { url: string; number: number; state: PullState; draft: boolean; checks: CheckState } | null }) {
  if (!p) return <span className="text-xs text-gray-500 dark:text-gray-400">none yet</span>;
  const c = CHECKS[p.checks];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <a href={p.url} target="_blank" rel="noreferrer noopener" className={`${mono} underline`}>#{p.number}</a>
      <span className={neutral}>{p.state === "open" && p.draft ? "draft" : PULL[p.state]}</span>
      {p.state !== "closed" && (c.colour ? <StatusChip colour={c.colour} label={c.label} /> : <span className={neutral}>{c.label}</span>)}
    </span>
  );
}

function Stage({ label, value, note, accent = false }: { label: string; value: string | number; note: string; accent?: boolean }) {
  return (
    <div className={`min-w-[9rem] flex-1 rounded-lg border bg-white p-3 dark:bg-white/[0.03] ${accent ? "border-brand-400 dark:border-brand-500/60" : "border-gray-200 dark:border-gray-800"}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>
    </div>
  );
}

/**
 * Pin proposals: drafts assembled from drift, sent to BOSS by a person (A1), and what happened to the ones sent. BOSS proposes and
 * platforms pull; nothing here touches a platform. Reads use the console's reader key; sending needs the operator key and the
 * signed-in person's Neon Auth token, and that person on BOSS's operator list.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const sp = await searchParams;
  if (!registryConfigured()) return <div><PageHeading title="Pin proposals" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, op, reg, observed, sent, reports, agentRuns] = await Promise.all([currentTenant(), currentOperator(), loadRegistry(), loadObserved(), loadPinProposals(), readReports(), loadAgentRuns()]);
  const now = new Date();
  const drafts = buildDrafts(reg, observed.packages, sent ?? []);
  const sendable = drafts.filter((d) => !d.alreadySent);
  const canSend = op?.role === "admin" && registryWritable() && Boolean(process.env.BOSS_OPERATOR_KEY?.trim()) && Boolean(process.env.BOSS_API_URL?.trim());
  const reported = reports.status === "ok" ? reports.reports : [];

  // Platform signals: only repositories the registry names are read. Platform repos for pin-bump PRs; the repos of recorded hand-off
  // issues (always registry projects, by construction of "Fix with agent") for agent PRs.
  const platforms = new Set(reg.projects.map((p) => p.client).filter((c): c is string => Boolean(c)));
  const registryRepos = new Set(reg.projects.map((p) => p.repo).filter((r): r is string => Boolean(r)));
  const runRepos = agentRuns.map((r) => issueRef(r.issueUrl)?.repo).filter((r): r is string => Boolean(r) && registryRepos.has(r!));
  const repos = [...new Set([...platformRepos(reg.projects, platforms), ...runRepos])].slice(0, MAX_REPOS);
  const signals = await readPlatformSignals(repos, agentRuns);
  const pinBumps: PinBumpPull[] = signals.status === "ok" ? signals.pinBumps : [];
  const agentPulls: AgentPull[] = signals.status === "ok" ? signals.agentPulls : [];
  const openBumps = pinBumps.filter((p) => p.state === "open");
  const greenBumps = pinBumps.filter((p) => p.state !== "closed" && p.checks === "green");
  const runsWithPull = agentRuns.filter((r) => pullForRun(r, agentPulls)).length;

  const history = (sent ?? []).map((s) => ({ ...s, state: reports.status === "ok" ? deployedState(s, reported) : ("not-reported" as const), pull: pullForProposal(s, pinBumps) }));
  const deployed = history.filter((h) => h.state === "deployed").length;
  const sentIds = new Set((sent ?? []).map((s) => s.bossId));
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Pin proposals" crumb="Pin proposals" crumbParent="BOSS" subtitle="BOSS proposes; platforms pull and accept in their own CI (BOSS-8). Nothing here touches a platform. A person sends every proposal (autonomy class A1).">
        <span className={neutral}>{canSend ? "sending enabled" : "sending not enabled"}</span>
        <Link href="/boss/reports" className={buttonPrimary}>Reports</Link>
      </PageHeader>

      {one("sent") && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200">
          Sent to BOSS as proposal <span className={mono}>{one("sent")}</span>. The platform&apos;s pin-bump job pulls it; nothing more happens here.
          {one("unrecorded") && <> The console could not record it locally (is <span className={mono}>db/009</span> applied?); BOSS has it.</>}
        </p>
      )}
      {one("error") && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">{one("error")}</p>}

      <section aria-label="Pipeline" className="flex flex-wrap items-stretch gap-2">
        <Stage label="Drafts" value={sendable.length} note="from today's drift; not sent" />
        <Stage label="Sent to BOSS" value={sent === null ? "—" : sent.length} note={sent === null ? "db/009 not applied" : "recorded here; BOSS holds them"} />
        <Stage label="PR open on platform" value={signals.status === "ok" ? openBumps.length : "—"} note={signals.status === "ok" ? "pin-bump PRs the platforms opened" : signals.status === "unconfigured" ? "AGENT_GITHUB_TOKEN not set" : "GitHub unavailable"} />
        <Stage label="Checks green" value={signals.status === "ok" ? greenBumps.length : "—"} note={signals.status === "ok" ? "pin-bump PRs whose CI passed" : "the platform's CI is the gate"} />
        <Stage label="Agent runs" value={agentRuns.length} note={signals.status === "ok" ? `${runsWithPull} with a PR` : "Fix with agent hand-offs"} />
        <Stage label="Deployed, as reported" value={reports.status === "ok" ? deployed : "—"} note={reports.status === "ok" ? "the only state that counts" : "BOSS reports unavailable"} accent />
      </section>
      {signals.status !== "ok" && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{describePlatformUnavailable(signals)}</p>}

      <Panel title="Drafts" className="mt-8">
        {!observed.packages ? (
          <EmptyRow>No collector run yet, so there is nothing to compare against. Drafts appear once the collector has recorded published versions.</EmptyRow>
        ) : drafts.length === 0 ? (
          <EmptyRow>Nothing to propose: no declared pin is behind the version the collector saw on <span className={mono}>latest</span>.</EmptyRow>
        ) : (
          <div className="space-y-4">
            {drafts.map((d) => <DraftCard key={`${d.platform}/${d.environment}/${d.part?.n ?? 0}`} d={d} canSend={canSend} isAdmin={op?.role === "admin"} />)}
          </div>
        )}
        {!canSend && drafts.length > 0 && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {op?.role !== "admin" ? "Admins send proposals." : !registryWritable() ? "Sending needs CONSOLE_ADMIN_DATABASE_URL to record what was sent." : "Sending needs BOSS_API_URL and BOSS_OPERATOR_KEY (the console's operator key, minted by the owner with boss.pins.write), and you on BOSS's operator list."}
          </p>
        )}
      </Panel>

      <Panel title="Sent proposals" className="mt-8">
        {sent === null ? (
          <Notice>The console&apos;s record of sent proposals is not switched on yet: <span className={mono}>db/009_pin_proposals.sql</span> has not been applied. BOSS still holds whatever was sent.</Notice>
        ) : history.length === 0 ? (
          <EmptyRow>No proposal has been sent from this tenant yet.</EmptyRow>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400">
                <tr><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Platform · env</th><th className="px-4 py-3 font-medium">Pins</th><th className="px-4 py-3 font-medium">BOSS id</th><th className="px-4 py-3 font-medium">By</th><th className="px-4 py-3 font-medium">Platform PR</th><th className="px-4 py-3 font-medium">Reported state</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className={td} title={fmt(h.requestedAt)}>{ageLabel(h.requestedAt, now)}</td>
                    <td className={td}><span className="font-medium">{h.platform}</span> <span className={`${mono} text-gray-500 dark:text-gray-400`}>{h.environment}</span></td>
                    <td className={td}><ul className={`${mono} space-y-0.5`}>{h.pins.map((p) => <li key={p}>{p}</li>)}</ul></td>
                    <td className={`${td} ${mono}`}>{h.bossId}</td>
                    <td className={`${td} text-gray-600 dark:text-gray-300`}>{h.requestedBy}</td>
                    <td className={td}>{signals.status === "ok" ? <PullChip p={h.pull} /> : <span className="text-xs text-gray-500 dark:text-gray-400">—</span>}</td>
                    <td className={td}><StatusChip colour={DEPLOYED[h.state].colour} label={DEPLOYED[h.state].label} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Deployed means every pin&apos;s package is reported at the proposed version by that platform environment (<Link href="/boss/reports" className="underline">BOSS reports</Link>). Merging a pin does not deploy it; only the report counts.</p>
      </Panel>

      <Panel title="Pin-bump pull requests on the platforms" className="mt-8">
        {signals.status !== "ok" ? (
          <Notice>{describePlatformUnavailable(signals)}</Notice>
        ) : repos.length === 0 ? (
          <EmptyRow>No platform repository to read: no live project with a <span className={mono}>client</span> has a repository set.</EmptyRow>
        ) : pinBumps.length === 0 ? (
          <EmptyRow>No <span className={mono}>pin-bump/&lt;proposal id&gt;</span> branch has opened a pull request in {repos.join(", ")} yet. A platform&apos;s pin-bump job opens one per proposal it pulls.</EmptyRow>
        ) : (
          <Table head={["Opened", "Repository", "Pull request", "Proposal", "Checks"]}>
            {pinBumps.slice(0, 50).map((p) => (
              <tr key={p.url}>
                <td className={td} title={fmt(p.createdAt)}>{ageLabel(p.createdAt, now)}</td>
                <td className={`${td} ${mono}`}>{p.repo}</td>
                <td className={td}><PullChip p={{ ...p, checks: "none" }} /></td>
                <td className={td}><span className={mono}>{p.proposalId.slice(0, 8)}</span> {sentIds.has(p.proposalId) ? <span className={neutral}>sent from here</span> : <span className={neutral}>sent elsewhere</span>}</td>
                <td className={td}>{CHECKS[p.checks].colour ? <StatusChip colour={CHECKS[p.checks].colour!} label={CHECKS[p.checks].label} /> : <span className={neutral}>{CHECKS[p.checks].label}</span>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">CI on the pin-bump PR is the test-before-upgrading gate. The compat canary (W3-01) will post a check run on the same commit and appears here when it exists. Checks are read for open and the newest merged PRs only; a closed, unmerged PR is a refused proposal.</p>
      </Panel>

      <Panel title="Agent hand-offs" className="mt-8">
        {agentRuns.length === 0 ? (
          <EmptyRow>No &quot;Fix with agent&quot; hand-off has been recorded. Start one from <Link href="/drift" className="underline">Drift</Link>.</EmptyRow>
        ) : (
          <Table head={["Requested", "Project · env", "Upgrade", "Issue", "Agent's PR"]}>
            {agentRuns.slice(0, 30).map((r: AgentRun) => (
              <tr key={r.issueUrl}>
                <td className={td} title={fmt(r.requestedAt)}>{ageLabel(r.requestedAt, now)}</td>
                <td className={td}><Link href={`/projects/${r.projectSlug}`} className="font-medium underline">{r.projectSlug}</Link> <span className={`${mono} text-gray-500 dark:text-gray-400`}>{r.environment}</span></td>
                <td className={`${td} ${mono}`}>{r.package} {r.fromVersion} → {r.toVersion}</td>
                <td className={td}>{issueRef(r.issueUrl) ? <a href={r.issueUrl} target="_blank" rel="noreferrer noopener" className={`${mono} underline`}>#{issueRef(r.issueUrl)!.number}</a> : <span className="text-xs text-gray-500">not a GitHub issue</span>}</td>
                <td className={td}>{signals.status === "ok" ? <PullChip p={pullForRun(r, agentPulls)} /> : <span className="text-xs text-gray-500 dark:text-gray-400">—</span>}</td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">A hand-off&apos;s PR is the one in the same repository that names the issue. The agent is asked for a draft; a person merges, then sets the declared pin here.</p>
      </Panel>
    </div>
  );
}

function DraftCard({ d, canSend, isAdmin }: { d: Draft; canSend: boolean; isAdmin: boolean }) {
  const title = `${d.platform} · ${d.environment}${d.part ? ` · part ${d.part.n} of ${d.part.of}` : ""}`;
  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <span className="font-medium text-gray-800 dark:text-white/90">{d.platform}</span>
        <span className={`${mono} text-gray-500 dark:text-gray-400`}>{d.environment}</span>
        {d.part && <span className={neutral}>part {d.part.n} of {d.part.of}</span>}
        <StatusChip colour={BUMP[d.bump].colour} label={`largest step: ${BUMP[d.bump].label}`} />
        {d.alreadySent && <span className={neutral}>already sent with these pins</span>}
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{d.pins.length} pin{d.pins.length === 1 ? "" : "s"} · {new Set(d.pins.flatMap((p) => p.projects)).size} project{new Set(d.pins.flatMap((p) => p.projects)).size === 1 ? "" : "s"}</span>
      </div>
      <Table head={["Pin", "From", "Step", "Projects behind"]}>
        {d.pins.map((p) => (
          <tr key={p.pin}>
            <td className={`${td} ${mono} font-medium`}>{p.pin}</td>
            <td className={`${td} ${mono}`}>{p.from.join(", ")}</td>
            <td className={td}><StatusChip colour={BUMP[p.bump].colour} label={p.bump} /></td>
            <td className={`${td} text-xs`}>{p.projects.map((s, i) => <span key={s}>{i > 0 && ", "}<Link href={`/projects/${s}`} className="underline">{s}</Link></span>)}</td>
          </tr>
        ))}
      </Table>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">{d.bump === "major" ? "A major step: read the changelog before sending. The platform's CI on its pin-bump PR is the only test before upgrading until the compat canary (W3-01) exists." : "Pins are re-derived from the registry when you send; the form carries only this draft's name."}</p>
        {canSend && !d.alreadySent && (
          <form action={sendDraft} className="ml-auto">
            <input type="hidden" name="platform" value={d.platform} />
            <input type="hidden" name="environment" value={d.environment} />
            <input type="hidden" name="part" value={d.part?.n ?? ""} />
            <button className={buttonPrimary} aria-label={`Send ${title} to BOSS`}>Send to BOSS</button>
          </form>
        )}
        {isAdmin && !canSend && <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">Sending not enabled</span>}
      </div>
    </section>
  );
}
