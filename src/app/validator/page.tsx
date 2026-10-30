import { redirect } from "next/navigation";

export default async function ValidatorPage({ searchParams }: { searchParams: Promise<{ error?: string; date?: string }> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  if (query.date) params.set("date", query.date);
  if (query.error) params.set("error", query.error);
  redirect(params.size ? `/review?${params.toString()}` : "/review");
}
