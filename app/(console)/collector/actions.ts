"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { collectionBlocked, startCollection } from "@/src/status/collect";
import { recentRuns } from "@/src/status/db";

/** Start the collector now instead of waiting for the daily run. Admin only; the button is also hidden from viewers, but this action is a public endpoint. */
export async function collectNow() {
  const admin = await requireAdmin();
  let result: string;
  try {
    const blocked = collectionBlocked(await recentRuns(5), new Date());
    if (blocked) throw new Error(blocked);
    const url = await startCollection();
    console.log(`collection started by ${admin.email}`);
    result = `started=${encodeURIComponent(url)}`;
  } catch (e) {
    console.error("collect now failed", e);
    result = `error=${encodeURIComponent(e instanceof Error ? e.message : "Could not start the collector.")}`;
  }
  redirect(`/collector?${result}`);
}
