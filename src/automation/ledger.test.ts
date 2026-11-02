import { describe, expect, it } from "vitest";
import { isNeverAboveA1, promotionVerdict, runFate, taskTypeRecords, unifyRuns } from "./ledger";
import type { LedgerEvent, LedgerRun } from "./ledger";

const now = new Date("2026-11-01T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
const run = (id: string, over: Partial<LedgerRun> = {}): LedgerRun => ({
  id, agent: "estate-scanner", taskType: "upgrade.patch.non-security", autonomy: "A1", repository: "o/r", model: "m", reviewerModel: null, trigger: "schedule",
  startedAt: days(Number(id)), finishedAt: null, costUsd: 1, prUrl: `https://github.com/o/r/pull/${id}`, issueUrl: null, diffFiles: 1, diffLines: 2, testsBefore: 10, testsAfter: 10, outcome: "draft-pr", ...over,
});
let seq = 0;
const ev = (runId: string, event: LedgerEvent["event"], at = days(Number(runId)), actor = "x"): LedgerEvent => ({ id: String(++seq), runId, at, event, actor });

describe("runFate", () => {
  it("takes the last word, with merged, reverted and closed final", () => {
    expect(runFate([])).toBe("open");
    expect(runFate([ev("1", "checks-passed"), ev("1", "review-approve")])).toBe("approved");
    expect(runFate([ev("1", "human-changes"), ev("1", "checks-passed", days(0))])).toBe("checks-passed");
    expect(runFate([ev("1", "merged", days(2)), ev("1", "human-changes", days(1))])).toBe("merged");
    expect(runFate([ev("1", "merged", days(2)), ev("1", "reverted", days(1))])).toBe("reverted");
    expect(runFate([ev("1", "closed-unmerged")])).toBe("closed");
  });
});

describe("taskTypeRecords and promotionVerdict", () => {
  it("counts consecutive merges from the newest run back until a person asked for changes", () => {
    const runs = [run("1"), run("2"), run("3"), run("4"), run("5")];
    const events = [ev("1", "merged"), ev("2", "merged"), ev("3", "human-changes"), ev("3", "merged"), ev("4", "merged"), ev("5", "merged")];
    const r = taskTypeRecords(runs, events, now).find((x) => x.taskType === "upgrade.patch.non-security")!;
    expect(r.runs).toBe(5);
    expect(r.merged).toBe(5);
    expect(r.humanChanges).toBe(1);
    expect(r.consecutiveMergedWithoutHumanChanges).toBe(2);
    expect(r.costUsd).toBe(5);
    expect(r.kappa).toBeNull();
    const v = promotionVerdict(r, now);
    expect(v.status).toBe("not-yet");
    expect(v.reasons[0]).toContain("2 of 20");
    expect(v.reasons.some((s) => s.includes("not yet measured"))).toBe(true);
  });
  it("an open run neither extends nor breaks the streak", () => {
    const runs = [run("1"), run("2"), run("3")];
    const events = [ev("2", "merged"), ev("3", "merged")];
    const r = taskTypeRecords(runs, events, now).find((x) => x.taskType === "upgrade.patch.non-security")!;
    expect(r.consecutiveMergedWithoutHumanChanges).toBe(2);
  });
  it("a revert inside 30 days demotes; an older one does not", () => {
    const runs = [run("1"), run("40")];
    const recent = taskTypeRecords(runs, [ev("1", "merged"), ev("1", "reverted", days(0))], now)[2];
    expect(recent.reverts30d).toBe(1);
    expect(promotionVerdict(recent, now).status).toBe("demoted");
    const old = taskTypeRecords(runs, [ev("40", "merged"), ev("40", "reverted", days(40))], now)[2];
    expect(old.reverts30d).toBe(0);
    expect(old.demotedUntil).toBeNull();
  });
  it("says ready when every condition holds, and measures agreement", () => {
    const runs = Array.from({ length: 20 }, (_, i) => run(String(i + 1)));
    const events = runs.flatMap((r) => [ev(r.id, "review-approve"), ev(r.id, "merged")]);
    const r = taskTypeRecords(runs, events, now).find((x) => x.taskType === "upgrade.patch.non-security")!;
    expect(r.consecutiveMergedWithoutHumanChanges).toBe(20);
    expect(r.kappa).toBe(1);
    expect(promotionVerdict(r, now)).toEqual({ status: "ready", reasons: ["record meets the policy; the owner may move it to A2"] });
  });
  it("a capped type never reads ready, and policy types with no runs are listed", () => {
    const recs = taskTypeRecords([], [], now);
    expect(recs.map((r) => r.taskType)).toContain("upgrade.major");
    expect(recs.every((r) => r.runs === 0)).toBe(true);
    expect(promotionVerdict(recs.find((r) => r.taskType === "upgrade.major")!, now).status).toBe("capped");
    // An A0 type on the never-above-A1 list may still rise to A1, so it reads not-yet rather than capped.
    expect(promotionVerdict(recs.find((r) => r.taskType === "migration.audit")!, now).status).toBe("not-yet");
    expect(promotionVerdict({ ...recs.find((r) => r.taskType === "migration.audit")!, policy: { type: "migration.audit", class: "A1", capUsd: 2 } }, now).status).toBe("capped");
  });
  it("an unknown task type from the ledger is still recorded, without policy", () => {
    const r = taskTypeRecords([run("1", { taskType: "mystery.thing" })], [], now).find((x) => x.taskType === "mystery.thing")!;
    expect(r.policy).toBeUndefined();
    expect(r.runs).toBe(1);
  });
  it("recognises never-above-A1 topics in a type name", () => {
    expect(isNeverAboveA1("migration.audit")).toBe(true);
    expect(isNeverAboveA1("auth.rotate-cookie")).toBe(true);
    expect(isNeverAboveA1("tenant-isolation.check")).toBe(true);
    expect(isNeverAboveA1("upgrade.patch.non-security")).toBe(false);
    expect(isNeverAboveA1("docs.generated-section")).toBe(false);
  });
});

describe("unifyRuns", () => {
  it("merges the four records into one timeline, newest first, with the class each ran under", () => {
    const rows = unifyRuns({
      ledger: [run("3")],
      events: [ev("3", "merged")],
      handOffs: [{ projectSlug: "konnect-app", environment: "development", package: "@tindevelopers/domain-support", fromVersion: "5.1.0", toVersion: "6.0.0", issueUrl: "https://github.com/o/r/issues/7", requestedBy: "a@tin.info", requestedAt: days(1) }],
      proposals: [{ id: "1", platform: "konnect", environment: "development", pins: ["@tindevelopers/x@1.0.0"], bossId: "pp", requestedBy: "a@tin.info", requestedAt: days(2) }],
      collector: [{ id: "9", startedAt: days(0), finishedAt: days(0), status: "ok", error: null }],
    });
    expect(rows.map((r) => r.kind)).toEqual(["collector", "hand-off", "proposal", "ledger"]);
    expect(rows[0]).toMatchObject({ autonomy: "A0", outcome: "ok", tone: "green" });
    expect(rows[1]).toMatchObject({ autonomy: "A1", taskType: "upgrade.major", link: "https://github.com/o/r/issues/7" });
    expect(rows[2]).toMatchObject({ autonomy: "A1", taskType: "boss.pin-proposal", where: "konnect · development" });
    expect(rows[3]).toMatchObject({ kind: "ledger", outcome: "merged", tone: "green", link: "https://github.com/o/r/pull/3" });
  });
});
