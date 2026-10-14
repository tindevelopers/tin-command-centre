import { requireOperator } from "@/src/auth/access";
import { bySeverity, computeDrift } from "@/src/registry/drift";
import { loadObserved, loadRegistry, registryConfigured } from "@/src/registry/db";
import { staleness, worst } from "@/src/status/rules";
import type { Colour } from "@/src/status/types";
import { agentConfigured } from "@/src/agent/github";
import { registryWritable } from "@/src/registry/db";
import { commandItems } from "@/src/status/command";
import { collectionConfigured } from "@/src/status/collect";
import { Findings } from "@/components/RegistryUi";
import { CommandPanel, Hero, HowItWorks, WhereToGo } from "@/components/CommandCenter";
import type { BoardRow } from "@/components/CommandCenter";
import { Notice, PageHeading, fmt } from "@/components/StatusUi";
import { signOut } from "../signin/actions";
import { collectNow } from "./collector/actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const op = await requireOperator();
  const signOutForm = <form action={signOut} className="mt-8 text-sm text-gray-500">Signed in as {op.email} ({op.role}). <button className="underline">Sign out</button></form>;
  if (!registryConfigured()) {
    return <div><PageHeading title="Overview" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice>{signOutForm}</div>;
  }

  const [reg, observed] = await Promise.all([loadRegistry(), loadObserved()]);
  const findings = computeDrift(reg, observed.packages, observed.cells).sort(bySeverity);
  const count = (c: Colour) => findings.filter((f) => f.colour === c).length;
  const attention = findings.filter((f) => f.colour !== "green");
  const active = reg.projects.filter((p) => p.lifecycle === "active").length;
  const age = staleness(observed.run?.finishedAt ?? null, new Date());

  const overall = worst(findings.map((f) => f.colour).concat(observed.run ? [age] : ["red"]));
  const red = count("red");
  const amber = count("amber");
  const rows: BoardRow[] = [
    { label: "Collector freshness", hint: "Green under 26 h, amber to 50 h, red beyond", value: observed.run ? fmt(observed.run.finishedAt).slice(5, 16) : "none", colour: observed.run ? age : "red" },
    { label: "Needs action", hint: "A pin behind what the collector sees, or a failing cell", value: String(red), colour: red > 0 ? "red" : "green" },
    { label: "Needs attention", hint: "Not seen yet, or no owner", value: String(amber), colour: amber > 0 ? "amber" : "green" },
    { label: "Active projects", hint: `${reg.projects.length} registered`, value: String(active), colour: "neutral" },
  ];
  const items = commandItems({ isAdmin: op.role === "admin", collectConfigured: collectionConfigured(), agentConfigured: agentConfigured(), registryWritable: registryWritable() });

  return (
    <div>
      <Hero overall={overall} email={op.email} role={op.role} rows={rows} onCollect={op.role === "admin" && collectionConfigured() ? collectNow : undefined} />

      <h2 className="mb-3 mt-12 text-lg font-semibold text-gray-800 dark:text-white/90">Most urgent</h2>
      {reg.projects.length === 0 ? (
        <Notice>No projects are registered yet. <a className="underline" href="/projects">Add the first one.</a></Notice>
      ) : attention.length === 0 ? (
        <Notice>Everything declared matches what was observed ({findings.length} checks).</Notice>
      ) : (
        <>
          <Findings findings={attention.slice(0, 8)} showProject />
          <p className="mt-3 text-sm"><a className="underline" href="/drift">All {attention.length} findings</a> · overall {worst(findings.map((f) => f.colour))}</p>
        </>
      )}
      <HowItWorks />
      <WhereToGo />
      <CommandPanel items={items} />
      {signOutForm}
    </div>
  );
}
