"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterField =
  | { kind: "search"; name: string; label: string; value: string; placeholder?: string }
  | { kind: "select"; name: string; label: string; value: string; options: { value: string; label: string }[] };

const control = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white";

/**
 * Filters live in the URL (so a view can be bookmarked or shared) and the page re-renders on the server.
 * Changing a dropdown applies immediately; typing in search applies after a short pause. Other parameters
 * (sort, view) are kept.
 */
export default function FilterBar({ fields, shown, total, noun }: { fields: FilterField[]; shown: number; total: number; noun: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("error");
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const active = fields.filter((f) => f.value);
  const clear = () => apply(Object.fromEntries(fields.map((f) => [f.name, ""])));

  return (
    <div className="mb-4">
      <div role="search" className="flex flex-wrap items-end gap-3">
        {fields.map((f) =>
          f.kind === "search" ? (
            <label key={f.name} className="text-sm">
              <span className="sr-only">{f.label}</span>
              <input
                key={f.value}
                type="search"
                name={f.name}
                autoComplete="off"
                defaultValue={f.value}
                placeholder={f.placeholder ?? f.label}
                className={`${control} w-56`}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => apply({ [f.name]: v.trim() }), 350);
                }}
              />
            </label>
          ) : (
            <label key={f.name} className="text-sm text-gray-600 dark:text-gray-300">
              <span className="mb-1 block text-xs">{f.label}</span>
              <select name={f.name} autoComplete="off" value={f.value} className={control} onChange={(e) => apply({ [f.name]: e.currentTarget.value })}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ),
        )}
        {active.length > 0 && <button type="button" onClick={clear} className="pb-1.5 text-sm underline">Clear filters</button>}
      </div>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400" aria-live="polite">Showing {shown} of {total} {noun}</p>
    </div>
  );
}
