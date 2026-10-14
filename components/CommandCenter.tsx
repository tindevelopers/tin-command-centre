import type { Colour } from "@/src/status/types";
import type { CommandItem, CommandState } from "@/src/status/command";
import { stateLabel } from "@/src/status/command";
import type { KindRow } from "@/src/registry/summary";
import { Table, td } from "@/components/StatusUi";

/** Overview building blocks. Compact, neutral and data-first; colour is reserved for status. */

const card = "rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]";
export const buttonPrimary = "inline-flex min-h-9 items-center rounded-md bg-brand-500 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-600";
export const buttonSecondary = "inline-flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:bg-white/5";

const chip: Record<Colour, string> = {
  green: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};
const dot: Record<Colour, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };
const bar: Record<Colour | "none", string> = { green: "border-l-green-500", amber: "border-l-amber-500", red: "border-l-red-500", none: "border-l-gray-300 dark:border-l-gray-700" };

export const STATUS_LABEL: Record<Colour, string> = { green: "Healthy", amber: "Attention", red: "Action required" };

export function StatusChip({ colour, label }: { colour: Colour; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${chip[colour]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[colour]}`} aria-hidden />
      {label ?? STATUS_LABEL[colour]}
    </span>
  );
}

/** Breadcrumb, title, the tenant in scope, and the page's actions. */
export function PageHeader({ tenant, subtitle, children }: { tenant: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 dark:text-gray-400">Command Center <span aria-hidden>/</span> <span className="text-gray-700 dark:text-gray-200">Overview</span></nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Overview</h1>
          <span className="rounded border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300" title="The tenant this view is scoped to">Tenant: {tenant}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
    </header>
  );
}

export type Kpi = { label: string; value: string; sub: string; tone: Colour | "none" };

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((k) => (
        <div key={k.label} className={`${card} border-l-4 p-4 ${bar[k.tone]}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{k.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{k.value}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{k.sub}</p>
        </div>
      ))}
    </section>
  );
}

/** A titled section with an optional link to the full view. */
export function Panel({ title, link, children, className = "" }: { title: string; link?: { href: string; label: string }; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">{title}</h2>
        {link && <a className="text-xs text-brand-500 hover:underline" href={link.href}>{link.label}</a>}
      </div>
      {children}
    </section>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className={`${card} px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400`}>{children}</p>;
}

const num = `${td} text-right tabular-nums`;

export function EstateTable({ rows }: { rows: KindRow[] }) {
  if (rows.length === 0) return <EmptyRow>No projects are registered yet.</EmptyRow>;
  const total = rows.reduce((a, r) => ({ projects: a.projects + r.projects, red: a.red + r.red, amber: a.amber + r.amber }), { projects: 0, red: 0, amber: 0 });
  return (
    <Table head={["Type", "Projects", "Action", "Attention"]}>
      {rows.map((r) => (
        <tr key={r.kind}>
          <td className={`${td} font-medium`}>{r.kind}</td>
          <td className={num}>{r.projects}</td>
          <td className={`${num} ${r.red ? "font-medium text-red-600 dark:text-red-400" : "text-gray-400"}`}>{r.red}</td>
          <td className={`${num} ${r.amber ? "font-medium text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>{r.amber}</td>
        </tr>
      ))}
      <tr className="bg-gray-50 font-medium dark:bg-white/5">
        <td className={td}>Total</td>
        <td className={num}>{total.projects}</td>
        <td className={num}>{total.red}</td>
        <td className={num}>{total.amber}</td>
      </tr>
    </Table>
  );
}

const badge: Record<CommandState, string> = {
  live: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  admin: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  setup: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  next: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
};
const stateNote: Record<CommandState, string> = { live: "Available", admin: "Admins only", setup: "Needs setup", next: "Planned" };

/** What the signed-in operator can do from here, and whether each action is switched on for them. */
export function ActionsTable({ items }: { items: CommandItem[] }) {
  return (
    <Table head={["Action", "What it does", "Status"]}>
      {items.map((it) => (
        <tr key={it.id}>
          <td className={`${td} font-medium`}>{it.title}</td>
          <td className={`${td} text-gray-600 dark:text-gray-300`}>{it.detail}</td>
          <td className={td}><span className={`rounded px-2 py-0.5 font-mono text-xs font-medium ${badge[it.state]}`} title={stateNote[it.state]}>{stateLabel(it.state)}</span></td>
        </tr>
      ))}
    </Table>
  );
}
