import { isPinString, isPlatform, MAX_PINS } from "./drafts";

/**
 * Sends one pin proposal to BOSS: `POST /v1/pin-proposals` (tin-boss-api src/routes/pin-proposals.ts), operator-only.
 *
 * - Two credentials, both server-side: the console's operator spoke key (`BOSS_OPERATOR_KEY`, scope boss.pins.write) as
 *   `x-api-key`, and the signed-in person's Neon Auth JWT as the bearer. BOSS also requires that person on its operator list.
 *   Neither credential is logged, returned or put into an error message.
 * - Fail closed: anything but a 201 with an id is a fixed-string failure; nothing BOSS sends is interpolated.
 * - BOSS proposes, platforms pull: this never touches a platform repository (BOSS-8).
 */
export type ProposalInput = { platform: string; pins: string[] };

export type ProposeResult =
  | { status: "ok"; id: string }
  | { status: "unconfigured"; missing: ("BOSS_API_URL" | "BOSS_OPERATOR_KEY")[] }
  | { status: "no-operator-token" }
  | { status: "invalid"; reason: string }
  | { status: "failed"; reason: "misconfigured" | "unauthorized" | "forbidden" | "rejected" | "http_error" | "malformed" | "timeout" | "network" };

type Options = { env?: Record<string, string | undefined>; fetch?: typeof globalThis.fetch; timeoutMs?: number };

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function describeProposeFailure(r: Exclude<ProposeResult, { status: "ok" }>): string {
  switch (r.status) {
    case "unconfigured":
      return `Sending is not configured: set ${r.missing.join(" and ")}.`;
    case "no-operator-token":
      return "Could not obtain your operator token from Neon Auth. Sign out and in again; if it persists, the auth base URL or the token endpoint is wrong.";
    case "invalid":
      return `Nothing was sent: ${r.reason}`;
    case "failed": {
      const why: Record<typeof r.reason, string> = {
        misconfigured: "BOSS_API_URL is not a valid https URL.",
        unauthorized: "BOSS refused the console's operator key or your token.",
        forbidden: "BOSS refused: you are not on its operator list, or the key lacks boss.pins.write.",
        rejected: "BOSS rejected the proposal's shape.",
        http_error: "BOSS answered with an error.",
        malformed: "BOSS returned an unexpected response.",
        timeout: "BOSS did not answer in time.",
        network: "BOSS could not be reached.",
      };
      return `Not sent: ${why[r.reason]}`;
    }
  }
}

function endpoint(base: string): URL | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/pin-proposals`;
  url.search = "";
  url.hash = "";
  return url;
}

/** The same shape BOSS enforces, checked here so a bad draft never leaves the console. */
export function validateProposal(input: ProposalInput): string | null {
  if (!isPlatform(input.platform)) return "the platform name is not valid.";
  if (input.pins.length === 0) return "there are no pins.";
  if (input.pins.length > MAX_PINS) return `a proposal carries at most ${MAX_PINS} pins.`;
  if (new Set(input.pins).size !== input.pins.length) return "a pin is repeated.";
  const bad = input.pins.find((p) => !isPinString(p));
  if (bad) return "a pin is not a hub package at an exact version.";
  return null;
}

export async function sendProposal(input: ProposalInput, bearer: string | null, opts: Options = {}): Promise<ProposeResult> {
  const env = opts.env ?? process.env;
  const base = env.BOSS_API_URL?.trim();
  const key = env.BOSS_OPERATOR_KEY?.trim();
  const missing: ("BOSS_API_URL" | "BOSS_OPERATOR_KEY")[] = [];
  if (!base) missing.push("BOSS_API_URL");
  if (!key) missing.push("BOSS_OPERATOR_KEY");
  if (missing.length > 0) return { status: "unconfigured", missing };
  const invalid = validateProposal(input);
  if (invalid) return { status: "invalid", reason: invalid };
  if (!bearer) return { status: "no-operator-token" };
  const url = endpoint(base!);
  if (!url) return { status: "failed", reason: "misconfigured" };

  try {
    const res = await (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "x-api-key": key!, authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ platform: input.platform, pins: [...input.pins] }),
      redirect: "error", // never forward credentials to a redirect target
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (res.status === 401) return { status: "failed", reason: "unauthorized" };
    if (res.status === 403) return { status: "failed", reason: "forbidden" };
    if (res.status === 400 || res.status === 413 || res.status === 422) return { status: "failed", reason: "rejected" };
    if (res.status !== 201) return { status: "failed", reason: "http_error" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { status: "failed", reason: "malformed" };
    }
    const id = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : undefined;
    return typeof id === "string" && ID.test(id) ? { status: "ok", id } : { status: "failed", reason: "malformed" };
  } catch (e) {
    const name = typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
    return { status: "failed", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
