import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isConfigured } from "@/lib/env";
import { ReviewNavigation } from "@/components/ReviewNavigation";
import { PrimaryNav } from "@/components/PrimaryNav";
import { DeviceRecoveryExpiry } from "@/components/native-log/DeviceRecoveryExpiry";
import { NavigationFeedback } from "@/components/NavigationFeedback";
import { AccountMenu } from "@/components/AccountMenu";
import { Suspense } from "react";
import { publicOrigin } from "@/lib/public-discovery";

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: "Value Log",
  description: "Private activities connected to your Wellbeing Identity",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}><NavigationFeedback /></Suspense>
        <header className="site-header">
          <Link href="/day" className="brand">~ Value Log</Link>
          <Suspense fallback={<PrimaryNav reviewUnavailable />}><ReviewNavigation /></Suspense>
          <DeviceRecoveryExpiry />
          {isConfigured() ? <Suspense fallback={null}><AccountMenu /></Suspense> : null}
        </header>
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
