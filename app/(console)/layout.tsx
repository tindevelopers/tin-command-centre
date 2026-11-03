import ConsoleLayout from "@/components/ConsoleLayout";
import { currentSettings } from "@/src/tenancy/settings";

export default async function ConsoleRootLayout({ children }: { children: React.ReactNode }) {
  const settings = await currentSettings();
  return <ConsoleLayout settings={settings}>{children}</ConsoleLayout>;
}
