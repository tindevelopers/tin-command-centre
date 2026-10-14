import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionBlocked, startCollection } from "./collect";

const now = new Date("2026-10-14T12:00:00Z");
const ago = (m: number) => new Date(now.getTime() - m * 60_000);

describe("collectionBlocked", () => {
  it("allows a collection when nothing ran recently", () => {
    expect(collectionBlocked([], now)).toBeNull();
    expect(collectionBlocked([{ startedAt: ago(600), status: "ok" }], now)).toBeNull();
  });
  it("blocks while a run is still marked running", () => {
    expect(collectionBlocked([{ startedAt: ago(20), status: "running" }], now)).toMatch(/already running/);
  });
  it("ignores a run stuck in running for hours", () => {
    expect(collectionBlocked([{ startedAt: ago(300), status: "running" }], now)).toBeNull();
  });
  it("blocks a second click straight after a finished run", () => {
    expect(collectionBlocked([{ startedAt: ago(2), status: "ok" }], now)).toMatch(/minutes ago/);
  });
});

describe("startCollection", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number) => {
    const m = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
    vi.stubGlobal("fetch", m);
    return m;
  };
  it("dispatches the workflow on main and returns the Actions URL", async () => {
    const m = stub(204);
    const url = await startCollection({ token: "t" });
    expect(url).toBe("https://github.com/tindevelopers/shell-base-github-registry/actions/workflows/collect.yml");
    const [endpoint, init] = m.mock.calls[0];
    expect(endpoint).toBe("https://api.github.com/repos/tindevelopers/shell-base-github-registry/actions/workflows/collect.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ref: "main" });
    expect(init.headers.authorization).toBe("Bearer t");
  });
  it("needs a token", async () => {
    delete process.env.COLLECTOR_GITHUB_TOKEN;
    await expect(startCollection()).rejects.toThrow(/COLLECTOR_GITHUB_TOKEN/);
  });
  it("explains the common refusals", async () => {
    stub(403);
    await expect(startCollection({ token: "t" })).rejects.toThrow(/Actions: read and write/);
    stub(404);
    await expect(startCollection({ token: "t" })).rejects.toThrow(/could not find/);
    stub(422);
    await expect(startCollection({ token: "t" })).rejects.toThrow(/workflow_dispatch/);
  });
  it("rejects a malformed repo before calling GitHub", async () => {
    const m = stub(204);
    await expect(startCollection({ token: "t", repo: "a/b/../c" })).rejects.toThrow(/owner\/repo/);
    expect(m).not.toHaveBeenCalled();
  });
});
