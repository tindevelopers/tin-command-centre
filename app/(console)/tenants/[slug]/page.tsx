import Link from "next/link";
import { notFound } from "next/navigation";
import { currentOperator, requireOperator } from "@/src/auth/access";
import { registryWritable } from "@/src/registry/db";
import { isPlatformTenant, listTenants, tenantHost } from "@/src/tenancy/admin";
import { tenantStoreConfigured } from "@/src/tenancy/db";
import { isTenantSlug, tenantConfig } from "@/src/tenancy/host";
import { readTenantSettings } from "@/src/tenancy/settings-admin";
import { currentTenant } from "@/src/tenancy/tenant";
import { PageHeader, Panel } from "@/components/ControlPlane";
import { ErrorNotice } from "@/components/RegistryUi";
import { Notice, PageHeading, fmt } from "@/components/StatusUi";
import WorkspaceForm from "@/components/WorkspaceForm";
import { saveTenantWorkspaceAction } from "./actions";

export const dynamic = "force-dynamic";

const mono = "font-mono text-xs";

/**
 * A tenant's workspace settings, edited by an admin of the platform tenant. Everyone else gets a 404: the page does not confirm
 * that another tenant exists. The values are read and written only through db/012's functions, which check the platform tenant
 * themselves.
 */
export default async function TenantWorkspacePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireOperator();
  const { slug } = await params;
  const { error, saved } = await searchParams;
  if (!isTenantSlug(slug)) notFound();
  if (!tenantStoreConfigured()) return <div><PageHeading title="Tenant workspace" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;

  const [caller, op] = await Promise.all([currentTenant(), currentOperator()]);
  if (!(await isPlatformTenant(caller.id))) notFound();
  const rows = await listTenants(caller.id);
  const target = rows?.find((t) => t.slug === slug);
  if (!target) notFound();

  const read = await readTenantSettings(caller.id, slug);
  const canEdit = op?.role === "admin" && registryWritable() && !target.retiredAt && read !== null;
  const cfg = tenantConfig();

  return (
    <div>
      <PageHeader tenant={caller.slug} title={`Workspace: ${target.name}`} crumb={target.slug} crumbParent="Tenants" subtitle="The look and menu this tenant sees. You are editing another tenant as an admin of the platform tenant.">
        <Link href="/tenants" className="text-sm underline">All tenants</Link>
      </PageHeader>
      <ErrorNotice message={error} />
      {saved && <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-200">Saved. {target.name} sees this the next time a page loads.</div>}

      {read === null ? (
        <Notice>Editing other tenants is not switched on yet: <span className={mono}>db/012_platform_tenant_settings.sql</span> has not been applied. The owner applies it after 011; this page then edits any active tenant.</Notice>
      ) : (
        <Panel title={`${target.name} · ${tenantHost(target.slug, cfg)}`}>
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            {read.hasRow ? <>Last changed {fmt(read.updatedAt).slice(0, 16)} by {read.updatedBy ?? "unknown"}.</> : "No settings saved yet: this tenant sees every module and the default look."}
            {" "}The change is recorded in this tenant&apos;s audit trail and in yours.
          </p>
          <WorkspaceForm
            settings={read.settings}
            action={saveTenantWorkspaceAction}
            canEdit={canEdit}
            hidden={{ slug: target.slug }}
            whyReadOnly={target.retiredAt ? "This tenant is retired." : op?.role !== "admin" ? "Admins of the platform tenant edit other tenants." : "Saving needs CONSOLE_ADMIN_DATABASE_URL."}
          />
        </Panel>
      )}
    </div>
  );
}
