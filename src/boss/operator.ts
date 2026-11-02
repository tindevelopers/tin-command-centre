/**
 * The one way the console calls a BOSS operator route (tin-boss-api src/routes/operator-auth.ts): the console's operator spoke key
 * as `x-api-key`, the signed-in person's Neon Auth JWT as the bearer, and that person on BOSS's operator list. Shared by the
 * releases and review-queue readers so the rules live once:
 *
 * - Server-side only; neither credential is logged, returned or put into an error message.
 * - https only (http for localhost), `redirect: "error"` so a credential never follows a redirect, a fixed time budget.
 * - Fail closed with fixed reasons. Nothing BOSS sends is interpolated into text; a 409 detail is matched against known
 *   phrases and never echoed.
 * - A 404 from a list route means the cell does not mount it: a cell serves only what its configuration enables, and
 *   `tin-production` has no knowledge login, so releases and the review queue are off there (tin-boss-api CLAUDE.md).
 *
 * Environment:
 *   BOSS_API_URL       Base URL of the BOSS cell. Shared with the other BOSS readers.
 *   BOSS_OPERATOR_KEY  The console's operator spoke key. For these pages it must carry boss.releases.write and
 *                      boss.knowledge.write as well as boss.pins.write. Server-only; never prefix with NEXT_PUBLIC_.
 */
export type Missing = ("BOSS_API_URL" | "BOSS_OPERATOR_KEY")[];
export type CallReason = "misconfigured" | "timeout" | "network" | "unauthorized" | "forbidden" | "not_served" | "not_found" | "conflict" | "rejected" | "too_large" | "unprocessable" | "busy" | "http_error" | "malformed";

export type Call =
  | { status: "ok"; code: number; body: unknown }
  | { status: "unconfigured"; missing: Missing }
  | { status: "no-operator-token" }
  | { status: "failed"; reason: CallReason; detail: string };

export type Options = { env?: Record<string, string | undefined>; fetch?: typeof globalThis.fetch; timeoutMs?: number };

export const MAX_BODY_CHARS = 512 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v.toLowerCase());
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function dateOf(v: unknown): Date | undefined {
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function endpoint(base: string, path: string, search = ""): URL | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = search;
  url.hash = "";
  return url;
}

export function operatorConfig(env: Record<string, string | undefined>): { base: string; key: string } | { missing: Missing } {
  const base = env.BOSS_API_URL?.trim();
  const key = env.BOSS_OPERATOR_KEY?.trim();
  const missing: Missing = [];
  if (!base) missing.push("BOSS_API_URL");
  if (!key) missing.push("BOSS_OPERATOR_KEY");
  return missing.length > 0 ? { missing } : { base: base!, key: key! };
}

const reasonOf = (e: unknown): "timeout" | "network" => {
  const name = isObject(e) ? (e as { name?: string }).name : undefined;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
};

/**
 * One operator call. `okCodes` are the statuses that carry a body worth parsing; every other status becomes a fixed reason.
 * `notFoundMeans` says what a 404 is on this route: an unmounted list route, or an unknown item on an action route.
 */
export async function operatorCall(
  path: string,
  init: { method: "GET" | "POST"; search?: string; body?: unknown; okCodes: number[]; notFoundMeans: "not_served" | "not_found" },
  bearer: string | null,
  opts: Options = {},
): Promise<Call> {
  const c = operatorConfig(opts.env ?? process.env);
  if ("missing" in c) return { status: "unconfigured", missing: c.missing };
  if (!bearer) return { status: "no-operator-token" };
  const url = endpoint(c.base, path, init.search ?? "");
  if (!url) return { status: "failed", reason: "misconfigured", detail: "" };

  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      method: init.method,
      headers: { "x-api-key": c.key, authorization: `Bearer ${bearer}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch (e) {
    return { status: "failed", reason: reasonOf(e), detail: "" };
  }

  if (!init.okCodes.includes(res.status)) {
    // The detail of a problem document is kept only for matching against known phrases; it is never shown.
    const detail = res.status === 409 ? await res.json().then((b: unknown) => (isObject(b) && typeof b.detail === "string" ? b.detail.slice(0, 300) : ""), () => "") : "";
    const reason: CallReason =
      res.status === 401 ? "unauthorized"
      : res.status === 403 ? "forbidden"
      : res.status === 404 ? init.notFoundMeans
      : res.status === 409 ? "conflict"
      : res.status === 400 ? "rejected"
      : res.status === 413 ? "too_large"
      : res.status === 422 ? "unprocessable"
      : res.status === 503 || res.status === 429 ? "busy"
      : "http_error";
    return { status: "failed", reason, detail };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { status: "failed", reason: reasonOf(e), detail: "" };
  }
  if (text.length > MAX_BODY_CHARS) return { status: "failed", reason: "too_large", detail: "" };
  try {
    return { status: "ok", code: res.status, body: JSON.parse(text) };
  } catch {
    return { status: "failed", reason: "malformed", detail: "" };
  }
}

/** Fixed text for everything that is not a success. Specific routes add their own 404 and 409 meanings on top. */
export function describeCall(r: Exclude<Call, { status: "ok" }>, route: { notServed: string; notFound: string; conflict: string; scope: string }): string {
  switch (r.status) {
    case "unconfigured":
      return `Not configured: set ${r.missing.join(" and ")}.`;
    case "no-operator-token":
      return "Could not obtain your operator token from Neon Auth. Sign out and in again.";
    case "failed": {
      const why: Record<CallReason, string> = {
        misconfigured: "BOSS_API_URL is not a valid https URL.",
        unauthorized: "BOSS refused the console's operator key or your token.",
        forbidden: `BOSS refused: you are not on its operator list, or the console's operator key lacks ${route.scope}.`,
        not_served: route.notServed,
        not_found: route.notFound,
        conflict: route.conflict,
        rejected: "BOSS rejected the request's shape.",
        too_large: "The request or the response is too large.",
        unprocessable: "BOSS could not act on it.",
        busy: "BOSS is busy; try again in half a minute.",
        http_error: "BOSS answered with an error.",
        malformed: "BOSS returned an unexpected response.",
        timeout: "BOSS did not answer in time.",
        network: "BOSS could not be reached.",
      };
      return why[r.reason];
    }
  }
}
