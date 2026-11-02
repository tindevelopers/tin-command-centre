/**
 * The credential authority, as the Control Plane sees it (interface strategy 2026-11-01, §3): identities, keys, scopes and,
 * later, verification outcomes. Metadata only, never a secret (spec C5). Today the one adapter reads the collector's
 * `credential_snapshots` (src/credentials/snapshots.ts), which mirror `api-credentials` in shared-api-hub. A later authority
 * (Unkey, or api-credentials read live) is another adapter behind this same shape, so the page does not change.
 */
export type KeyStatus = "active" | "revoked" | "expired" | string;

export type KeyRecord = {
  /** The BOSS cell the key was minted for (`tin-boss-api-konnect-dev`). */
  cell: string;
  /** The key's public identifier; never the secret. */
  publicId: string;
  /** The platform the key belongs to (`konnect`, `pawpointers`, `console`, `tin`), BOSS's `program`. */
  platform: string;
  environment: string;
  status: KeyStatus;
  scopes: string[];
  lastUsedAt: Date | null;
};

export type CredentialSnapshotSet = {
  /** When the authority was last read, or null when it has never been. */
  observedAt: Date | null;
  keys: KeyRecord[];
};

export interface CredentialAuthority {
  /** A short name for the page's footer: where these facts come from. */
  readonly name: string;
  /** What the authority last reported; `keys` is empty, with `observedAt` null, when nothing has been collected yet. */
  read(): Promise<CredentialSnapshotSet>;
}
