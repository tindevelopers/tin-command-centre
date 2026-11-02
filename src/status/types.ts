export type Colour = "green" | "amber" | "red";

export type CollectorRun = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "ok" | "partial" | "failed";
  error: string | null;
};

export type PackageSnapshot = {
  runId: string;
  package: string;
  repo: string;
  branchVersion: string | null;
  latest: string | null;
  next: string | null;
  divergence: string;
  dependents: unknown;
};

export type CellSnapshot = {
  runId: string;
  cell: string;
  client: string;
  ring: number;
  region: string;
  url: string | null;
  healthzStatus: number | null;
  readyzStatus: number | null;
  checkedAt: Date;
};

/** A key's metadata as the collector saw it in api-credentials (db/001 credential_snapshots): no hash, pepper or secret exists in the table. */
export type CredentialSnapshot = {
  runId: string;
  cell: string;
  publicId: string;
  program: string;
  environment: string;
  status: string;
  scopes: string[];
  lastUsedAt: Date | null;
};
