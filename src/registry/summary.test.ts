import { describe, expect, it } from "vitest";
import { estateByKind, lifecycleCounts } from "./summary";
import type { Finding, Project, Registry } from "./types";

const p = (slug: string, kind: Project["kind"], lifecycle: Project["lifecycle"] = "active"): Project =>
  ({ slug, name: slug, kind, client: null, repo: null, lifecycle, notes: null, ownerProject: null, path: null, ownerGroup: null, tier: null, annotations: {} });
const f = (projectSlug: string, colour: Finding["colour"]): Finding => ({ projectSlug, environment: null, kind: "pin", subject: "x", colour, message: "m" });
const reg = (projects: Project[]): Registry => ({ projects, environments: [], pins: [], assignments: [], relations: [] });

describe("estateByKind", () => {
  const r = reg([p("a", "hub"), p("b", "hub"), p("c", "app"), p("d", "app", "retired"), p("e", "boss", "planned")]);
  it("counts live projects per type in the registry's type order, skipping empty types", () => {
    expect(estateByKind(r, []).map((x) => [x.kind, x.projects])).toEqual([["boss", 1], ["hub", 2], ["app", 1]]);
  });
  it("attributes red and amber findings to the project's type and ignores green and retired projects", () => {
    const rows = estateByKind(r, [f("a", "red"), f("b", "amber"), f("b", "red"), f("c", "green"), f("d", "red"), f("zzz", "red")]);
    expect(rows.find((x) => x.kind === "hub")).toMatchObject({ red: 2, amber: 1 });
    expect(rows.find((x) => x.kind === "app")).toMatchObject({ red: 0, amber: 0 });
  });
  it("is empty for an empty registry", () => expect(estateByKind(reg([]), [])).toEqual([]));
});

describe("lifecycleCounts", () => {
  it("counts each state", () => {
    expect(lifecycleCounts(reg([p("a", "hub"), p("b", "hub", "retired"), p("c", "app", "planned"), p("d", "app")]))).toEqual({ active: 2, planned: 1, retired: 1 });
  });
});
