"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/src/auth/access";
import { inviteOperator, removeOperator, setOperatorRole } from "@/src/auth/operators";
import { ValidationError } from "@/src/registry/validate";
import { currentTenant } from "@/src/tenancy/tenant";
import { parseInviteOperator, parseOperatorId, parseOperatorRole } from "@/src/tenancy/validate";

/** Each action re-checks admin itself: server actions are callable without the page. */
async function run(fn: (tenantId: string, actor: { userId: string; email: string }) => Promise<void>) {
  const admin = await requireAdmin();
  const tenant = await currentTenant();
  let error: string | null = null;
  try {
    await fn(tenant.id, { userId: admin.userId, email: admin.email });
  } catch (e) {
    if (e instanceof ValidationError || (e instanceof Error && /^You cannot/.test(e.message))) error = (e as Error).message;
    else {
      console.error("operator write failed", e);
      error = "Could not save. Check the values and try again.";
    }
  }
  revalidatePath("/operators");
  redirect(error ? `/operators?error=${encodeURIComponent(error)}` : "/operators");
}

export async function invite(f: FormData) {
  return run((tenantId, actor) => inviteOperator(tenantId, actor.email, parseInviteOperator(f)));
}

export async function changeRole(f: FormData) {
  return run((tenantId, actor) => {
    const { userId, role } = parseOperatorRole(f);
    return setOperatorRole(tenantId, actor, userId, role);
  });
}

export async function remove(f: FormData) {
  return run((tenantId, actor) => removeOperator(tenantId, actor, parseOperatorId(f).userId));
}
