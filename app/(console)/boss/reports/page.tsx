import { requireOperator } from "@/src/auth/access";
import { compareReported, needsReports } from "@/src/boss/compare";
import { readReports } from "@/src/boss/reports";
import { platformCounts, platformSummary, registeredPlatforms } from "@/src/boss/summary";
import { loadRegistry, registryConfigured } from "@/src/registry/db";
import { currentTenant } from "@/src/tenancy/tenant";
import { BossPanel } from "@/components/BossPanel";
import { PageHeader, Panel } from "@/components/ControlPlane";
import { ReportedPins } from "@/components/ReportedPins";
import { Notice, PageHeading } from "@/components/StatusUi";

export const dynamic = "force-dynamic";

/**
 * BOSS reports: what every platform environment says it is running (GET /v1/reports, read with the console's own key), and the
 * declared pins compared against it across all projects. Read-only: the console never writes to a platform.
 */
export default async function BossReportsPage() {
  await requireOperator();
  if (!registryConfigured()) return <div><PageHeading title="Reports" /><Notice>The status store is not connected. Set CONSOLE_DATABASE_URL.</Notice></div>;
  const [tenant, reg, result] = await Promise.all([currentTenant(), loadRegistry(), readReports()]);
  const rows = platformSummary(reg, result);
  const registered = registeredPlatforms(reg.projects);
  const counts = platformCounts(rows, registered);
  const comparable = reg.projects.filter((p) => needsReports(p, reg.pins));
  const comparisons = compareReported({ projects: reg.projects, pins: reg.pins.filter((p) => comparable.some((c) => c.slug === p.projectSlug)) }, result);

  return (
    <div>
      <PageHeader tenant={tenant.slug} title="BOSS: reports" crumb="Reports" crumbParent="BOSS" subtitle="What platforms report they are running. BOSS proposes and platforms pull; nothing here touches a platform.">
        <span className="rounded border border-gray-200 px-2 py-0.5 font-mono text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
          {counts.reporting} of {counts.registered} registered platform{counts.registered === 1 ? "" : "s"} reporting
        </span>
      </PageHeader>

      <Panel title="By platform environment">
        <BossPanel rows={rows} result={result} />
      </Panel>

      <Panel title="Declared versus reported" className="mt-8">
        {comparisons.length === 0 ? (
          <Notice>No active project declares a watched pin for a platform, so there is nothing to compare yet. The watched packages are knowledge, knowledge-worker and credential-crypto.</Notice>
        ) : (
          <ReportedPins comparisons={comparisons} result={result} />
        )}
      </Panel>
    </div>
  );
}
