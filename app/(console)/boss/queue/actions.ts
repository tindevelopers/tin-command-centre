"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { decideDocument, describeDecideFailure, describeQueueFailure, listQueue } from "@/src/boss/queue";
import { isUuid } from "@/src/boss/operator";

/**
 * Decide one document. The form carries the document, the revision the page showed and the decision; the queue is re-read here
 * first, so a stale or edited form cannot decide a revision the queue no longer lists (BOSS refuses that too, with a 409, but the
 * console says so in its own words before asking). Autonomy class A1: a person decides, every time, and no reason travels: the
 * knowledge package has no field for one.
 */
export async function decideAction(f: FormData) {
  await requireAdmin();
  const documentId = String(f.get("documentId") ?? "").toLowerCase();
  const revisionId = String(f.get("revisionId") ?? "").toLowerCase();
  const decision = String(f.get("decision") ?? "");
  let result: string;
  try {
    if (!isUuid(documentId) || !isUuid(revisionId) || (decision !== "accept" && decision !== "reject")) throw new Error("That request is not valid. Reload the page.");
    const bearer = await operatorBearer();
    const queue = await listQueue(bearer);
    if (queue.status !== "ok") throw new Error(describeQueueFailure(queue));
    const item = queue.items.find((i) => i.documentId === documentId);
    if (!item) throw new Error("Nothing was decided: that document is no longer in your queue. Reload the page.");
    if (item.revisionId !== revisionId) throw new Error("Nothing was decided: the document has a newer revision than the one you saw. Reload the page and read it again.");
    const r = await decideDocument({ documentId, revisionId, decision }, bearer);
    if (r.status !== "ok") throw new Error(describeDecideFailure(r));
    result = `${r.outcome === "published" ? "accepted" : "rejected"}=${encodeURIComponent(item.title)}`;
  } catch (e) {
    console.error("decide document failed", e instanceof Error ? e.message : e);
    result = `error=${encodeURIComponent(e instanceof Error ? e.message : "Could not record the decision.")}`;
  }
  redirect(`/boss/queue?${result}`);
}
