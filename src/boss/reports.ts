/**
 * Reader for BOSS `GET /v1/reports` (BOSS upstream replan, Task 4b.3): what each platform environment says it is running.
 *
 * - Server-side only. The console authenticates with its OWN spoke key (scope `boss.reports.read`, minted by the owner in program `tin`).
 *   The key is read from the server environment here and sent as `x-api-key`; it never reaches the browser, a log line or a return value.
 * - Fail closed. A missing config, a timeout, a network error, a non-2xx status, a body that is too large, or a body that does not match
 *   the contract all give an explicit `{ status: "unavailable" }` (or "unconfigured"). The reader never throws into a page.
 * - Nothing BOSS sends is passed through unchecked. `parseReports` is the single place the wire shape is mapped; every field is validated
 *   against the same patterns BOSS enforces on `POST /v1/reports`, so what leaves this module is plain, bounded, display-safe data.
 *
 * Environment:
 *   BOSS_API_URL      Base URL of the BOSS cell, https only (http is accepted for localhost, for development). Example: https://boss.example.com
 *   BOSS_REPORTS_KEY  The console's spoke key with `boss.reports.read` as its only scope. Server-only; never prefix with NEXT_PUBLIC_.
 */

export const REPORT_HEALTH = ["ok", "degraded", "down"] as const;
export type ReportHealth = (typeof REPORT_HEALTH)[number];

/** One component's latest report for a platform environment (the BOSS row, `boss_upstream.reports`). */
export type BossReport = {
  platform: string;
  environment: string;
  component: string;
  versions: Record<string, string>;
  health: ReportHealth;
  errors: { code: string; count: number }[];
  reportedAt: Date;
};

export type UnavailableReason = "misconfigured" | "timeout" | "network" | "unauthorized" | "http_error" | "malformed" | "too_large";

export type ReportsResult =
  | { status: "ok"; reports: BossReport[] }
  | { status: "unconfigured" }
  | { status: "unavailable"; reason: UnavailableReason };

/** Human text for a result that is not "ok". Fixed strings only: nothing BOSS sent is ever interpolated. */
export function describeUnavailable(r: Exclude<ReportsResult, { status: "ok" }>): string {
  if (r.status === "unconfigured") return "BOSS reports are not configured. Set BOSS_API_URL and BOSS_REPORTS_KEY.";
  const why: Record<UnavailableReason, string> = {
    misconfigured: "BOSS_API_URL is not a valid https URL.",
    timeout: "BOSS did not answer in time.",
    network: "BOSS could not be reached.",
    unauthorized: "BOSS refused the console's key.",
    http_error: "BOSS answered with an error.",
    malformed: "BOSS returned an unexpected response.",
    too_large: "BOSS returned a response that is too large.",
  };
  return `BOSS reports are unavailable: ${why[r.reason]}`;
}

// The patterns mirror the POST /v1/reports schema in BOSS (plan 4b.3). The platform and environment come from BOSS's credential mapping.
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COMPONENT = /^[a-z0-9-]{1,40}$/;
const PACKAGE = /^@?[a-z0-9-]+(\/[a-z0-9.-]+)?$/;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const ERROR_CODE = /^[a-z0-9_.-]{1,64}$/;
const MAX_VERSIONS = 50;
const MAX_ERRORS = 20;
const MAX_ROWS = 1000;
const MAX_BODY_CHARS = 512 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const matches = (re: RegExp, v: unknown): v is string => typeof v === "string" && re.test(v);

function parseRow(row: unknown): BossReport | null {
  if (!isObject(row)) return null;
  const { platform, environment, component, versions, health, errors } = row;
  // ASSUMPTION (BOSS reports.ts may not exist yet): the timestamp is `reportedAt` (camelCase). The column is `reported_at`, so accept that too.
  const at = row.reportedAt ?? row.reported_at;
  if (!matches(ID, platform) || !matches(ID, environment) || !matches(COMPONENT, component)) return null;
  if (!(REPORT_HEALTH as readonly unknown[]).includes(health)) return null;

  if (!isObject(versions)) return null;
  const entries = Object.entries(versions);
  if (entries.length > MAX_VERSIONS) return null;
  const parsedVersions: Record<string, string> = Object.create(null);
  for (const [name, version] of entries) {
    if (!PACKAGE.test(name) || !matches(VERSION, version)) return null;
    parsedVersions[name] = version;
  }

  if (!Array.isArray(errors) || errors.length > MAX_ERRORS) return null;
  const parsedErrors: BossReport["errors"] = [];
  for (const e of errors) {
    if (!isObject(e) || !matches(ERROR_CODE, e.code) || !Number.isInteger(e.count) || (e.count as number) < 1 || (e.count as number) > 1_000_000) return null;
    parsedErrors.push({ code: e.code, count: e.count as number });
  }

  if (typeof at !== "string" && typeof at !== "number") return null;
  const reportedAt = new Date(at);
  if (Number.isNaN(reportedAt.getTime())) return null;

  return { platform, environment, component, versions: { ...parsedVersions }, health: health as ReportHealth, errors: parsedErrors, reportedAt };
}

/**
 * Wire shape to internal shape. Accepts a bare array or `{ reports: [...] }`. Returns null if anything is off, so one bad row
 * rejects the whole response rather than showing a partial picture as if it were complete.
 */
export function parseReports(body: unknown): BossReport[] | null {
  const rows = Array.isArray(body) ? body : isObject(body) && Array.isArray(body.reports) ? body.reports : null;
  if (!rows || rows.length > MAX_ROWS) return null;
  const out: BossReport[] = [];
  for (const row of rows) {
    const parsed = parseRow(row);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

type ReadOptions = { env?: Record<string, string | undefined>; fetch?: typeof globalThis.fetch; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 3000;

/** The reports endpoint, or null if the configured base URL is not acceptable. The key is only ever sent to https (or localhost). */
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
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/reports`;
  url.search = "";
  url.hash = "";
  return url;
}

/** Reads every platform's reports from BOSS. Never throws. */
export async function readReports(opts: ReadOptions = {}): Promise<ReportsResult> {
  const env = opts.env ?? process.env;
  const base = env.BOSS_API_URL?.trim();
  const key = env.BOSS_REPORTS_KEY?.trim();
  if (!base || !key) return { status: "unconfigured" };
  const url = endpoint(base);
  if (!url) return { status: "unavailable", reason: "misconfigured" };

  try {
    const res = await (opts.fetch ?? fetch)(url, {
      method: "GET",
      headers: { "x-api-key": key, accept: "application/json" },
      redirect: "error", // never forward the key to a redirect target
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { status: "unavailable", reason: "unauthorized" };
    if (!res.ok) return { status: "unavailable", reason: "http_error" };
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return { status: "unavailable", reason: "too_large" };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: "unavailable", reason: "malformed" };
    }
    const reports = parseReports(body);
    return reports ? { status: "ok", reports } : { status: "unavailable", reason: "malformed" };
  } catch (e) {
    // Only the kind of failure is kept: the error text could carry the URL or a header.
    const name = typeof e === "object" && e !== null ? (e as { name?: string }).name : undefined;
    return { status: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
