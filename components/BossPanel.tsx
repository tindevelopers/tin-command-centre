import { describeUnavailable } from "@/src/boss/reports";
import type { ReportHealth, ReportsResult } from "@/src/boss/reports";
import type { PlatformRow } from "@/src/boss/summary";
import { ageLabel } from "@/src/status/format";
import { StatusChip } from "@/components/ControlPlane";
import { Notice, fmt } from "@/components/StatusUi";

const HEALTH: Record<ReportHealth, { colour: "green" | "amber" | "red"; label: string }> = {
  ok: { colour: "green", label: "health ok" },
  degraded: { colour: "amber", label: "degraded" },
  down: { colour: "red", label: "down" },
};

const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const mono = "font-mono text-xs";

/** Shortens `@tindevelopers/credential-crypto` to `credential-crypto` for display; the full name stays in the title attribute. */
const short = (name: string) => name.replace(/^@[^/]+\//, "");

/**
 * What each platform environment reports to BOSS, for the Overview. Every value is registry data or a field the reader has already
 * validated against a strict pattern (src/boss/reports.ts); React escapes it on render. Fixed strings only when BOSS is not "ok".
 */
export function BossPanel({ rows, result, now = new Date() }: { rows: PlatformRow[]; result: ReportsResult; now?: Date }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {result.status !== "ok" && <div className="border-b border-gray-100 p-3 dark:border-gray-800"><Notice>{describeUnavailable(result)}</Notice></div>}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">No platform is registered yet. A project with a client names a platform.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => (
            <li key={`${r.platform}/${r.environment}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-gray-800 dark:text-white/90">{r.platform}</span>
              <span className={`${mono} text-gray-500 dark:text-gray-400`}>{r.environment}</span>
              {r.state === "reported" && r.health ? (
                <StatusChip colour={HEALTH[r.health].colour} label={HEALTH[r.health].label} />
              ) : (
                <span className={neutral}>{r.state === "unavailable" ? "unknown" : "not reported"}</span>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                {r.components.map((c) => (
                  <span key={c.component} title={Object.entries(c.versions).map(([k, v]) => `${k} ${v}`).join(", ")}>
                    <span className={mono}>{c.component}</span>
                    {Object.entries(c.versions).slice(0, 2).map(([k, v]) => <span key={k} className={`${mono} ml-1`}>{short(k)} {v}</span>)}
                    {Object.keys(c.versions).length > 2 && <span className="ml-1">+{Object.keys(c.versions).length - 2}</span>}
                    {c.errorCount > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">{c.errorCount} errors</span>}
                  </span>
                ))}
                {r.reportedAt ? <span title={fmt(r.reportedAt)}>{ageLabel(r.reportedAt, now)}</span> : <span>{r.state === "unavailable" ? "—" : "never"}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
