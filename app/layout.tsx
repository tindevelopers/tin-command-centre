import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SidebarProvider } from "@tindevelopers/ui-shell/context/SidebarContext";
import { ThemeProvider } from "@tindevelopers/ui-shell/context/ThemeContext";
import { quietSettings } from "@/src/tenancy/settings";
import { tabDescription, tabTitle } from "@/src/tenancy/settings-shared";

const outfit = localFont({
  src: "./fonts/outfit-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-outfit",
  display: "swap",
});

/** The tab title and description are the tenant's (src/tenancy/settings-shared.ts), so a white-labelled tenant never shows TIN. */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await quietSettings();
  return { title: tabTitle(settings), description: tabDescription(settings) };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${outfit.className} bg-white dark:bg-gray-900`} suppressHydrationWarning>
        <ThemeProvider>
          <SidebarProvider>{children}</SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
