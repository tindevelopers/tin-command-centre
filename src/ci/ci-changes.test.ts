import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/ci-changes.sh", import.meta.url));

function classify(paths: string[]): string {
  const run = spawnSync("bash", [script], { input: paths.join("\n"), encoding: "utf8" });
  expect(run.status).toBe(0);
  return run.stdout.trim();
}

describe("scripts/ci-changes.sh", () => {
  it.each([
    ["docs prose", ["docs/authority-model.md"], "code=false"],
    ["docs image", ["docs/img/flow.png"], "code=false"],
    ["root Markdown", ["CLAUDE.md", "AGENTS.md"], "code=false"],
    ["Markdown below the root is code", ["src/registry/README.md"], "code=true"],
    ["a migration", ["db/010_agent_ledger.sql"], "code=true"],
    ["app source", ["app/(console)/page.tsx"], "code=true"],
    ["a workflow", [".github/workflows/ci.yml"], "code=true"],
    ["the lockfile", ["pnpm-lock.yaml"], "code=true"],
    ["docs plus code", ["docs/evidence.md", "src/settings/policy.ts"], "code=true"],
    ["unknown base sentinel", ["*"], "code=true"],
    ["empty diff (fail safe)", [], "code=true"],
  ])("%s", (_name, paths, expected) => {
    expect(classify(paths)).toBe(expected);
  });
});
