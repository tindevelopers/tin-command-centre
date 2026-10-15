import React from "react";
import { GridIcon, BoxIcon, BoltIcon, TableIcon, ListIcon, PieChartIcon } from "@tindevelopers/ui-shell/icons";
import type { ShellNavItem } from "@tindevelopers/ui-shell";

const icon = (C: React.ComponentType) => React.createElement(C);

/** TIN Command Center navigation (spec C7). Consumers and keys arrives in phase 2 (T13). */
export const consoleNavigation: {
  main: ShellNavItem[];
  support: ShellNavItem[];
  others: ShellNavItem[];
} = {
  main: [
    { name: "Overview", path: "/", icon: icon(GridIcon) },
    { name: "Projects", path: "/projects", icon: icon(ListIcon) },
    { name: "Drift", path: "/drift", icon: icon(PieChartIcon) },
    { name: "Hubs and packages", path: "/packages", icon: icon(BoxIcon) },
    { name: "Cells", path: "/cells", icon: icon(BoltIcon) },
    { name: "Collector", path: "/collector", icon: icon(TableIcon) },
  ],
  support: [],
  others: [],
};
