import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "VoiceOps Control",
  description: "Browser-first BPO voice support control center.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const h = await headers();
  const isCustomerCall = h.get("x-is-customer-call") === "true";
  const skipAppShell = h.get("x-skip-app-shell") === "true";

  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        {isCustomerCall || skipAppShell ? children : <AppShell>{children}</AppShell>}
      </body>
    </html>
  );
}

