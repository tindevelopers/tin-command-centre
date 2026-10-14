import { BoltIcon, BoxIcon, ListIcon, PieChartIcon, TableIcon } from "@tindevelopers/ui-shell/icons";
import type { Colour } from "@/src/status/types";
import type { CommandItem, CommandState } from "@/src/status/command";
import { stateLabel } from "@/src/status/command";
import { StatusDot } from "@/components/StatusUi";
import { btnCls } from "@/components/RegistryUi";

const panel = "rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]";
const eyebrow = "text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-gray-400";
const ghostBtn = "inline-flex min-h-11 items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-500 hover:text-brand-500 dark:border-gray-700 dark:text-gray-200";

const dotCls: Record<Colour, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };

export type BoardRow = { label: string; hint: string; value: string; colour: Colour | "neutral" };

/** Hero: the page's one-line promise, the overall state, and the two things an operator most often does next. */
export function Hero({ overall, email, role, onCollect, rows }: { overall: Colour; email: string; role: string; onCollect?: () => void | Promise<void>; rows: BoardRow[] }) {
  return (
    <section className="flex flex-wrap items-start gap-10">
      <div className="min-w-0 flex-[1_1_420px]">
        <p className={`${eyebrow} text-brand-500`}>Command Center</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-gray-800 dark:text-white/90">Everything TIN runs, in one place.</h1>
        <p className="mt-4 max-w-xl text-base text-gray-600 dark:text-gray-300">
          Every hub, package, app and cell, who owns it, and whether what is deployed matches what you declared. Start here, then act.
        </p>
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Overall: <StatusDot colour={overall} /> · signed in as {email} ({role})</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/drift" className={`${btnCls} inline-flex min-h-11 items-center px-5 py-2.5 text-base`}>See what has drifted</a>
          {onCollect && (
            <form action={onCollect}><button type="submit" className={ghostBtn}>Collect now</button></form>
          )}
        </div>
      </div>

      <div className={`${panel} min-w-0 flex-[1_1_360px]`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Right now</h2>
          <span className={eyebrow}>Situation board</span>
        </div>
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-4 py-3">
              <span className={`h-3 w-3 flex-none rounded-full ${r.colour === "neutral" ? "bg-brand-500" : dotCls[r.colour]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-800 dark:text-white/90">{r.label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{r.hint}</p>
              </div>
              <p className="font-mono text-xl text-gray-800 dark:text-white/90">{r.value}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Declared versus observed: the model the whole console is built on, in two cards and the gap between them. */
export function HowItWorks() {
  const list = "mt-4 list-disc space-y-1.5 pl-5 text-sm text-gray-700 dark:text-gray-300";
  return (
    <section className="mt-12">
      <p className={eyebrow}>How it works</p>
      <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-gray-800 dark:text-white/90">You declare it. The collector observes it. The gap is drift.</h2>
      <div className="mt-6 flex flex-wrap items-stretch gap-4">
        <div className={`${panel} min-w-0 flex-[1_1_300px]`}>
          <p className={`${eyebrow} text-brand-500`}>Declared</p>
          <h3 className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">What should be true</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Admins write this here. It is the system of record.</p>
          <ul className={list}>
            <li>Projects and how they relate</li>
            <li>Environments and pinned versions</li>
            <li>BOSS adoption mode per project</li>
            <li>Owners: people, groups, or another project</li>
          </ul>
        </div>
        <div className="flex flex-none items-center justify-center px-1">
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-dashed border-amber-500 px-4 py-2 font-mono text-sm text-amber-600 dark:text-amber-400">
            <PieChartIcon /> Drift
          </span>
        </div>
        <div className={`${panel} min-w-0 flex-[1_1_300px]`}>
          <p className={`${eyebrow} text-green-600 dark:text-green-400`}>Observed</p>
          <h3 className="mt-2 text-lg font-semibold text-gray-800 dark:text-white/90">What is actually there</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">The collector measures this daily, or on demand. It never edits the declaration.</p>
          <ul className={list}>
            <li>Package versions that are published</li>
            <li>Cell health, checked at <code className="font-mono">/readyz</code></li>
            <li>Credential metadata, never secrets</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

const destinations: { href: string; name: string; text: string; Icon: React.ComponentType }[] = [
  { href: "/projects", name: "Projects", text: "The registry: kinds, owners, environments, pins and relationships. Admins edit here.", Icon: ListIcon },
  { href: "/drift", name: "Drift", text: "Declared pins against what the collector sees, cells against their health, and projects with no owner.", Icon: PieChartIcon },
  { href: "/packages", name: "Hubs and packages", text: "Latest and next versions of every shared package, who depends on it, and where they diverge.", Icon: BoxIcon },
  { href: "/cells", name: "Cells", text: "Each running cell by client, ring and region, with its latest readiness check.", Icon: BoltIcon },
  { href: "/collector", name: "Collector", text: "Every collection run and how fresh the data is. Start a new run on demand.", Icon: TableIcon },
];

export function WhereToGo() {
  return (
    <section className="mt-12">
      <p className={eyebrow}>Where to go</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-800 dark:text-white/90">One picture, five views.</h2>
      <div className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {destinations.map(({ href, name, text, Icon }) => (
          <a key={href} href={href} className={`${panel} block min-h-11 hover:border-brand-500`}>
            <span className="text-brand-500"><Icon /></span>
            <h3 className="mt-3 text-lg font-semibold text-gray-800 dark:text-white/90">{name}</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{text}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

const badge: Record<CommandState, string> = {
  live: "bg-green-500 text-white",
  admin: "border border-gray-400 text-gray-600 dark:text-gray-300",
  setup: "border border-amber-500 text-amber-600 dark:text-amber-400",
  next: "border border-brand-500 text-brand-500",
};

/** The actions an operator can take from here, and whether each is switched on for them right now. */
export function CommandPanel({ items }: { items: CommandItem[] }) {
  return (
    <section className={`${panel} mt-12 flex flex-wrap items-start gap-10 p-8`}>
      <div className="min-w-0 flex-[1_1_300px]">
        <p className={`${eyebrow} text-brand-500`}>Command</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-800 dark:text-white/90">See it, then act on it.</h2>
        <p className="mt-3 max-w-md text-sm text-gray-600 dark:text-gray-300">
          Actions run through your existing tools, so every change leaves a trail you already trust. Admins only; every registry change is audited.
        </p>
      </div>
      <ul className="min-w-0 flex-[1_1_380px] divide-y divide-gray-100 border-y border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-4 py-4">
            <span className={`mt-0.5 flex-none rounded-md px-2 py-0.5 font-mono text-xs font-medium ${badge[it.state]}`}>{stateLabel(it.state)}</span>
            <div>
              <p className="font-medium text-gray-800 dark:text-white/90">{it.title}</p>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{it.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
