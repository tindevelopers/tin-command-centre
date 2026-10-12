import Link from "next/link";
import { computeDrift } from "@/src/registry/drift";
import type { AgentRun, Observed } from "@/src/registry/db";
import type { Registry } from "@/src/registry/types";
import { filterFindings, filterPackageRows, packageMatrix, parseDriftFilters } from "@/src/registry/view";
import { staleness } from "@/src/status/rules";
import FilterBar from "@/components/FilterBar";
import type { FilterField } from "@/components/FilterBar";
import PackageMatrix from "@/components/PackageMatrix";
import { Findings } from "@/components/RegistryUi";
import { Notice, PageHeading, StatusDot, fmt } from "@/components/StatusUi";

const tab = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-500 text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`;

export default function DriftView({ reg, observed, sp, onFix, agentRuns = [] }: { reg: Registry; observed: Observed; sp: Record<string, string | string[] | undefined>; onFix?: (f: FormData) => void | Promise<void>; agentRuns?: AgentRun[] }) {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const f = parseDriftFilters(sp);
  // A hand-off only counts while the pin is still at the version it was raised for; once the pin moves on, the marker goes.
  const runs: Record<string, { issueUrl: string; ticketRef: string | null }> = {};
  for (const r of [...agentRuns].reverse()) if (reg.pins.some((p) => p.projectSlug === r.projectSlug && p.environment === r.environment && p.package === r.package && p.version === r.fromVersion)) runs[`${r.projectSlug}|${r.environment}|${r.package}`] = { issueUrl: r.issueUrl, ticketRef: r.ticketRef };
  const findings = computeDrift(reg, observed.packages, observed.cells);
  const age = staleness(observed.run?.finishedAt ?? null, new Date());

  const statusField: FilterField = {
    kind: "select", name: "status", label: "Show", value: f.status,
    options: [{ value: "", label: "Needs attention (red and amber)" }, { value: "red", label: "Failing only" }, { value: "amber", label: "Attention only" }, { value: "all", label: "Everything" }],
  };
  const fields: FilterField[] = f.view === "package"
    ? [{ kind: "search", name: "q", label: "Search packages or projects", value: f.q, placeholder: "Search package or project…" }, statusField]
    : [
        { kind: "search", name: "q", label: "Search findings", value: f.q, placeholder: "Search project, package…" }, statusField,
        { kind: "select", name: "kind", label: "Check", value: f.kind, options: [{ value: "", label: "Any" }, { value: "pin", label: "Package versions" }, { value: "cell", label: "Cell health" }, { value: "owner", label: "Ownership" }] },
      ];

  const matrix = packageMatrix(reg, observed.packages);
  const shownPackages = filterPackageRows(matrix, f);
  const shownFindings = filterFindings(findings, f);
  const viewHref = (view: string) => (view === "project" ? "/drift" : `/drift?view=${view}`);

  return (
    <div>
      <PageHeading title="Drift" subtitle="What the registry declares versus what the collector last observed. The registry is authoritative: drift means reality needs to change, or the declaration does." />
      {observed.run ? (
        <p className="mb-4 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">Observed at {fmt(observed.run.finishedAt)} <StatusDot colour={age} /></p>
      ) : (
        <Notice>The collector has not completed a run, so nothing can be compared yet. Package and cell checks show as needing attention until it does.</Notice>
      )}
      {age !== "green" && observed.run && <Notice>The observed data is stale, so the findings below may not reflect reality.</Notice>}

      {/^https:\/\/github\.com\//.test(one("agent")) && (
        <Notice>
          Agent started{one("agentTicket") ? <> under support ticket <strong>{one("agentTicket")}</strong></> : null}: <a className="underline" href={one("agent")}>{one("agent")}</a>. It will open a draft pull request for review.
          {one("agentWarn") && <> {one("agentWarn")}</>}
        </Notice>
      )}
      {one("agentRefused") && <Notice>Not sent to the agent. {one("agentRefused")}</Notice>}
      {/^https:\/\/github\.com\//.test(one("agentExisting")) && <Notice>An agent ticket is already open for this upgrade: <a className="underline" href={one("agentExisting")}>{one("agentExisting")}</a>.</Notice>}
      {one("agentError") && <Notice>{one("agentError")}</Notice>}

      <nav className="my-4 flex gap-2" aria-label="Drift views">
        <Link href={viewHref("project")} className={tab(f.view === "project")} aria-current={f.view === "project" ? "page" : undefined}>By project</Link>
        <Link href={viewHref("package")} className={tab(f.view === "package")} aria-current={f.view === "package" ? "page" : undefined}>By package</Link>
      </nav>

      {reg.projects.length === 0 ? (
        <Notice>No projects are registered yet. <a className="underline" href="/projects">Add the first one.</a></Notice>
      ) : f.view === "package" ? (
        <>
          <FilterBar fields={fields} shown={shownPackages.length} total={matrix.length} noun="packages" />
          {shownPackages.length === 0 ? <Notice>Nothing to show for these filters.</Notice> : <PackageMatrix rows={shownPackages} />}
        </>
      ) : (
        <>
          <FilterBar fields={fields} shown={shownFindings.length} total={findings.length} noun="checks" />
          {shownFindings.length === 0 ? <Notice>Nothing to show for these filters.</Notice> : <Findings findings={shownFindings} showProject onFix={onFix} runs={runs} />}
        </>
      )}
    </div>
  );
}
