"use client";

import AdminLayoutShell from "@tindevelopers/ui-shell/layout/AdminLayout";
import AppSidebar from "@tindevelopers/ui-shell/layout/AppSidebar";
import AppHeader from "@tindevelopers/ui-shell/layout/AppHeader";
import { consoleNavigation } from "@/config/navigation";
import { accentVars, filterNavigation, type TenantSettings } from "@/src/tenancy/settings-shared";
import React from "react";

const DEFAULT_NAME = "TIN Control";

/**
 * Thin instantiation of the shared shell, same shape as konnect-caas-base/apps/ops/components/ConsoleLayout.tsx. The tenant's
 * settings (db/011) pick the menu, the display name, the logo path and the accent colour; the settings are validated on the
 * server and arrive here as plain data, and the accent is applied as a custom property only after it matched #rrggbb.
 */
export default function ConsoleLayout({ children, settings }: { children: React.ReactNode; settings: TenantSettings }) {
  const branding = { companyName: settings.brand.name ?? DEFAULT_NAME, ...(settings.brand.logoPath ? { logo: settings.brand.logoPath } : {}) };
  const navigation = {
    main: filterNavigation(consoleNavigation.main, settings),
    support: filterNavigation(consoleNavigation.support, settings),
    others: filterNavigation(consoleNavigation.others, settings),
  };
  const style = accentVars(settings) as React.CSSProperties | undefined;
  return (
    <div style={style}>
      <AdminLayoutShell sidebar={<AppSidebar navigation={navigation} branding={branding} />} header={<AppHeader branding={branding} />}>
        {children}
      </AdminLayoutShell>
    </div>
  );
}
