import { afterEach, describe, expect, it, vi } from "vitest";
import { isAtLeast, lowest, pinsInPackageJson, readRepoPin } from "./repo";

const PKG = "@tindevelopers/adapter-kit";

describe("pinsInPackageJson", () => {
  it("reads an npm alias, which is how the Konnect apps pin hub packages", () => {
    expect(pinsInPackageJson({ dependencies: { "@base/integrations": `npm:${PKG}@1.12.2` } }, PKG)).toEqual(["1.12.2"]);
  });
  it("reads a direct dependency and every section, de-duplicated", () => {
    const json = { dependencies: { [PKG]: "1.12.2" }, devDependencies: { x: `npm:${PKG}@1.12.2` }, peerDependencies: { y: `npm:${PKG}@1.9.1` } };
    expect(pinsInPackageJson(json, PKG).sort()).toEqual(["1.12.2", "1.9.1"]);
  });
  it("strips an exact-pin prefix but ignores ranges, workspace and catalog specs", () => {
    expect(pinsInPackageJson({ dependencies: { [PKG]: "=1.2.3" } }, PKG)).toEqual(["1.2.3"]);
    for (const spec of ["^1.2.3", "~1.2.3", ">=1.0.0", "workspace:*", "catalog:", "latest"]) expect(pinsInPackageJson({ dependencies: { [PKG]: spec } }, PKG)).toEqual([]);
  });
  it("does not confuse a different package that merely shares a prefix", () => {
    expect(pinsInPackageJson({ dependencies: { a: `npm:${PKG}-extra@9.9.9`, [`${PKG}-extra`]: "9.9.9" } }, PKG)).toEqual([]);
  });
  it("copes with junk", () => {
    expect(pinsInPackageJson(null, PKG)).toEqual([]);
    expect(pinsInPackageJson({ dependencies: "nope" }, PKG)).toEqual([]);
    expect(pinsInPackageJson({ dependencies: { [PKG]: 5 } }, PKG)).toEqual([]);
  });
});

describe("versions", () => {
  it("isAtLeast compares semver and never says yes to garbage", () => {
    expect(isAtLeast("1.12.2", "1.12.2")).toBe(true);
    expect(isAtLeast("1.13.0", "1.12.2")).toBe(true);
    expect(isAtLeast("1.9.1", "1.12.2")).toBe(false);
    expect(isAtLeast("nope", "1.0.0")).toBe(false);
  });
  it("lowest picks the oldest, so a half-upgraded app still needs the upgrade", () => {
    expect(lowest(["1.12.2", "1.9.1", "1.10.0"])).toBe("1.9.1");
  });
});

describe("readRepoPin", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: object | Error) => {
    const m = vi.fn();
    res instanceof Error ? m.mockRejectedValue(res) : m.mockResolvedValue(res);
    vi.stubGlobal("fetch", m);
    return m;
  };
  const ok = (json: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });

  it("reads the project's package.json from the repo", async () => {
    const m = stub(ok({ dependencies: { "@base/integrations": `npm:${PKG}@1.12.2` } }));
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toEqual({ status: "found", versions: ["1.12.2"], file: "apps/app/package.json" });
    expect(m.mock.calls[0][0]).toBe("https://api.github.com/repos/o/r/contents/apps/app/package.json");
    expect(m.mock.calls[0][1].headers.accept).toBe("application/vnd.github.raw+json");
  });
  it("is unverified, with an actionable reason, when it cannot check", async () => {
    expect(await readRepoPin("o/r", "apps/app", PKG, "")).toMatchObject({ status: "unverified", reason: expect.stringContaining("AGENT_GITHUB_TOKEN") });
    expect(await readRepoPin("o/r", null, PKG, "tok")).toMatchObject({ status: "unverified", reason: expect.stringContaining("no path") });
    stub({ ok: false, status: 404 });
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toMatchObject({ status: "unverified", reason: expect.stringContaining("Contents: read") });
    stub({ ok: false, status: 403 });
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toMatchObject({ status: "unverified", reason: expect.stringContaining("Contents: read") });
    stub({ ok: false, status: 500 });
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toMatchObject({ status: "unverified", reason: "GitHub answered 500" });
    stub(new Error("network down"));
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toEqual({ status: "unverified", reason: "network down" });
    stub(ok({ dependencies: {} }));
    expect(await readRepoPin("o/r", "apps/app", PKG, "tok")).toMatchObject({ status: "unverified", reason: expect.stringContaining("no exact version") });
  });
});
