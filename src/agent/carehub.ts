import type { TicketPriority } from "./task";

/** The platform support queue in konnect-ops (POST /api/platform/support/intake). The ticket is the record; the GitHub issue is the work order. */
export type CareHubConfig = { url: string; token: string };
export type CareHubTicket = { id: string; number: string; status: string };

export const careHubConfig = (): CareHubConfig | null => {
  const url = process.env.CARE_HUB_INTAKE_URL, token = process.env.CARE_HUB_INTAKE_TOKEN;
  return url && token ? { url, token } : null;
};
export const careHubConfigured = () => careHubConfig() !== null;

async function call(cfg: CareHubConfig, body: Record<string, unknown>): Promise<CareHubTicket> {
  // The bearer token must never travel over plain http, except to a local dev server.
  if (!/^https:\/\//.test(cfg.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(cfg.url)) throw new Error("CARE_HUB_INTAKE_URL must be an https URL.");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; ticket?: { id: string; ticket_number: string; status: string } } | null;
  if (!res.ok || !json?.ok || !json.ticket) throw new Error(`Care hub answered ${res.status}${json?.error ? `: ${json.error.replace(/\.$/, "")}` : ""}.`);
  return { id: json.ticket.id, number: json.ticket.ticket_number, status: json.ticket.status };
}

export async function createCareHubTicket(input: { subject: string; description: string; priority: TicketPriority }, cfg: CareHubConfig | null = careHubConfig()) {
  if (!cfg) throw new Error("The care hub is not configured.");
  return await call(cfg, { action: "create", ...input });
}

export async function resolveCareHubTicket(input: { ticketId: string; note: string }, cfg: CareHubConfig | null = careHubConfig()) {
  if (!cfg) throw new Error("The care hub is not configured.");
  return await call(cfg, { action: "update", ticket_id: input.ticketId, event: "resolved", note: input.note });
}
