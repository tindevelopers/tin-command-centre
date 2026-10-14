"use client";

import AdminLayoutShell from "@tindevelopers/ui-shell/layout/AdminLayout";
import AppSidebar from "@tindevelopers/ui-shell/layout/AppSidebar";
import AppHeader from "@tindevelopers/ui-shell/layout/AppHeader";
import { consoleNavigation } from "@/config/navigation";
import React from "react";

const branding = { companyName: "TIN Command" };

/** Thin instantiation of the shared shell, same shape as konnect-caas-base/apps/ops/components/ConsoleLayout.tsx. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminLayoutShell
      sidebar={<AppSidebar navigation={consoleNavigation} branding={branding} />}
      header={<AppHeader branding={branding} />}
    >
      {children}
    </AdminLayoutShell>
  );
}
