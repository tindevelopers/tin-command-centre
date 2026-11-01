import { currentOperator, requireOperator } from "@/src/auth/access";
import { listOperators } from "@/src/auth/operators";
import { registryWritable } from "@/src/registry/db";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { currentTenant } from "@/src/tenancy/tenant";
import { OPERATOR_ROLES } from "@/src/tenancy/validate";
import { EmptyRow, PageHeader, Panel, StatusChip } from "@/components/ControlPlane";
import { ErrorNotice, Select, btnCls, inputCls, linkBtnCls } from "@/components/RegistryUi";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";
import { changeRole, invite, remove } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";

/**
 * Operators of the current tenant. Viewers see the list; admins invite by email, change roles and remove. An invited person
 * holds a pending row until they first sign in with that address. Signing in alone still grants nothing (spec C6).
 */
export default async function OperatorsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireOperator();
  const { error } = await searchParams;
  if (!tenantStoreConfigured()) return <div><PageHeading title="Operators" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, op] = await Promise.all([currentTenant(), currentOperator()]);
  const rows = await listOperators(tenant.id);
  const canEdit = op?.role === "admin" && registryWritable();
  const admins = rows.filter((r) => r.role === "admin" && !r.pending).length;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Operators" crumb="Operators" crumbParent="Access" subtitle="Who may use the Control Plane for this tenant, and as what. Membership is per tenant; signing in alone grants nothing.">
        <span className={neutral}>{rows.length} active · {admins} admin{admins === 1 ? "" : "s"}</span>
      </PageHeader>
      <ErrorNotice message={error} />

      <Panel title={`Operators of ${tenant.slug}`}>
        {rows.length === 0 ? <EmptyRow>No operators. Nobody can open this tenant until one is added.</EmptyRow> : (
          <Table head={["Person", "Role", "Added by", "Since", "Status", ...(canEdit ? [""] : [])]}>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className={`${td} font-medium`}>{r.email}{r.userId === me.userId && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">(you)</span>}</td>
                <td className={td}>
                  {canEdit && r.userId !== me.userId ? (
                    <form action={changeRole} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={r.userId} />
                      <Select name="role" options={OPERATOR_ROLES} defaultValue={r.role} />
                      <button className={linkBtnCls}>Set</button>
                    </form>
                  ) : r.role}
                </td>
                <td className={td}>{r.addedBy}</td>
                <td className={td}>{fmt(r.addedAt)}</td>
                <td className={td}>{r.pending ? <span className={neutral} title="Claimed on first sign-in with this address">invited</span> : <StatusChip colour="green" label="active" />}</td>
                {canEdit && (
                  <td className={td}>
                    {r.userId !== me.userId && (
                      <form action={remove}><input type="hidden" name="userId" value={r.userId} /><button className={linkBtnCls}>Remove</button></form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
        {canEdit ? (
          <form action={invite} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <label className="text-sm">Email<br /><input name="email" type="email" autoComplete="off" className={inputCls} required /></label>
            <label className="text-sm">Role<br /><Select name="role" options={OPERATOR_ROLES} /></label>
            <button className={btnCls}>Invite</button>
            <p className="basis-full text-xs text-gray-500 dark:text-gray-400">The invite is claimed when that person first signs in with this address. You cannot change your own role or remove yourself, and the last admin cannot be removed.</p>
          </form>
        ) : (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{op?.role === "admin" ? "Inviting and removing needs CONSOLE_ADMIN_DATABASE_URL." : "Admins invite, change roles and remove."}</p>
        )}
      </Panel>

      <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">Every change is recorded in the audit trail with who made it. Rows are <span className={mono}>console_operators</span>, scoped to this tenant by row-level security.</p>
    </div>
  );
}
