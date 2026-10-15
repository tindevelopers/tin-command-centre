import { requireOperator } from "@/src/auth/access";
import { agentConfigured } from "@/src/agent/github";
import { bySeverity, computeDrift } from "@/src/registry/drift";
import { loadObserved, loadRecentAudit, loadRegistry, registryConfigured, registryWritable } from "@/src/registry/db";
import { estateByKind, lifecycleCounts } from "@/src/registry/summary";
import { collectionConfigured } from "@/src/status/collect";
import { commandItems } from "@/src/status/command";
import { recentRuns } from "@/src/status/db";
import { ageLabel } from "@/src/status/format";
import { staleness, worst } from "@/src/status/rules";
import type { Colour } from "@/src/status/types";
import { currentTenant } from "@/src/tenancy/tenant";
import { ActionsTable, EmptyRow, EstateTable, KpiStrip, PageHeader, Panel, STATUS_LABEL, StatusChip, buttonPrimary, buttonSecondary } from "@/components/CommandCenter";
import type { Kpi } from "@/components/CommandCenter";
import { Findings } from "@/components/RegistryUi";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";
import { signOut } from "../signin/actions";
import { collectNow } from "./collector/actions";

export const dynamic = "force-dynamic";

const runColour = { ok: "green", partial: "amber", running: "amber", failed: "red" } as const;

export default async function OverviewPage() {
  const op = await requireOperator();
  const tenant = await currentTenant();
  const signOutForm = (
    <form action={signOut} className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
      Signed in as {op.email} ({op.role}). <button className="underline">Sign out</button>
    </form>
  );
  if (!registryConfigured()) {
    return <div><PageHeading title="Overview" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice>{signOutForm}</div>;
  }

  const now = new Date();
  const [reg, observed, runs, audit] = await Promise.all([loadRegistry(), loadObserved(), recentRuns(5).catch(() => []), loadRecentAudit(6)]);
  const findings = computeDrift(reg, observed.packages, observed.cells).sort(bySeverity);
  const count = (c: Colour) => findings.filter((f) => f.colour === c).length;
  const attention = findings.filter((f) => f.colour !== "green");
  const red = count("red");
  const amber = count("amber");
  const life = lifecycleCounts(reg);
  const finished = observed.run?.finishedAt ?? null;
  const fresh = staleness(finished, now);
  const overall = worst(findings.map((f) => f.colour).concat(observed.run ? [fresh] : ["red"]));
  const isAdmin = op.role === "admin";

  const kpis: Kpi[] = [
    { label: "Overall status", value: STATUS_LABEL[overall], sub: `${findings.length} checks run`, tone: overall },
    { label: "Active projects", value: String(life.active), sub: `${life.planned} planned · ${life.retired} retired`, tone: "none" },
    { label: "Action required", value: String(red), sub: "Pins behind, or cells failing", tone: red > 0 ? "red" : "green" },
    { label: "Attention", value: String(amber), sub: "Not yet seen, or no owner", tone: amber > 0 ? "amber" : "green" },
    { label: "Collector data", value: observed.run ? ageLabel(finished, now) : "None", sub: finished ? fmt(finished) : "No successful run yet", tone: observed.run ? fresh : "red" },
  ];
  const items = commandItems({ isAdmin, collectConfigured: collectionConfigured(), agentConfigured: agentConfigured(), registryWritable: registryWritable() });

  return (
    <div>
      <PageHeader tenant={tenant.slug} subtitle="What is running, who owns it, and whether it matches what was declared.">
        {isAdmin && collectionConfigured() && <form action={collectNow}><button type="submit" className={buttonSecondary}>Collect now</button></form>}
        <a href="/drift" className={buttonPrimary}>Review drift</a>
      </PageHeader>

      <KpiStrip items={kpis} />

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <Panel title="Attention required" link={attention.length > 8 ? { href: "/drift", label: `View all ${attention.length}` } : { href: "/drift", label: "Open drift" }} className="xl:col-span-2">
          {reg.projects.length === 0 ? (
            <EmptyRow>No projects are registered yet. <a className="underline" href="/projects">Add the first one.</a></EmptyRow>
          ) : attention.length === 0 ? (
            <EmptyRow>Nothing needs attention. Everything declared matches what was observed ({findings.length} checks).</EmptyRow>
          ) : (
            <Findings findings={attention.slice(0, 8)} showProject />
          )}
        </Panel>
        <Panel title="Estate by type" link={{ href: "/projects", label: "Open projects" }}>
          <EstateTable rows={estateByKind(reg, findings)} />
        </Panel>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Recent collections" link={{ href: "/collector", label: "Open collector" }}>
          {runs.length === 0 ? (
            <EmptyRow>No collector runs recorded yet.</EmptyRow>
          ) : (
            <Table head={["Run", "Started", "Status", "Note"]}>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} font-medium tabular-nums`}>{r.id}</td>
                  <td className={td} title={fmt(r.startedAt)}>{ageLabel(r.startedAt, now)}</td>
                  <td className={td}><StatusChip colour={runColour[r.status]} label={r.status} /></td>
                  <td className={`${td} max-w-[16rem] truncate text-gray-500 dark:text-gray-400`} title={r.error ?? undefined}>{r.error ?? "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
        <Panel title="Recent changes" link={{ href: "/projects", label: "Open projects" }}>
          {audit.length === 0 ? (
            <EmptyRow>No registry changes recorded yet.</EmptyRow>
          ) : (
            <Table head={["When", "Who", "Change"]}>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td className={td} title={fmt(a.at)}>{ageLabel(a.at, now)}</td>
                  <td className={`${td} max-w-[10rem] truncate`} title={a.actor}>{a.actor}</td>
                  <td className={td}><span className="font-medium">{a.action.toLowerCase()}</span> {a.table.replace(/_/g, " ")}{a.subject ? <span className="text-gray-500 dark:text-gray-400"> · {a.subject}</span> : null}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <Panel title="Actions available to you" className="mt-8">
        <ActionsTable items={items} />
      </Panel>

      {signOutForm}
    </div>
  );
}
