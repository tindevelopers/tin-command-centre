"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { createCareHubTicket, careHubConfigured } from "@/src/agent/carehub";
import { dispatchPin } from "@/src/agent/dispatch";
import { commentOnIssue, createIssue, findOpenIssue } from "@/src/agent/github";
import { readRepoPin } from "@/src/agent/repo";
import { bumpSize, validRepo } from "@/src/agent/task";
import { loadObserved, loadRegistry, recordAgentRun } from "@/src/registry/db";
import { pinFinding } from "@/src/registry/drift";

/** Hand one drifting pin to an agent. Everything is re-derived from the registry here; the form only names the pin. */
export async function fixWithAgent(f: FormData) {
  const admin = await requireAdmin();
  const [project, environment, pkg] = ["project", "environment", "package"].map((k) => String(f.get(k) ?? ""));
  let result = "";
  try {
    const [reg, observed] = await Promise.all([loadRegistry(), loadObserved()]);
    const pin = reg.pins.find((p) => p.projectSlug === project && p.environment === environment && p.package === pkg);
    const proj = reg.projects.find((p) => p.slug === project);
    const snap = observed.packages?.find((s) => s.package === pkg);
    if (!pin || !proj) throw new Error("That pin is not in the registry.");
    if (!validRepo(proj.repo)) throw new Error("The project has no repository set.");
    if (!snap?.latest || pinFinding(pin, snap).colour === "green") throw new Error("Nothing to upgrade: the pin is not behind a published version.");

    const live = new Set(reg.projects.filter((p) => p.lifecycle !== "retired").map((p) => p.slug));
    const alsoBehind = reg.pins
      .filter((p) => p.package === pkg && live.has(p.projectSlug) && bumpSize(p.version, snap.latest!))
      .map((p) => ({ slug: p.projectSlug, environment: p.environment, version: p.version }));
    const host = (await headers()).get("host");

    const outcome = await dispatchPin(
      {
        readRepoPin, findOpenIssue, createIssue, commentOnIssue, recordRun: recordAgentRun,
        createTicket: careHubConfigured() ? (t) => createCareHubTicket(t) : null,
      },
      {
        repo: proj.repo, path: proj.path, project, environment, pkg, declared: pin.version, latest: snap.latest,
        observedAt: observed.run?.finishedAt ?? null, packageRepo: snap.repo ?? null,
        origin: host ? `https://${host}` : null, alsoBehind, requestedBy: admin.email,
      },
    );

    if (outcome.kind === "refused") result = `agentRefused=${encodeURIComponent(outcome.reason)}`;
    else if (outcome.kind === "existing") result = `agentExisting=${encodeURIComponent(outcome.issueUrl)}`;
    else {
      result = `agent=${encodeURIComponent(outcome.issueUrl)}`;
      if (outcome.ticket) result += `&agentTicket=${encodeURIComponent(outcome.ticket.number)}`;
      if (outcome.warnings.length) result += `&agentWarn=${encodeURIComponent(outcome.warnings.join(" "))}`;
    }
  } catch (e) {
    console.error("fix with agent failed", e);
    result = `agentError=${encodeURIComponent(e instanceof Error ? e.message : "Could not start the agent.")}`;
  }
  redirect(`/drift?${result}`);
}
