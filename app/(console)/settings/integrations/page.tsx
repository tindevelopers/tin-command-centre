import Link from "next/link";
import { requireOperator } from "@/src/auth/access";
import { readReports } from "@/src/boss/reports";
import { GROUP_LABEL, INTEGRATIONS, integrationStates, publicLeaks, tenantScoped } from "@/src/settings/integrations";
import type { IntegrationGroup, IntegrationState } from "@/src/settings/integrations";
import { isPlatformTenant, listTenants } from "@/src/tenancy/admin";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { currentTenant } from "@/src/tenancy/tenant";
import { EmptyRow, PageHeader, Panel, StatusChip, buttonPrimary } from "@/components/ControlPlane";
import { Notice, Table, td } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";
const neutral = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300";
const GROUPS: IntegrationGroup[] = ["store", "auth", "boss", "github", "tenancy"];

function State({ s }: { s: IntegrationState }) {
  if (s.state === "configured") return <StatusChip colour="green" label="configured" />;
  if (s.state === "partial") return <StatusChip colour="amber" label={`missing ${s.missing.join(", ")}`} />;
  if (s.state === "defaults") return <span className={neutral}>defaults</span>;
  return <span className={neutral}>not set</span>;
}

/**
 * Integrations: what this deployment is connected to, by environment-variable NAME, what each connection switches on, and what
 * the owner sets. Values are never read into the page. One process serves every tenant today; the per-tenant panel shows what
 * phase P4 moves into tenant settings (names only; secrets stay in the manager) and that every tenant inherits the deployment's
 * connections until then. The one live check is the BOSS reports reader, which is already bounded and fail-closed.
 */
export default async function IntegrationsPage() {
  await requireOperator();
  const tenant = await currentTenant();
  const states = integrationStates();
  const leaks = publicLeaks();
  const [reports, tenants, platform] = await Promise.all([
    states.find((s) => s.integration.id === "boss-reports")?.state === "configured" ? readReports() : Promise.resolve(null),
    tenantStoreConfigured() ? listTenants(tenant.id) : Promise.resolve(null),
    tenantStoreConfigured() ? isPlatformTenant(tenant.id) : Promise.resolve(null),
  ]);
  const configured = states.filter((s) => s.state === "configured").length;
  const required = INTEGRATIONS.filter((i) => i.required.length > 0).length;

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Integrations" crumb="Integrations" crumbParent="Settings" subtitle="What this deployment is connected to, by name. Values live in the deployment's environment and the secrets manager; this page never reads one.">
        <span className={neutral}>{configured} of {required} configured</span>
        <Link href="/settings/policy" className={buttonPrimary}>Policy</Link>
      </PageHeader>

      {leaks.length > 0 && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          A server-only name is set with a <span className={mono}>NEXT_PUBLIC_</span> prefix, which bundles its value into the browser: <span className={mono}>{leaks.join(", ")}</span>. Remove it and rotate that credential.
        </p>
      )}

      {GROUPS.map((g) => {
        const rows = states.filter((s) => s.integration.group === g);
        if (rows.length === 0) return null;
        return (
          <Panel key={g} title={GROUP_LABEL[g]} className="mb-8">
            <Table head={["Integration", "Variables", "State", "Enables", "Setup"]}>
              {rows.map((s) => (
                <tr key={s.integration.id}>
                  <td className={`${td} font-medium`}>
                    {s.integration.page ? <Link href={s.integration.page} className="underline">{s.integration.label}</Link> : s.integration.label}
                    <span className={`${neutral} ml-2`}>{s.integration.scope === "tenant" ? "per tenant at P4" : "deployment"}</span>
                  </td>
                  <td className={`${td} ${mono}`}>
                    {s.integration.required.map((k) => <div key={k} className={s.missing.includes(k) ? "text-amber-600 dark:text-amber-400" : ""}>{k}</div>)}
                    {(s.integration.optional ?? []).map((k) => <div key={k} className="text-gray-500 dark:text-gray-400">{k} <span className="font-sans">(optional{s.set.includes(k) ? ", set" : ""})</span></div>)}
                  </td>
                  <td className={td}>
                    <State s={s} />
                    {s.integration.id === "boss-reports" && reports && (
                      <div className="mt-1 text-xs">{reports.status === "ok" ? <StatusChip colour="green" label={`BOSS answered, ${reports.reports.length} report${reports.reports.length === 1 ? "" : "s"}`} /> : <StatusChip colour="red" label={reports.status === "unconfigured" ? "not configured" : `unavailable: ${reports.reason}`} />}</div>
                    )}
                  </td>
                  <td className={`${td} text-xs text-gray-700 dark:text-gray-200`}>{s.integration.enables}<div className="mt-1 text-gray-500 dark:text-gray-400">Without it: {s.integration.without}</div></td>
                  <td className={`${td} text-xs text-gray-600 dark:text-gray-300`}>{s.integration.setup}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        );
      })}

      <Panel title="Per tenant (phase P4)">
        {tenants === null ? (
          <Notice>{tenantStoreConfigured() ? <>Tenant settings wait on <span className={mono}>db/008_tenant_admin.sql</span>; until then this deployment&apos;s connections serve every tenant.</> : "The status store is not connected."}</Notice>
        ) : tenants.length === 0 ? (
          <EmptyRow>No tenant is visible from here.</EmptyRow>
        ) : (
          <Table head={["Tenant", "Database", ...tenantScoped().map((i) => i.label)]}>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td className={`${td} font-medium`}>{t.name} <span className={`${mono} text-gray-500 dark:text-gray-400`}>{t.slug}</span>{t.retiredAt && <span className={`${neutral} ml-2`}>retired</span>}</td>
                <td className={td}>{t.isolation === "dedicated" ? <span className={mono} title="The name of the secret, never its value">{t.connectionRef}</span> : <span className={neutral}>shared · RLS</span>}</td>
                {tenantScoped().map((i) => {
                  const s = states.find((x) => x.integration.id === i.id)!;
                  return <td key={i.id} className={td}>{s.state === "configured" ? <span className={neutral}>inherits deployment</span> : <span className="text-xs text-gray-500 dark:text-gray-400">none</span>}</td>;
                })}
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          P4 of the interface strategy moves the BOSS keys, the agent App installation and the catalog export into per-tenant settings: the tenant row holds the NAMES of its secrets, the values stay in the manager, and <span className={mono}>connectionFor()</span> picks the right store. It waits on W0-03 and OD-9. Until then every tenant inherits what this deployment has{platform === false ? "; only the platform tenant sees other tenants here" : ""}.
        </p>
      </Panel>
    </div>
  );
}
