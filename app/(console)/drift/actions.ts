"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { createIssue, findOpenIssue } from "@/src/agent/github";
import { buildPinTask, bumpSize, issueTitle, validRepo } from "@/src/agent/task";
import { loadObserved, loadRegistry, recordAgentRun } from "@/src/registry/db";
import { pinFinding } from "@/src/registry/drift";

/** Hand one drifting pin to an agent. Everything is re-derived from the registry here; the form only names the pin. */
export async function fixWithAgent(f: FormData) {
  const admin = await requireAdmin();
  const [project, environment, pkg] = ["project", "environment", "package"].map((k) => String(f.get(k) ?? ""));
  let result: string;
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
    const task = buildPinTask({
      repo: proj.repo, path: proj.path, project, environment, pkg, declared: pin.version, latest: snap.latest,
      observedAt: observed.run?.finishedAt ?? null, packageRepo: snap.repo ?? null,
      origin: host ? `https://${host}` : null, alsoBehind, requestedBy: admin.email,
    });

    // The duplicate check is a convenience: if it fails, still open the ticket (creating it reports any real access problem).
    const existing = await findOpenIssue(proj.repo, issueTitle({ pkg, declared: pin.version, latest: snap.latest, project, environment })).catch((e) => {
      console.error("duplicate check failed, creating the ticket anyway", e);
      return null;
    });
    if (existing) {
      result = `agentExisting=${encodeURIComponent(existing)}`;
    } else {
      const url = await createIssue(task);
      try {
        await recordAgentRun({ projectSlug: project, environment, package: pkg, fromVersion: pin.version, toVersion: snap.latest, issueUrl: url, requestedBy: admin.email });
      } catch (e) {
        console.error("could not record agent run", e); // the issue exists; losing the marker is not worth failing the request
      }
      result = `agent=${encodeURIComponent(url)}`;
    }
  } catch (e) {
    console.error("fix with agent failed", e);
    result = `agentError=${encodeURIComponent(e instanceof Error ? e.message : "Could not start the agent.")}`;
  }
  redirect(`/drift?${result}`);
}
