import { requireModule } from "@/src/tenancy/settings";

/** A tenant that has this module switched off (db/011) gets a 404 here. */
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await requireModule("boss");
  return children;
}
