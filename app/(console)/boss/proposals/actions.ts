"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { buildDrafts, findDraft } from "@/src/boss/drafts";
import { describeProposeFailure, sendProposal } from "@/src/boss/propose";
import { loadObserved, loadPinProposals, loadRegistry, recordPinProposal } from "@/src/registry/db";

/**
 * Send one draft to BOSS. The form names only the draft (platform, environment, part); the pins are re-derived from the registry
 * and the collector here, so a stale or edited form cannot send anything the registry does not say. Autonomy class A1: a person
 * sends, every time.
 */
export async function sendDraft(f: FormData) {
  const admin = await requireAdmin();
  const platform = String(f.get("platform") ?? "");
  const environment = String(f.get("environment") ?? "");
  const partRaw = String(f.get("part") ?? "");
  const part = partRaw ? Number(partRaw) : null;
  let result = "";
  try {
    const [reg, observed, sent] = await Promise.all([loadRegistry(), loadObserved(), loadPinProposals()]);
    const draft = findDraft(buildDrafts(reg, observed.packages, sent ?? []), platform, environment, Number.isInteger(part) ? part : null);
    if (!draft) throw new Error("That draft no longer exists: the registry or the collector has changed. Review the drafts again.");
    if (draft.alreadySent) throw new Error("This proposal was already sent with exactly these pins.");

    const bearer = await operatorBearer();
    const r = await sendProposal({ platform: draft.platform, pins: draft.pins.map((p) => p.pin) }, bearer);
    if (r.status !== "ok") throw new Error(describeProposeFailure(r));

    try {
      await recordPinProposal({ platform: draft.platform, environment: draft.environment, pins: draft.pins.map((p) => p.pin), bossId: r.id, requestedBy: admin.email });
      result = `sent=${encodeURIComponent(r.id)}`;
    } catch (e) {
      // BOSS has the proposal; the console's own record failed (db/009 not applied, or a write error). Say both.
      console.error("could not record pin proposal", e);
      result = `sent=${encodeURIComponent(r.id)}&unrecorded=1`;
    }
  } catch (e) {
    console.error("send pin proposal failed", e instanceof Error ? e.message : e);
    result = `error=${encodeURIComponent(e instanceof Error ? e.message : "Could not send the proposal.")}`;
  }
  redirect(`/boss/proposals?${result}`);
}
