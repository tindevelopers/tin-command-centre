import { describeUnavailable } from "@/src/boss/reports";
import type { ReportsResult } from "@/src/boss/reports";
import type { DeployState, PinComparison } from "@/src/boss/compare";
import { Notice, Table, fmt, td } from "@/components/StatusUi";

const STATE: Record<DeployState, { label: string; dot: string }> = {
  deployed: { label: "Deployed", dot: "bg-green-500" },
  "not-deployed": { label: "Not deployed", dot: "bg-red-500" },
  "not-reported": { label: "Not reported", dot: "bg-amber-500" },
  unavailable: { label: "Unavailable", dot: "bg-amber-500" },
};

/**
 * Declared versus the versions the platform reported to BOSS. Everything shown is either registry data or a value the reader has
 * already validated against a strict pattern (src/boss/reports.ts); React escapes it on render and nothing is injected as HTML.
 */
export function ReportedPins({ comparisons, result }: { comparisons: PinComparison[]; result: ReportsResult }) {
  return (
    <div>
      {result.status !== "ok" && <div className="mb-3"><Notice>{describeUnavailable(result)} Nothing below is shown as deployed.</Notice></div>}
      <Table head={["Environment", "Package", "Declared", "Reported", "Status"]}>
        {comparisons.map((c) => (
          <tr key={`${c.environment}/${c.package}`}>
            <td className={td}>{c.environment}</td>
            <td className={`${td} font-medium`}>{c.package}</td>
            <td className={td}>{c.declared}</td>
            <td className={td}>
              {c.reported.length === 0 ? "—" : c.reported.map((r) => (
                <div key={r.component}>
                  {r.version} <span className="text-xs text-gray-500">({r.component}, {r.health}, {fmt(r.reportedAt)})</span>
                </div>
              ))}
            </td>
            <td className={td}>
              <span className="inline-flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${STATE[c.state].dot}`} aria-hidden />
                <span>{STATE[c.state].label}</span>
              </span>
              <div className="mt-1 text-xs text-gray-500">{c.message}</div>
            </td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-gray-500">Reported by the platform to BOSS. A pin counts as deployed only when the reported version matches it; merging a pin does not deploy it.</p>
    </div>
  );
}
