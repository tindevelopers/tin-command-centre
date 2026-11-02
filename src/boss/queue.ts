import { dateOf, describeCall, isObject, isUuid, operatorCall } from "./operator";
import type { Call, Options } from "./operator";

/**
 * The TIN review queue (tin-boss-api src/routes/knowledge.ts, task 4b.1b): platform documents awaiting review, and the decision
 * on each. Operator route, scope boss.knowledge.write; the queue BOSS returns is bound to the signed-in person, so what one
 * operator sees another may not. A decision names the document and the revision the queue listed and nothing else: the knowledge
 * package has no field for a reason. Accept publishes that revision; reject returns the document to draft.
 */
export type QueueItem = { documentId: string; title: string; spaceId: string; spaceName: string; revisionId: string; revisionNumber: number; submittedAt: Date; updatedAt: Date };

export type QueueResult =
  | { status: "ok"; items: QueueItem[]; nextCursor: string | null }
  | Exclude<Call, { status: "ok" }>;

export type Decision = "accept" | "reject";

export type DecideResult =
  | { status: "ok"; documentId: string; revisionId: string; outcome: "published" | "draft" }
  | { status: "invalid"; reason: string }
  | Exclude<Call, { status: "ok" }>;

export const QUEUE_SCOPE = "boss.knowledge.write";
export const PAGE_LIMIT = 100;
const TEXT_MAX = 300;

const ROUTE = {
  scope: QUEUE_SCOPE,
  notServed: "This BOSS cell does not serve the review queue: only a Neon Auth cell with the knowledge login mounts it (tin-production has none).",
  notFound: "That document is no longer reviewable, or is outside your scope. Re-read the queue.",
  conflict: "The document is no longer awaiting review, or a newer revision exists. Re-read the queue and decide again.",
};

export const describeQueueFailure = (r: Exclude<QueueResult, { status: "ok" }>) => describeCall(r, ROUTE);
export const describeDecideFailure = (r: Exclude<DecideResult, { status: "ok" }>) => (r.status === "invalid" ? `Nothing was decided: ${r.reason}` : `Nothing was decided: ${describeCall(r, ROUTE)}`);

/** Display text from BOSS is bounded and stripped of control characters; it is still rendered as text, never as markup. */
const clean = (v: unknown): string | null => (typeof v === "string" && v.length <= TEXT_MAX ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : null);

/** One wire row; null when any field is not exactly what BOSS promises. */
export function parseQueueItem(row: unknown): QueueItem | null {
  if (!isObject(row)) return null;
  const { documentId, spaceId, revisionId, revisionNumber } = row;
  if (!isUuid(documentId) || !isUuid(spaceId) || !isUuid(revisionId)) return null;
  if (!Number.isInteger(revisionNumber) || (revisionNumber as number) < 0 || (revisionNumber as number) > 1_000_000) return null;
  const title = clean(row.title);
  const spaceName = clean(row.spaceName);
  const submittedAt = dateOf(row.submittedAt);
  const updatedAt = dateOf(row.updatedAt);
  if (title === null || spaceName === null || !submittedAt || !updatedAt) return null;
  return { documentId: (documentId as string).toLowerCase(), title: title || "(untitled)", spaceId: (spaceId as string).toLowerCase(), spaceName: spaceName || "(unnamed space)", revisionId: (revisionId as string).toLowerCase(), revisionNumber: revisionNumber as number, submittedAt, updatedAt };
}

export async function listQueue(bearer: string | null, page: { after?: string | null } = {}, opts: Options = {}): Promise<QueueResult> {
  const after = page.after?.toLowerCase();
  if (after !== undefined && after !== null && after !== "" && !isUuid(after)) return { status: "failed", reason: "rejected", detail: "" };
  const search = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (after) search.set("after", after);
  const r = await operatorCall("/v1/knowledge/queue", { method: "GET", search: search.toString(), okCodes: [200], notFoundMeans: "not_served" }, bearer, opts);
  if (r.status !== "ok") return r;
  const b = r.body;
  if (!isObject(b) || !Array.isArray(b.items) || b.items.length > PAGE_LIMIT || !(b.nextCursor === null || isUuid(b.nextCursor))) return { status: "failed", reason: "malformed", detail: "" };
  const items: QueueItem[] = [];
  for (const row of b.items) {
    const parsed = parseQueueItem(row);
    if (!parsed) return { status: "failed", reason: "malformed", detail: "" };
    items.push(parsed);
  }
  return { status: "ok", items, nextCursor: b.nextCursor === null ? null : (b.nextCursor as string).toLowerCase() };
}

export type DecideInput = { documentId: string; revisionId: string; decision: Decision };

export function validateDecision(input: DecideInput): string | null {
  if (!isUuid(input.documentId)) return "the document id is not valid.";
  if (!isUuid(input.revisionId)) return "the revision id is not valid.";
  if (input.decision !== "accept" && input.decision !== "reject") return "the decision is not valid.";
  return null;
}

/** Accept or reject one document at the revision the queue listed. Autonomy class A1: a person decides, every time. */
export async function decideDocument(input: DecideInput, bearer: string | null, opts: Options = {}): Promise<DecideResult> {
  const invalid = validateDecision(input);
  if (invalid) return { status: "invalid", reason: invalid };
  const documentId = input.documentId.toLowerCase();
  const revisionId = input.revisionId.toLowerCase();
  const r = await operatorCall(`/v1/knowledge/queue/${documentId}/${input.decision}`, { method: "POST", body: { revisionId }, okCodes: [200], notFoundMeans: "not_found" }, bearer, opts);
  if (r.status !== "ok") return r;
  const b = r.body;
  const expected = input.decision === "accept" ? "published" : "draft";
  return isObject(b) && b.documentId === documentId && b.revisionId === revisionId && b.status === expected ? { status: "ok", documentId, revisionId, outcome: expected } : { status: "failed", reason: "malformed", detail: "" };
}
