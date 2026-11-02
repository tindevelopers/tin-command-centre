import { CLASSES, DEMOTE_FOR_DAYS, NEVER_ABOVE_A1, PROMOTE_WHEN, TASK_TYPES, taskType, upgradeTaskType } from "@/config/autonomy";
import type { AutonomyClass, TaskType } from "@/config/autonomy";
import { bumpSize } from "@/src/agent/task";
import type { AgentRun, SentPinProposal } from "@/src/registry/db";
import type { CollectorRun } from "@/src/status/types";

/**
 * The automation record, read from three places and judged against the autonomy policy (strategy §6 and §7):
 * - `agent_ledger_runs` and `agent_ledger_events` (db/010): every agent run of every type, and what happened to it afterwards.
 * - `agent_runs` (db/004) and `pin_proposals` (db/009): the console's own hand-offs and proposals, which predate the ledger.
 * - `collector_runs`: the observe-only job.
 * Everything here is pure: the pages load, this file derives. Nothing promotes a class; the owner does, by editing the policy.
 */
export type LedgerRun = {
  id: string;
  agent: string;
  taskType: string;
  autonomy: AutonomyClass;
  repository: string;
  model: string;
  reviewerModel: string | null;
  trigger: "schedule" | "event" | "issue" | "manual";
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number | null;
  prUrl: string | null;
  issueUrl: string | null;
  diffFiles: number | null;
  diffLines: number | null;
  testsBefore: number | null;
  testsAfter: number | null;
  outcome: "no-op" | "issue" | "draft-pr" | "ready-pr" | "failed" | "over-budget" | null;
};

export const LEDGER_EVENTS = [
  "checks-passed", "checks-failed", "review-approve", "review-changes", "human-approve", "human-changes", "merged", "closed-unmerged", "reverted", "incident", "rule-proposed", "rule-accepted",
] as const;
export type LedgerEventName = (typeof LEDGER_EVENTS)[number];
export type LedgerEvent = { id: string; runId: string; at: Date; event: LedgerEventName; actor: string };

const DAY = 86_400_000;

/** A run's fate, from its events: the last word wins. */
export type RunFate = "merged" | "reverted" | "closed" | "changes-requested" | "approved" | "checks-failed" | "checks-passed" | "open";

export function runFate(events: LedgerEvent[]): RunFate {
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let fate: RunFate = "open";
  for (const e of ordered) {
    if (e.event === "reverted" || e.event === "incident") fate = "reverted";
    else if (e.event === "merged") fate = "merged";
    else if (e.event === "closed-unmerged") fate = "closed";
    else if (fate !== "merged" && fate !== "reverted" && fate !== "closed") {
      if (e.event === "human-changes" || e.event === "review-changes") fate = "changes-requested";
      else if (e.event === "human-approve" || e.event === "review-approve") fate = "approved";
      else if (e.event === "checks-failed") fate = "checks-failed";
      else if (e.event === "checks-passed") fate = "checks-passed";
    }
  }
  return fate;
}

export type TaskTypeRecord = {
  taskType: string;
  policy: TaskType | undefined;
  runs: number;
  merged: number;
  humanChanges: number;
  reverts30d: number;
  incidents30d: number;
  /** Merges, counted back from the newest run, until one that a person asked changes on (or that was reverted). */
  consecutiveMergedWithoutHumanChanges: number;
  costUsd: number;
  /** Human and reviewer verdicts on the same run, for agreement. null when fewer than two pairs exist. */
  kappa: number | null;
  lastRunAt: Date | null;
  /** When the most recent revert or incident happened, if within the demotion window. */
  demotedUntil: Date | null;
};

function cohenKappa(pairs: { reviewer: boolean; human: boolean }[]): number | null {
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const agree = pairs.filter((p) => p.reviewer === p.human).length / n;
  const rYes = pairs.filter((p) => p.reviewer).length / n;
  const hYes = pairs.filter((p) => p.human).length / n;
  const chance = rYes * hYes + (1 - rYes) * (1 - hYes);
  if (chance === 1) return 1;
  return (agree - chance) / (1 - chance);
}

/** One record per task type seen in the ledger, plus every policy type with no runs yet, in policy order. */
export function taskTypeRecords(runs: LedgerRun[], events: LedgerEvent[], now: Date): TaskTypeRecord[] {
  const byRun = new Map<string, LedgerEvent[]>();
  for (const e of events) byRun.set(e.runId, [...(byRun.get(e.runId) ?? []), e]);
  const types = [...TASK_TYPES.map((t) => t.type), ...runs.map((r) => r.taskType).filter((t) => !taskType(t))];
  const out: TaskTypeRecord[] = [];
  for (const type of [...new Set(types)]) {
    const mine = runs.filter((r) => r.taskType === type).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    let merged = 0, humanChanges = 0, reverts30d = 0, incidents30d = 0, cost = 0;
    let consecutive = 0, counting = true;
    let latestBad: Date | null = null;
    const pairs: { reviewer: boolean; human: boolean }[] = [];
    for (const r of mine) {
      const evs = byRun.get(r.id) ?? [];
      cost += r.costUsd ?? 0;
      const names = new Set(evs.map((e) => e.event));
      if (names.has("merged")) merged++;
      if (names.has("human-changes")) humanChanges++;
      for (const e of evs) {
        if ((e.event === "reverted" || e.event === "incident") && now.getTime() - e.at.getTime() <= 30 * DAY) {
          if (e.event === "reverted") reverts30d++; else incidents30d++;
          if (!latestBad || e.at > latestBad) latestBad = e.at;
        }
      }
      const fate = runFate(evs);
      if (counting) {
        if (fate === "merged" && !names.has("human-changes")) consecutive++;
        else if (fate === "merged" || fate === "reverted" || fate === "changes-requested" || fate === "closed") counting = false;
        // an open run neither extends nor breaks the streak
      }
      const reviewer = names.has("review-approve") ? true : names.has("review-changes") ? false : null;
      const human = names.has("human-approve") || names.has("merged") ? true : names.has("human-changes") ? false : null;
      if (reviewer !== null && human !== null) pairs.push({ reviewer, human });
    }
    out.push({
      taskType: type, policy: taskType(type), runs: mine.length, merged, humanChanges, reverts30d, incidents30d,
      consecutiveMergedWithoutHumanChanges: consecutive, costUsd: Math.round(cost * 100) / 100, kappa: cohenKappa(pairs),
      lastRunAt: mine[0]?.startedAt ?? null,
      demotedUntil: latestBad ? new Date(latestBad.getTime() + DEMOTE_FOR_DAYS * DAY) : null,
    });
  }
  return out;
}

export type Verdict = { status: "capped" | "demoted" | "not-yet" | "ready" | "top"; reasons: string[] };

/** Whether the record would let the owner move the type up one class. Says why not, in the policy's own terms. */
export function promotionVerdict(r: TaskTypeRecord, now: Date): Verdict {
  const cls = r.policy?.class ?? "A1";
  if (r.policy?.cappedAtA1 || (cls === "A1" && isNeverAboveA1(r.taskType))) return { status: "capped", reasons: ["never above A1: the subject is on the policy's list"] };
  if (cls === "A3") return { status: "top", reasons: ["already the highest class"] };
  if (r.demotedUntil && r.demotedUntil > now) return { status: "demoted", reasons: [`a revert or incident within ${DEMOTE_FOR_DAYS} days; held down until ${r.demotedUntil.toISOString().slice(0, 10)}`] };
  const reasons: string[] = [];
  if (r.consecutiveMergedWithoutHumanChanges < PROMOTE_WHEN.consecutiveMergedWithoutHumanChanges) reasons.push(`${r.consecutiveMergedWithoutHumanChanges} of ${PROMOTE_WHEN.consecutiveMergedWithoutHumanChanges} consecutive merges without human changes`);
  if (r.reverts30d > PROMOTE_WHEN.revertsLast30Days) reasons.push(`${r.reverts30d} revert${r.reverts30d === 1 ? "" : "s"} in 30 days; the policy allows ${PROMOTE_WHEN.revertsLast30Days}`);
  if (r.kappa === null) reasons.push("reviewer and human agreement not yet measured");
  else if (r.kappa < PROMOTE_WHEN.reviewerHumanAgreementKappaMin) reasons.push(`reviewer and human agreement κ ${r.kappa.toFixed(2)}, below ${PROMOTE_WHEN.reviewerHumanAgreementKappaMin}`);
  return reasons.length ? { status: "not-yet", reasons } : { status: "ready", reasons: [`record meets the policy; the owner may move it to ${nextClass(cls)}`] };
}

export const nextClass = (c: AutonomyClass): AutonomyClass => (c === "A0" ? "A1" : c === "A1" ? "A2" : "A3");

/** A task type whose name says it touches a never-above-A1 topic. Names are `area.subject`; the topic list is the policy's. */
export function isNeverAboveA1(type: string): boolean {
  const stem = (w: string) => w.toLowerCase().replace(/s$/, "");
  const parts = type.split(/[.-]/).map(stem);
  return NEVER_ABOVE_A1.topics.some((t) => t.split("-").map(stem).every((w) => parts.includes(w)));
}

export const classLabel = (c: AutonomyClass) => `${c} ${CLASSES[c].name}`;

/** One row of the Agent runs timeline, whichever record it came from. */
export type RunRow = {
  key: string;
  at: Date;
  kind: "ledger" | "hand-off" | "proposal" | "collector";
  actor: string;
  autonomy: AutonomyClass;
  taskType: string;
  subject: string;
  where: string;
  link: string | null;
  outcome: string;
  tone: "green" | "amber" | "red" | null;
};

const fateTone: Record<RunFate, RunRow["tone"]> = { merged: "green", approved: "green", "checks-passed": "green", open: null, "checks-failed": "red", "changes-requested": "amber", closed: "amber", reverted: "red" };

export function unifyRuns(i: { ledger: LedgerRun[]; events: LedgerEvent[]; handOffs: AgentRun[]; proposals: SentPinProposal[]; collector: CollectorRun[] }): RunRow[] {
  const byRun = new Map<string, LedgerEvent[]>();
  for (const e of i.events) byRun.set(e.runId, [...(byRun.get(e.runId) ?? []), e]);
  const rows: RunRow[] = [];
  for (const r of i.ledger) {
    const fate = runFate(byRun.get(r.id) ?? []);
    const outcome = fate !== "open" ? fate : r.outcome ?? (r.finishedAt ? "finished" : "running");
    rows.push({
      key: `ledger:${r.id}`, at: r.startedAt, kind: "ledger", actor: r.agent, autonomy: r.autonomy, taskType: r.taskType, subject: r.model,
      where: r.repository, link: r.prUrl ?? r.issueUrl, outcome,
      tone: fate !== "open" ? fateTone[fate] : r.outcome === "failed" || r.outcome === "over-budget" ? "red" : r.outcome ? "green" : null,
    });
  }
  for (const h of i.handOffs) {
    const bump = bumpSize(h.fromVersion, h.toVersion);
    rows.push({
      key: `handoff:${h.issueUrl}`, at: h.requestedAt, kind: "hand-off", actor: h.requestedBy, autonomy: "A1", taskType: bump ? upgradeTaskType(bump) : "upgrade",
      subject: `${h.package} ${h.fromVersion} → ${h.toVersion}`, where: `${h.projectSlug} · ${h.environment}`, link: h.issueUrl, outcome: "issue opened", tone: null,
    });
  }
  for (const p of i.proposals) {
    rows.push({
      key: `proposal:${p.id}`, at: p.requestedAt, kind: "proposal", actor: p.requestedBy, autonomy: "A1", taskType: "boss.pin-proposal",
      subject: `${p.pins.length} pin${p.pins.length === 1 ? "" : "s"}`, where: `${p.platform} · ${p.environment}`, link: null, outcome: "sent to BOSS", tone: null,
    });
  }
  for (const c of i.collector) {
    rows.push({
      key: `collector:${c.id}`, at: c.startedAt, kind: "collector", actor: "collector", autonomy: "A0", taskType: "collect",
      subject: `run ${c.id}`, where: "status store", link: null, outcome: c.status, tone: c.status === "ok" ? "green" : c.status === "failed" ? "red" : c.status === "partial" ? "amber" : null,
    });
  }
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}
