import { tenantQuery, tenantWrite } from "@/src/tenancy/db";
import type { InviteOperatorInput, OperatorRole } from "@/src/tenancy/validate";
import { pendingUserId } from "@/src/tenancy/validate";

/**
 * The operators of one tenant (console_operators, row-level secured per tenant since db/006). Admins invite by email: the row
 * holds `pending:<email>` as its user id until that person first signs in, when access.ts swaps in their Neon Auth id.
 * Removing is `removed_at`, never a delete, like everything in the registry; the audit trigger records each change.
 */
export type OperatorRow = { userId: string; email: string; role: OperatorRole; addedBy: string; addedAt: Date; pending: boolean };

export async function listOperators(tenantId: string): Promise<OperatorRow[]> {
  const rows = await tenantQuery(tenantId, "select user_id, email, role, added_by, added_at from console_operators where removed_at is null order by email");
  return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role, addedBy: r.added_by, addedAt: new Date(r.added_at), pending: String(r.user_id).startsWith("pending:") }));
}

/** Invite, or re-activate a removed pending invite for the same address. added_by comes from the audited actor, not the form. */
export async function inviteOperator(tenantId: string, actor: string, input: InviteOperatorInput): Promise<void> {
  await tenantWrite(tenantId, actor, [{
    text: `INSERT INTO console_operators (user_id, email, role, added_by) VALUES ($1, $2, $3, current_setting('console.actor'))
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, removed_at = NULL, added_by = current_setting('console.actor'), added_at = now()`,
    params: [pendingUserId(input.email), input.email, input.role],
  }]);
}

/** A person may not change their own role: an admin who demotes themself locks the tenant's last door behind them. */
export async function setOperatorRole(tenantId: string, actor: { userId: string; email: string }, userId: string, role: OperatorRole): Promise<void> {
  if (userId === actor.userId) throw new Error("You cannot change your own role.");
  await tenantWrite(tenantId, actor.email, [{
    text: "UPDATE console_operators SET role = $2 WHERE user_id = $1 AND removed_at IS NULL",
    params: [userId, role],
  }]);
}

/** Removal keeps at least one active admin in the tenant; the WHERE clause enforces it inside the same statement. */
export async function removeOperator(tenantId: string, actor: { userId: string; email: string }, userId: string): Promise<void> {
  if (userId === actor.userId) throw new Error("You cannot remove yourself.");
  await tenantWrite(tenantId, actor.email, [{
    text: `UPDATE console_operators SET removed_at = now()
           WHERE user_id = $1 AND removed_at IS NULL
             AND (role <> 'admin' OR (SELECT count(*) FROM console_operators WHERE role = 'admin' AND removed_at IS NULL) > 1)`,
    params: [userId],
  }]);
}

/** The pending invite for an address in this tenant, if any. */
export async function pendingInvite(tenantId: string, email: string): Promise<{ role: OperatorRole } | null> {
  const rows = await tenantQuery(tenantId, "select role from console_operators where user_id = $1 and removed_at is null", [pendingUserId(email)]);
  return rows[0] ? { role: rows[0].role } : null;
}

/**
 * Turn a pending invite into membership for the signed-in user. If this user already has a (removed) row, that row is
 * re-activated with the invited role and the invite is closed, since the primary key is (tenant_id, user_id).
 */
export async function claimInvite(tenantId: string, user: { id: string; email: string }): Promise<void> {
  const pending = pendingUserId(user.email);
  await tenantWrite(tenantId, user.email, [
    {
      text: `UPDATE console_operators SET user_id = $1 WHERE user_id = $2 AND removed_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM console_operators WHERE user_id = $1)`,
      params: [user.id, pending],
    },
    {
      text: `UPDATE console_operators o SET removed_at = NULL, role = p.role, added_by = p.added_by, added_at = now()
             FROM console_operators p WHERE o.user_id = $1 AND p.user_id = $2 AND p.removed_at IS NULL`,
      params: [user.id, pending],
    },
    { text: "UPDATE console_operators SET removed_at = now() WHERE user_id = $2 AND removed_at IS NULL AND EXISTS (SELECT 1 FROM console_operators WHERE user_id = $1 AND removed_at IS NULL)", params: [user.id, pending] },
  ]);
}
