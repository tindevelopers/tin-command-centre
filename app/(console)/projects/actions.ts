"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { statementsFor } from "@/src/registry/commands";
import { careHubConfig, resolveCareHubTicket } from "@/src/agent/carehub";
import { resolveTicketsForPin } from "@/src/agent/resolve";
import { markTicketsResolved, openTicketRuns, registryWrite } from "@/src/registry/db";
import { ValidationError, parseCommand } from "@/src/registry/validate";
import type { Command } from "@/src/registry/validate";

/** A pin that reaches the version an agent ticket was raised for resolves that ticket. Never fails the save: the pin is already written. */
async function resolveUpgradeTickets(cmd: Extract<Command, { type: "setPin" }>, actor: string) {
  const cfg = careHubConfig();
  if (!cfg) return;
  try {
    const { errors } = await resolveTicketsForPin(
      { openRuns: openTicketRuns, resolveTicket: (ticketId, note) => resolveCareHubTicket({ ticketId, note }, cfg), markResolved: markTicketsResolved },
      { project: cmd.slug, environment: cmd.environment, pkg: cmd.package, version: cmd.version, actor },
    );
    for (const e of errors) console.error("could not resolve support ticket", e);
  } catch (e) {
    console.error("resolving support tickets failed", e);
  }
}

async function apply(type: Command["type"], form: FormData) {
  const admin = await requireAdmin(); // checked here, not just in the page: server actions are callable directly
  let slug = String(form.get("slug") ?? "");
  let error: string | null = null;
  try {
    const cmd = parseCommand(type, form);
    slug = cmd.slug;
    await registryWrite(admin.email, statementsFor(cmd));
    if (cmd.type === "setPin") await resolveUpgradeTickets(cmd, admin.email);
  } catch (e) {
    if (e instanceof ValidationError) error = e.message;
    else {
      console.error("registry write failed", type, e);
      error = "Could not save. Check the values and try again.";
    }
  }
  revalidatePath("/projects", "layout");
  revalidatePath("/drift");
  const back = `/projects/${encodeURIComponent(slug)}`;
  // A failed create has no project page to return to yet.
  const failTo = type === "upsertProject" ? "/projects" : back;
  redirect(error ? `${failTo}?error=${encodeURIComponent(error)}` : back);
}

export async function saveProject(f: FormData) {
  return apply("upsertProject", f);
}
export async function saveEnvironment(f: FormData) {
  return apply("upsertEnvironment", f);
}
export async function setPin(f: FormData) {
  return apply("setPin", f);
}
export async function removePin(f: FormData) {
  return apply("removePin", f);
}
export async function setAdoption(f: FormData) {
  return apply("setAdoption", f);
}
export async function assign(f: FormData) {
  return apply("assign", f);
}
export async function unassign(f: FormData) {
  return apply("unassign", f);
}
export async function addRelation(f: FormData) {
  return apply("addRelation", f);
}
export async function removeRelation(f: FormData) {
  return apply("removeRelation", f);
}
