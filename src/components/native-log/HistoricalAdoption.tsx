import type { NativeSession, NativeRow } from "@/lib/native-log/server";
import { nativeColumns, readNativeContent } from "@/lib/native-log/server";
import { memberWriteBinding } from "@/lib/members/http";
import { ReadbackTable } from "./ReadbackTable";
import { SourceDraftButton } from "./SourceDraftButton";
export async function HistoricalAdoption({ session, policy, page = 0 }: { session: NativeSession; policy: string; page?: number }) {
  const result = await session.client.from("native_log_drafts").select(nativeColumns).eq("owner_id", session.user.id).eq("status", "submitted").eq("receipt->>kind", "unassessed").contains("receipt", { dates: ["2026-10-26"] }).order("created_at", { ascending: false }).order("id").range(page * 20, page * 20 + 19);
  const links = await session.client.from("cohort_source_links").select("source_id").eq("owner_id", session.user.id).eq("policy_id", policy).eq("kind", "adoption");
  if (result.error || links.error) return <p>Earlier private logs could not load. Your existing records remain unchanged.</p>;
  const adopted = new Set(links.data.map(row => row.source_id));
  const rows = (result.data as unknown as NativeRow[]).filter(row => !adopted.has(row.id) && row.receipt?.dayIndexVersion !== 1);
  if (!rows.length && result.data.length < 20) return null;
  return <details className="review-history-adoption"><summary>Earlier logs · 26 October</summary><p>These earlier logs are private and unassessed. Open one, check its table and confirm a new version to include eligible activities in this policy. Originals stay unchanged; work remains unassessed. Nothing is adopted automatically.</p>{rows.map(row => <article key={row.id}><ReadbackTable document={readNativeContent(row).document} /><SourceDraftButton action="adopt" sourceId={row.id} binding={memberWriteBinding(session.user.id)} /></article>)}{result.data.length === 20 ? <a href={`/review?historyPage=${page + 1}`}>More earlier logs</a> : null}</details>;
}
