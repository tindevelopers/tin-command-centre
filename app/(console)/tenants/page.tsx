import { currentOperator, requireOperator } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { integrationStatus, isPlatformTenant, listTenants, tenantHost } from "@/src/tenancy/admin";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { tenantConfig } from "@/src/tenancy/host";
import { currentTenant } from "@/src/tenancy/tenant";
import { ISOLATIONS } from "@/src/tenancy/validate";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary } from "@/components/ControlPlane";
import { ErrorNotice, Select, btnCls, inputCls, linkBtnCls } from "@/components/RegistryUi";
import { Notice, PageHeading, Table, fmt, td } from "@/components/StatusUi";
import { addTenant, retireTenantAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const plan = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-300";

/**
 * Tenants: the platform tenant's admins see and manage every tenant; any other tenant sees its own row. Every value shown is
 * registry data or a configured NAME; no connection string or key is ever read into the page.
 */
export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireOperator();
  const { error } = await searchParams;
  if (!tenantStoreConfigured()) return <div><PageHeading title="Tenants" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [tenant, op] = await Promise.all([currentTenant(), currentOperator()]);
  const [rows, platform] = await Promise.all([listTenants(tenant.id), isPlatformTenant(tenant.id)]);
  const cfg = tenantConfig();
  const canManage = Boolean(platform) && op?.role === "admin" && registryWritable();
  const integrations = integrationStatus();

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Tenants" crumb="Tenants" crumbParent="Settings" subtitle="One database, many tenants, isolated by row-level security. A tenant is a subdomain; membership is per tenant.">
        {platform ? <span className={plan}>platform tenant</span> : <span className={neutral}>tenant view</span>}
      </PageHeader>
      <ErrorNotice message={error} />

      {rows === null ? (
        <Notice>Tenant management is not switched on yet: <span className={mono}>db/008_tenant_admin.sql</span> has not been applied. The owner applies it; this page then lists tenants, and platform admins can create and retire them.</Notice>
      ) : (
        <Panel title={platform ? "All tenants" : "This tenant"}>
          {rows.length === 0 ? <EmptyRow>No tenant is visible from here.</EmptyRow> : (
            <Table head={["Tenant", "Host", "Isolation", "Projects", "Operators", "Since", "Status", ...(canManage ? [""] : [])]}>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className={`${td} font-medium`}>
                    {t.name} <span className={`${mono} text-gray-500 dark:text-gray-400`}>{t.slug}</span>
                    {t.platform && <span className={`${plan} ml-2`}>platform</span>}
                  </td>
                  <td className={`${td} ${mono}`}>{tenantHost(t.slug, cfg)}</td>
                  <td className={td}>
                    <span className={neutral}>{t.isolation === "dedicated" ? "dedicated" : "shared · RLS"}</span>
                    {t.connectionRef && <div className={`${mono} mt-1 text-gray-500 dark:text-gray-400`} title="The name of the secret, never its value">{t.connectionRef}</div>}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{t.projects}</td>
                  <td className={`${td} text-right tabular-nums`}>{t.operators}</td>
                  <td className={td} title={fmt(t.createdAt)}>{fmt(t.createdAt).slice(0, 10)}</td>
                  <td className={td}>{t.retiredAt ? <span className={neutral}>retired {fmt(t.retiredAt).slice(0, 10)}</span> : <StatusChip colour="green" label="active" />}</td>
                  {canManage && (
                    <td className={td}>
                      {!t.platform && !t.retiredAt && (
                        <form action={retireTenantAction}><input type="hidden" name="slug" value={t.slug} /><button className={linkBtnCls}>Retire</button></form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <form action={addTenant} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
              <label className="text-sm">Slug<br /><input name="slug" autoComplete="off" pattern="[a-z0-9][a-z0-9-]{0,28}[a-z0-9]" placeholder="acme" className={inputCls} required /></label>
              <label className="text-sm">Name<br /><input name="name" autoComplete="off" maxLength={80} className={inputCls} required /></label>
              <label className="text-sm">Isolation<br /><Select name="isolation" options={ISOLATIONS} /></label>
              <label className="text-sm">Connection secret name (dedicated only)<br /><input name="connectionRef" autoComplete="off" placeholder="TENANT_ACME_DATABASE_URL" className={inputCls} /></label>
              <button className={btnCls}>Create tenant</button>
              <p className="basis-full text-xs text-gray-500 dark:text-gray-400">The new tenant answers on <span className={mono}>&lt;slug&gt;.{cfg.baseDomain}</span> once DNS points there. Its first operator is invited from that host&apos;s Operators page by a platform admin who is also a member there, or by SQL. A dedicated tenant takes the NAME of the secret that will hold its connection string; the value goes in the secrets manager, never here.</p>
            </form>
          )}
          {platform && !canManage && rows.length > 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{op?.role === "admin" ? "Creating and retiring tenants needs CONSOLE_ADMIN_DATABASE_URL." : "Admins of the platform tenant create and retire tenants."}</p>
          )}
        </Panel>
      )}

      <Panel title={`Integrations for ${tenant.slug}`} className="mt-8">
        <Table head={["Integration", "Environment variable", "State", "Note"]}>
          {integrations.map((i) => (
            <tr key={i.name}>
              <td className={`${td} font-medium`}>{i.label}</td>
              <td className={`${td} ${mono}`}>{i.name}</td>
              <td className={td}>{i.configured ? <StatusChip colour="green" label="configured" /> : <span className={neutral}>not set</span>}</td>
              <td className={`${td} text-gray-600 dark:text-gray-300`}>{i.note}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Names only; values are never read into a page. One deployment serves every tenant today, so these describe the deployment. Per-tenant integrations are phase P4 of the interface strategy.</p>
      </Panel>

      <Panel title="How a request is scoped" className="mt-8">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li><span className={mono}>{cfg.baseDomain}</span> is <span className={mono}>{cfg.defaultTenant}</span>; <span className={mono}>&lt;slug&gt;.{cfg.baseDomain}</span> is that tenant. Only the <span className={mono}>Host</span> header is trusted; reserved labels are a 404.</li>
          <li><span className={mono}>resolve_tenant(slug)</span> is the only way an app role learns a tenant id; a retired or unknown tenant is a 404.</li>
          <li>Every read and write first runs <span className={mono}>set_config(&apos;app.tenant_id&apos;, …)</span>; row-level security on each registry table matches that id and nothing else.</li>
          <li>Operators are per tenant: an admin of one tenant is a stranger in another. Collector runs and snapshots describe the whole estate and are not tenant-scoped.</li>
        </ol>
        <p className="mt-3"><a href="/operators" className={buttonPrimary}>Operators of {tenant.slug}</a></p>
      </Panel>
    </div>
  );
}
