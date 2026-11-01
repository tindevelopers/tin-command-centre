import { headers } from "next/headers";
import { extractNeonAuthCookies } from "@neondatabase/auth/server";

/**
 * The signed-in person's Neon Auth JWT, for calls BOSS authenticates as an operator (a spoke key AND a user bearer AND BOSS's
 * operator list). Neon Auth is managed Better Auth with the JWT plugin, whose `GET <base>/token` answers a session cookie with
 * `{ token }`; BOSS verifies that token against the same Neon Auth's JWKS. The token is forwarded, never stored or logged.
 * Null when there is no session, no base URL, or Neon Auth does not answer: the caller then says it cannot act as an operator.
 */
export async function operatorBearer(opts: { env?: Record<string, string | undefined>; fetch?: typeof globalThis.fetch; cookie?: string | null } = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const base = env.NEON_AUTH_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const cookie = opts.cookie === undefined ? extractNeonAuthCookies(await headers()) : opts.cookie;
  if (!cookie) return null;
  try {
    const res = await (opts.fetch ?? fetch)(`${base}/token`, {
      method: "GET",
      headers: { cookie, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" && body.token.length > 0 ? body.token : null;
  } catch {
    return null;
  }
}
