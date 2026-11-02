"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { operatorBearer } from "@/src/auth/token";
import { buildRelease, describeBuildFailure, parseSpaceIds } from "@/src/boss/releases";

/**
 * Build one knowledge release. Autonomy class A1: an admin presses the button, every time. The form carries the version and the
 * space ids a person typed; both are validated here to BOSS's own shape before anything leaves the console, and the version is typed
 * twice because a release is immutable. BOSS builds, signs, verifies its own output and stores; the console never sees the bundle.
 */
export async function buildReleaseAction(f: FormData) {
  await requireAdmin();
  const version = String(f.get("version") ?? "").trim();
  const confirm = String(f.get("confirm") ?? "").trim();
  const spaceIds = parseSpaceIds(String(f.get("spaceIds") ?? ""));
  let result = "";
  try {
    if (version !== confirm) throw new Error("Nothing was built: type the version twice, exactly the same, to confirm.");
    const r = await buildRelease({ version, spaceIds }, await operatorBearer());
    if (r.status !== "ok") throw new Error(describeBuildFailure(r));
    result = `built=${encodeURIComponent(r.version)}`;
  } catch (e) {
    console.error("build release failed", e instanceof Error ? e.message : e);
    result = `error=${encodeURIComponent(e instanceof Error ? e.message : "Could not build the release.")}`;
  }
  redirect(`/boss/releases?${result}`);
}
