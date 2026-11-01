import { credentialSnapshots, latestDataRun } from "@/src/status/db";
import type { CredentialAuthority, CredentialSnapshotSet } from "./port";

/**
 * The collector's view of api-credentials: `credential_snapshots`, estate-wide like the other snapshot tables, written by
 * `collector_writer` and read here as `console_reader`. The table has no secret column, so none can be read.
 */
export const snapshotAuthority: CredentialAuthority = {
  name: "collector snapshots of api-credentials",
  async read(): Promise<CredentialSnapshotSet> {
    const run = await latestDataRun();
    if (!run) return { observedAt: null, keys: [] };
    const rows = await credentialSnapshots(run.id);
    return {
      observedAt: run.finishedAt,
      keys: rows.map((r) => ({ cell: r.cell, publicId: r.publicId, platform: r.program, environment: r.environment, status: r.status, scopes: r.scopes, lastUsedAt: r.lastUsedAt })),
    };
  },
};
