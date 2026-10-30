"use client";

import { useState } from "react";
import Link from "next/link";
import type { SortKey, TreeRow } from "@/src/registry/view";
import { StatusDot } from "@/components/StatusUi";

export type SortLink = { key: SortKey; label: string; href: string; active: boolean; dir: "asc" | "desc" };

const th = "px-4 py-3 font-medium";
const reason = (f: { kind: string; subject: string; message: string }) => (f.kind === "owner" ? f.message : `${f.subject.replace("@tindevelopers/", "")}: ${f.message}`);
const td = "px-4 py-3 align-top";

function Chips({ red, amber }: { red: number; amber: number }) {
  if (!red && !amber) return <span className="text-gray-400">none</span>;
  return (
    <span className="inline-flex gap-1.5 text-xs font-medium">
      {red > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-500/15 dark:text-red-300">{red} red</span>}
      {amber > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{amber} amber</span>}
    </span>
  );
}

/** Rows arrive sorted and (optionally) nested by the server. Only the expand/collapse of a parent is client state. */
export default function ProjectsTable({ rows, sorts, nested }: { rows: TreeRow[]; sorts: SortLink[]; nested: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (slug: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(slug)) n.delete(slug);
    else n.add(slug);
    return n;
  });
  const parentOf = new Map<string, string>();
  let lastParent = "";
  for (const t of rows) { if (t.depth === 0) lastParent = t.row.slug; else parentOf.set(t.row.slug, lastParent); }
  const sort = (key: SortKey) => sorts.find((s) => s.key === key)!;

  const Head = ({ k }: { k: SortKey }) => {
    const s = sort(k);
    return (
      <th className={th} aria-sort={s.active ? (s.dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={s.href} className="inline-flex items-center gap-1 hover:underline">{s.label}{s.active && <span aria-hidden>{s.dir === "asc" ? "↑" : "↓"}</span>}</Link>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400">
          <tr><Head k="name" /><Head k="kind" /><Head k="client" /><Head k="owner" /><Head k="lifecycle" /><th className={th}>Findings</th><Head k="severity" /></tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(({ row: r, depth, childCount, childRed, childAmber }) => {
            if (depth === 1 && collapsed.has(parentOf.get(r.slug) ?? "")) return null;
            return (
              <tr key={r.slug} className={depth ? "bg-gray-50/50 dark:bg-white/[0.02]" : ""}>
                <td className={`${td} ${depth ? "pl-10" : ""}`}>
                  <div className="flex items-center gap-2">
                    {nested && childCount > 0 && (
                      <button type="button" onClick={() => toggle(r.slug)} aria-expanded={!collapsed.has(r.slug)} aria-label={`${collapsed.has(r.slug) ? "Expand" : "Collapse"} ${r.name}`} className="w-4 text-gray-500">
                        {collapsed.has(r.slug) ? "▸" : "▾"}
                      </button>
                    )}
                    <div>
                      <Link href={`/projects/${r.slug}`} className="font-medium underline">{r.name}</Link> <span className="text-gray-400">{r.slug}</span>
                      {nested && childCount > 0 && (
                        <div className="text-xs text-gray-500">
                          {childCount} hosted{childRed > 0 && <span className="text-red-600 dark:text-red-400"> · {childRed} failing</span>}{childAmber > 0 && <span className="text-amber-600 dark:text-amber-400"> · {childAmber} attention</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={td}>{r.kind}</td>
                <td className={td}>{r.client ?? "—"}</td>
                <td className={td}>
                  {r.ownerName ? <Link href={`/projects/${r.ownerProject}`} className="underline">{r.ownerName}</Link> : r.owners.length ? null : <span className="text-gray-400">—</span>}
                  {r.owners.length > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">{r.owners.join(", ")}</p>}
                </td>
                <td className={td}>{r.lifecycle}</td>
                <td className={td}>
                  <Chips red={r.red} amber={r.amber} />
                  {r.topFinding && <p className="mt-1 max-w-xs truncate text-xs text-gray-500 dark:text-gray-400" title={reason(r.topFinding)}>{reason(r.topFinding)}</p>}
                </td>
                <td className={td}>{r.colour ? <StatusDot colour={r.colour} /> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
