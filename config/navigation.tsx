import React from "react";
import { GridIcon, BoxIcon, BoltIcon, TableIcon, ListIcon, PieChartIcon, PlugInIcon, GroupIcon, LockIcon } from "@tindevelopers/ui-shell/icons";
import type { ShellNavItem } from "@tindevelopers/ui-shell";

const icon = (C: React.ComponentType) => React.createElement(C);

/**
 * TIN Control Plane navigation (spec C7), in the order of the 2026-11-01 interface strategy: the estate first, then BOSS.
 * The shared sidebar has three fixed sections with fixed headings, so BOSS is a submenu rather than a titled group; a page
 * is listed only once it exists. Consumers and keys (T13) arrives with its page.
 */
export const consoleNavigation: {
  main: ShellNavItem[];
  support: ShellNavItem[];
  others: ShellNavItem[];
} = {
  main: [
    { name: "Overview", path: "/", icon: icon(GridIcon) },
    { name: "Projects", path: "/projects", icon: icon(ListIcon) },
    { name: "Hubs and packages", path: "/packages", icon: icon(BoxIcon) },
    { name: "Cells", path: "/cells", icon: icon(BoltIcon) },
    { name: "Drift", path: "/drift", icon: icon(PieChartIcon) },
    { name: "BOSS", icon: icon(PlugInIcon), subItems: [{ name: "Reports", path: "/boss/reports" }] },
    { name: "Collector", path: "/collector", icon: icon(TableIcon) },
    { name: "Operators", path: "/operators", icon: icon(GroupIcon) },
    { name: "Tenants", path: "/tenants", icon: icon(LockIcon) },
  ],
  support: [],
  others: [],
};
