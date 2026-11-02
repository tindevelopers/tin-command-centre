import { requireOperator } from "@/src/auth/access";
import { hubRows } from "@/src/registry/hubs";
import { loadRegistry, registryConfigured } from "@/src/registry/db";
import { currentTenant } from "@/src/tenancy/tenant";
import { latestDataRun, packageSnapshots, statusStoreConfigured } from "@/src/status/db";
import HubsView from "@/components/HubsView";
import { PageHeader } from "@/components/ControlPlane";
import { Notice, PageHeading } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

/**
 * Hubs and packages: every hub in the topology plan, with what the collector saw published for it. The registry is read only to
 * join owners and annotations; the page still renders from the collector alone if the registry cannot be read.
 */
export default async function PackagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperator();
  const sp = await searchParams;
  if (!statusStoreConfigured()) {
    return (
      <div>
        <PageHeading title="Hubs and packages" />
        <Notice>The status store is not connected. Set CONSOLE_DATABASE_URL to the console_reader connection string in .env.local.</Notice>
      </div>
    );
  }
  const [tenant, run] = await Promise.all([currentTenant(), latestDataRun()]);
  const [packages, registry] = await Promise.all([
    run ? packageSnapshots(run.id) : Promise.resolve(null),
    registryConfigured() ? loadRegistry().catch(() => null) : Promise.resolve(null),
  ]);
  const rows = hubRows(packages, registry);
  return (
    <div>
      <PageHeader tenant={tenant.slug} title="Hubs and packages" crumb="Hubs and packages" subtitle="Every package in the estate: what is on latest and next, who depends on it, and what the topology plan does with its hub." />
      <HubsView rows={rows} run={run} sp={sp} />
    </div>
  );
}
