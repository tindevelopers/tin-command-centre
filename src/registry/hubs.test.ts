import { describe, expect, it } from "vitest";
import type { HubTopology } from "@/config/topology";
import type { PackageSnapshot } from "@/src/status/types";
import { filterHubRows, hubRows, hubTotals, packageState, parseHubFilters } from "./hubs";
import type { Project } from "./types";

const snap = (over: Partial<PackageSnapshot> = {}): PackageSnapshot => ({
  runId: "1", package: "@tindevelopers/domain-contacts", repo: "tindevelopers/shared-client-care-hub", branchVersion: "1.2.1", latest: "1.2.0", next: "1.2.1",
  divergence: "OK (forward — 1.2.1 published to \"next\", awaiting G2 promotion to \"latest\")", dependents: [], ...over,
});
const topo: HubTopology[] = [
  { repo: "shared-client-care-hub", nickname: "Hestia", layer: "L4", riskClass: "RC-4", status: "existing", note: "Gains domain-followup.", tasks: ["W2-12"] },
  { repo: "shared-trust-hub", nickname: null, layer: "L1", riskClass: "RC-0", status: "rename", note: "Rename of shared-signing-hub.", tasks: ["W0-07"] },
  { repo: "shared-ai-hub", nickname: null, layer: "L3", riskClass: "RC-3", status: "planned", note: "New.", tasks: [] },
];
const proj = (over: Partial<Project> = {}): Project => ({ slug: "shared-client-care-hub", name: "Client care", kind: "hub", client: null, repo: "tindevelopers/shared-client-care-hub", lifecycle: "active", notes: null, ownerProject: null, path: null, ownerGroup: "tindevelopers", tier: "domain", annotations: {}, ...over });

describe("packageState", () => {
  it("reads the collector's divergence vocabulary", () => {
    expect(packageState("OK")).toBe("ok");
    expect(packageState("OK (forward — 1.1.1 published to next)")).toBe("awaiting-promotion");
    expect(packageState("OK (unpublished — no registry versions yet)")).toBe("unpublished");
    expect(packageState("KNOWN DRIFT: allowlisted")).toBe("known-drift");
    expect(packageState("BEHIND: branch 1.0.0 < latest 1.1.0")).toBe("divergent");
  });
});

describe("hubRows", () => {
  const packages = [
    snap(),
    snap({ package: "@tindevelopers/schema-crm", branchVersion: "1.2.0", latest: "1.2.0", next: "1.2.0", divergence: "OK", dependents: ["@tindevelopers/domain-contacts", "@tindevelopers/ui-crm"] }),
    snap({ package: "@tindevelopers/credential-crypto", repo: "tindevelopers/shared-integration-hub", latest: "1.0.0", next: "1.0.0", divergence: "OK", dependents: ["@tindevelopers/domain-contacts"] }),
  ];
  const rows = hubRows(packages, { projects: [proj()] }, topo);
  const row = (repo: string) => rows.find((r) => r.repo === repo)!;

  it("groups packages by repository name and joins the topology file", () => {
    expect(row("shared-client-care-hub")).toMatchObject({ nickname: "Hestia", layer: "L4", riskClass: "RC-4", topologyStatus: "existing", projectSlug: "shared-client-care-hub", ownerGroup: "tindevelopers" });
    expect(row("shared-client-care-hub").packages.map((p) => p.package)).toEqual(["@tindevelopers/domain-contacts", "@tindevelopers/schema-crm"]);
    expect(row("shared-client-care-hub").counts).toMatchObject({ ok: 1, "awaiting-promotion": 1 });
    expect(row("shared-client-care-hub").colour).toBe("amber");
  });

  it("lists planned and renamed hubs from the topology even with no packages, with no colour", () => {
    expect(row("shared-ai-hub")).toMatchObject({ topologyStatus: "planned", packages: [], colour: null });
    expect(row("shared-trust-hub")).toMatchObject({ topologyStatus: "rename", colour: null });
  });

  it("a repo that published but is not in the topology still appears, without topology fields", () => {
    expect(row("shared-integration-hub")).toMatchObject({ layer: null, topologyStatus: null, colour: "green" });
  });

  it("collects distinct dependents across the hub's packages", () => {
    expect(row("shared-client-care-hub").dependents).toEqual(["@tindevelopers/domain-contacts", "@tindevelopers/ui-crm"]);
  });

  it("orders worst first, then hubs with nothing to judge", () => {
    expect(rows.map((r) => r.colour)).toEqual(["amber", "green", null, null]);
  });

  it("lets registry annotations override the topology file", () => {
    const annotated = proj({ annotations: { "tin.info/layer": "L3", "tin.info/topology": "shrink", "tin.info/topology-note": "Owner changed the plan." } });
    const r = hubRows(packages, { projects: [annotated] }, topo).find((x) => x.repo === "shared-client-care-hub")!;
    expect(r).toMatchObject({ layer: "L3", riskClass: "RC-4", topologyStatus: "shrink", topologyNote: "Owner changed the plan." });
  });

  it("ignores an annotation that is not a known status", () => {
    const r = hubRows(packages, { projects: [proj({ annotations: { "tin.info/topology": "<script>" } })] }, topo).find((x) => x.repo === "shared-client-care-hub")!;
    expect(r.topologyStatus).toBe("existing");
  });

  it("tolerates dependents that are not a list of names", () => {
    const r = hubRows([snap({ dependents: { weird: true } })], null, topo).find((x) => x.repo === "shared-client-care-hub")!;
    expect(r.dependents).toEqual([]);
  });
});

describe("filters and totals", () => {
  const rows = hubRows([snap(), snap({ package: "@tindevelopers/adapter-xero", repo: "tindevelopers/shared-integration-hub", latest: null, next: null, divergence: "OK (unpublished — no registry versions yet)" })], null, topo);

  it("parses only what it recognises", () => {
    expect(parseHubFilters({ view: "planned", state: "unpublished", q: " x " })).toEqual({ view: "planned", state: "unpublished", q: "x" });
    expect(parseHubFilters({ view: "nope", state: "nope" })).toEqual({ view: "all", state: "", q: "" });
  });

  it("filters by view, package state and text", () => {
    expect(filterHubRows(rows, { view: "planned", state: "", q: "" }).map((r) => r.repo)).toEqual(["shared-ai-hub"]);
    expect(filterHubRows(rows, { view: "changing", state: "", q: "" }).map((r) => r.repo)).toEqual(["shared-trust-hub"]);
    expect(filterHubRows(rows, { view: "existing", state: "", q: "" }).map((r) => r.repo).sort()).toEqual(["shared-client-care-hub", "shared-integration-hub"]);
    expect(filterHubRows(rows, { view: "all", state: "unpublished", q: "" }).map((r) => r.repo)).toEqual(["shared-integration-hub"]);
    expect(filterHubRows(rows, { view: "all", state: "", q: "hestia" }).map((r) => r.repo)).toEqual(["shared-client-care-hub"]);
    expect(filterHubRows(rows, { view: "all", state: "", q: "xero" }).map((r) => r.repo)).toEqual(["shared-integration-hub"]);
  });

  it("totals hubs, packages and states", () => {
    expect(hubTotals(rows)).toMatchObject({ hubs: 4, withPackages: 2, packages: 2, published: 1, "awaiting-promotion": 1, unpublished: 1 });
  });
});
