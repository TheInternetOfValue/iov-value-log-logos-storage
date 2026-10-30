import { notFound } from "next/navigation";
import { LogosDayView } from "@/components/logos/LogosDayView";
import { logosDemoEnabled } from "@/lib/logos-demo";

export const dynamic = "force-dynamic";

export default async function LogosDemoPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  if (!logosDemoEnabled()) notFound();
  return <LogosDayView date={(await searchParams).date} basePath="/logos" showStorage />;
}
