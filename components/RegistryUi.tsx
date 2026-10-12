import type { Colour } from "@/src/status/types";
import type { Finding } from "@/src/registry/types";
import { StatusDot, Table, td } from "@/components/StatusUi";

export const inputCls = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white";
export const btnCls = "rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white";
export const linkBtnCls = "text-sm underline";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-800 dark:text-white/90">{title}</h2>
      {children}
    </section>
  );
}

export function ErrorNotice({ message }: { message?: string }) {
  return message ? <p role="alert" className="mb-4 rounded-lg border border-error-500 px-4 py-3 text-sm text-error-500">{message}</p> : null;
}

export function Select({ name, options, defaultValue }: { name: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} autoComplete="off" className={inputCls}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Findings({ findings, showProject = false, onFix, runs = {} }: { findings: Finding[]; showProject?: boolean; onFix?: (f: FormData) => void | Promise<void>; runs?: Record<string, { issueUrl: string; ticketRef: string | null }> }) {
  return (
    <Table head={[...(showProject ? ["Project"] : []), "Environment", "Check", "What", "Status", ...(onFix ? [""] : [])]}>
      {findings.map((f, i) => (
        <tr key={i}>
          {showProject && <td className={`${td} font-medium`}><a className="underline" href={`/projects/${f.projectSlug}`}>{f.projectSlug}</a></td>}
          <td className={td}>{f.environment ?? "—"}</td>
          <td className={td}>{f.kind === "pin" ? `Pin ${f.subject}` : f.kind === "cell" ? `Cell ${f.subject}` : "Ownership"}</td>
          <td className={td}>{f.message}</td>
          <td className={td}><StatusDot colour={f.colour} /></td>
          {onFix && (
            <td className={td}>
              {f.kind === "pin" && f.environment && runs[`${f.projectSlug}|${f.environment}|${f.subject}`] ? (
                <a className="whitespace-nowrap text-xs underline" href={runs[`${f.projectSlug}|${f.environment}|${f.subject}`].issueUrl}>
                  Agent working{runs[`${f.projectSlug}|${f.environment}|${f.subject}`].ticketRef ? `: ${runs[`${f.projectSlug}|${f.environment}|${f.subject}`].ticketRef}` : ": view issue"}
                </a>
              ) : f.kind === "pin" && f.colour !== "green" && f.environment && (
                <form action={onFix}>
                  <input type="hidden" name="project" value={f.projectSlug} />
                  <input type="hidden" name="environment" value={f.environment} />
                  <input type="hidden" name="package" value={f.subject} />
                  <button className="whitespace-nowrap rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-white/5">Fix with agent</button>
                </form>
              )}
            </td>
          )}
        </tr>
      ))}
    </Table>
  );
}

export const colourOrder: Colour[] = ["red", "amber", "green"];
