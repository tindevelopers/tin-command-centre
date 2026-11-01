import Link from "next/link";
import { TOPOLOGY_DECIDED_ON } from "@/config/topology";
import type { TopologyStatus } from "@/config/topology";
import { PACKAGE_STATE_LABEL, filterHubRows, hubTotals, parseHubFilters } from "@/src/registry/hubs";
import type { HubRow, HubPackage, PackageState } from "@/src/registry/hubs";
import type { Colour, CollectorRun } from "@/src/status/types";
import FilterBar from "@/components/FilterBar";
import type { FilterField } from "@/components/FilterBar";
import { EmptyRow, StatusChip } from "@/components/ControlPlane";
import { Table, fmt, td } from "@/components/StatusUi";

const chip = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium";
const neutral = `${chip} bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300`;
const plan = `${chip} bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300`;
const mono = "font-mono text-xs";

const STATE_COLOUR: Record<PackageState, Colour> = { ok: "green", "awaiting-promotion": "amber", unpublished: "red", "known-drift": "amber", divergent: "red" };
const TOPOLOGY_LABEL: Record<TopologyStatus, string> = { existing: "Keeps", planned: "Planned", rename: "Rename", archive: "To be archived", shrink: "Shrinks" };

/** The one line that sums a hub up: its worst package state, or its topology status when it has no packages yet. */
function hubStatus(r: HubRow) {
  const order: PackageState[] = ["divergent", "unpublished", "awaiting-promotion", "known-drift", "ok"];
  const s = order.find((k) => r.counts[k] > 0);
  if (s) return <StatusChip colour={STATE_COLOUR[s]} label={s === "ok" ? "OK" : `${r.counts[s]} ${PACKAGE_STATE_LABEL[s].toLowerCase()}`} />;
  if (r.topologyStatus) return <span className={plan}>{TOPOLOGY_LABEL[r.topologyStatus]}</span>;
  return <span className={neutral}>No packages seen</span>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: Colour }) {
  const colour = tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-gray-800 dark:text-white/90";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
    </div>
  );
}

function PackageTable({ packages }: { packages: HubPackage[] }) {
  return (
    <Table head={["Package", "Branch", "Latest", "Next", "Dependents", "Divergence", "Status"]}>
      {packages.map((p) => (
        <tr key={p.package}>
          <td className={`${td} font-medium`}><span className={mono}>{p.package}</span></td>
          <td className={`${td} ${mono}`}>{p.branchVersion ?? "—"}</td>
          <td className={`${td} ${mono}`}>{p.latest ?? "—"}</td>
          <td className={`${td} ${mono}`}>{p.next ?? "—"}</td>
          <td className={`${td} text-xs text-gray-600 dark:text-gray-300`} title={p.dependents.join(", ")}>{p.dependents.length === 0 ? "—" : `${p.dependents.length}`}</td>
          <td className={`${td} max-w-[22rem] truncate text-xs text-gray-500 dark:text-gray-400`} title={p.divergence}>{p.divergence}</td>
          <td className={td}><StatusChip colour={p.colour} label={PACKAGE_STATE_LABEL[p.state]} /></td>
        </tr>
      ))}
    </Table>
  );
}

/**
 * Hubs and packages: one expandable row per hub with its packages inside. Filters live in the URL. Everything shown is collector
 * data (validated on write by the collector), registry data, or the topology decision file; React escapes it on render.
 */
export default function HubsView({ rows, run, sp }: { rows: HubRow[]; run: CollectorRun | null; sp: Record<string, string | string[] | undefined> }) {
  const f = parseHubFilters(sp);
  const shown = filterHubRows(rows, f);
  const totals = hubTotals(rows);
  const fields: FilterField[] = [
    { kind: "search", name: "q", label: "Search hubs or packages", value: f.q, placeholder: "Search hub, nickname or package…" },
    { kind: "select", name: "view", label: "Hubs", value: f.view === "all" ? "" : f.view, options: [{ value: "", label: "All hubs" }, { value: "existing", label: "With packages" }, { value: "planned", label: "Planned" }, { value: "changing", label: "Renamed, shrinking or archived" }] },
    { kind: "select", name: "state", label: "Package state", value: f.state, options: [{ value: "", label: "Any package state" }, ...(Object.keys(PACKAGE_STATE_LABEL) as PackageState[]).map((s) => ({ value: s, label: PACKAGE_STATE_LABEL[s] }))] },
  ];

  return (
    <div>
      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Hubs in the plan" value={totals.hubs} sub={`${totals.withPackages} have published packages`} />
        <Tile label="Packages" value={totals.packages} sub={`${totals.published} published`} />
        <Tile label="Awaiting promotion" value={totals["awaiting-promotion"]} sub="next ahead of latest" tone={totals["awaiting-promotion"] > 0 ? "amber" : undefined} />
        <Tile label="Unpublished or divergent" value={totals.unpublished + totals.divergent} tone={totals.unpublished + totals.divergent > 0 ? "red" : undefined} />
        <Tile label="Known drift" value={totals["known-drift"]} sub="allowlisted in the registry" tone={totals["known-drift"] > 0 ? "amber" : undefined} />
      </section>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {run ? <>Packages from collector run {run.id}, finished {fmt(run.finishedAt)}. </> : <>No collector run yet: only the plan is shown. </>}
        Topology as decided on {TOPOLOGY_DECIDED_ON} (TD-10); a project&apos;s <span className={mono}>tin.info/*</span> annotations override it. Promotion of <span className={mono}>next</span> to <span className={mono}>latest</span> is an owner gate and is not done from here.
      </p>

      <div className="mt-6">
        <FilterBar fields={fields} shown={shown.length} total={rows.length} noun="hubs" />
      </div>

      {shown.length === 0 ? (
        <EmptyRow>No hub matches these filters.</EmptyRow>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Hub</th>
                <th className="px-4 py-3 font-medium">Layer · risk</th>
                <th className="px-4 py-3 text-right font-medium">Packages</th>
                <th className="px-4 py-3 font-medium">Dependents</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Topology</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {shown.map((r) => (
                <HubRowView key={r.repo} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A hub row that opens into its package table. `<details>` keeps the page server-rendered and the state in the browser only;
 * the summary row is the clickable part, so the whole row is a 44px target.
 */
function HubRowView({ r }: { r: HubRow }) {
  const summary = (
    <>
      <td className={`${td} font-medium`}>
        <span className="text-gray-800 dark:text-white/90">{r.repo}</span>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {r.nickname ?? ""}{r.nickname && r.projectSlug ? " · " : ""}{r.projectSlug && <Link href={`/projects/${r.projectSlug}`} className="underline">registry</Link>}
        </div>
      </td>
      <td className={`${td} ${mono} text-gray-600 dark:text-gray-300`}>{r.layer && r.riskClass ? `${r.layer} · ${r.riskClass}` : "—"}</td>
      <td className={`${td} text-right tabular-nums`}>{r.packages.length}</td>
      <td className={`${td} text-xs text-gray-600 dark:text-gray-300`} title={r.dependents.join(", ")}>{r.dependents.length === 0 ? "—" : `${r.dependents.length} in-estate`}</td>
      <td className={`${td} ${mono} text-gray-600 dark:text-gray-300`}>{r.ownerGroup ? `group:${r.ownerGroup}` : "—"}</td>
      <td className={`${td} max-w-[24rem] text-xs text-gray-600 dark:text-gray-300`}>
        {r.topologyStatus && <span className={`${plan} mr-2`}>{TOPOLOGY_LABEL[r.topologyStatus]}</span>}
        {r.topologyNote ?? "Not in the topology plan."}
        {r.tasks.length > 0 && <span className={`${mono} ml-1 text-gray-500`}>{r.tasks.join(" · ")}</span>}
      </td>
      <td className={td}>{hubStatus(r)}</td>
    </>
  );
  if (r.packages.length === 0) return <tr>{summary}</tr>;
  return (
    <>
      <tr>{summary}</tr>
      <tr>
        <td colSpan={7} className="bg-gray-50/60 p-0 dark:bg-white/[0.02]">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
              <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
              {r.packages.length} package{r.packages.length === 1 ? "" : "s"} in {r.repo}
            </summary>
            <div className="px-4 pb-4"><PackageTable packages={r.packages} /></div>
          </details>
        </td>
      </tr>
    </>
  );
}
