import Link from "next/link";
import type { NativeSession, NativeRow } from "@/lib/native-log/server";
import { nativeColumns, readNativeContent } from "@/lib/native-log/server";
import {
  captureContinuationIds,
  captureContinuationSlot,
} from "@/lib/native-log/capture";
import { ReadbackTable } from "./ReadbackTable";
import { ResumeCapture } from "./ResumeCapture";
import { memberWriteBinding } from "@/lib/members/http";
import "./native-log.css";
export async function PendingCaptureReview({
  session,
  page = 0,
  shared = false,
}: {
  session: NativeSession;
  page?: number;
  shared?: boolean;
}) {
  const result = await session.client
    .from("native_log_drafts")
    .select(nativeColumns)
    .eq("owner_id", session.user.id)
    .eq("status", "submitted")
    .eq("receipt->>kind", "capture_review_pending")
    .order("updated_at", { ascending: false })
    .range(page * 20, page * 20 + 20);
  if (result.error)
    return (
      <p role="status">
        Submitted conversations could not load. Your saved logs remain
        available.
      </p>
    );
  const visible = [];
  for (const row of (result.data ?? []).slice(
    0,
    20,
  ) as unknown as NativeRow[]) {
    if (shared && session.kind === "personal") {
      const indexed = await session.client.from("native_log_day_index").select("source_id").eq("owner_id", session.user.id).eq("native_draft_id", row.id).limit(1);
      if (!indexed.error && indexed.data?.length) continue;
    }
    const children = await session.client
      .from("native_log_drafts")
      .select("id,status")
      .eq("owner_id", session.user.id)
      .in("id", captureContinuationIds(row));
    if (children.error)
      return (
        <p role="status">Submitted conversations could not load. Try again.</p>
      );
    const slot = captureContinuationSlot(row, children.data ?? []);
    const child = slot?.row;
    if (child?.status === "submitted") continue;
    const content = readNativeContent(row);
    visible.push(
      <article className="native-pending-capture" key={row.id}>
        <h3>{content.document.date} · Submitted Value Log</h3>
        <p>
          Your log is submitted and saved. Assessment is pending; missing times,
          work context or effects have not been filled in or treated as neutral.
        </p>
        <details className="review-history-details"><summary>View activities</summary><ReadbackTable document={content.document} /></details>
        {child?.status === "draft" ? (
          <Link href={`/day?date=${content.document.date}&draft=${child.id}`}>
            Continue the conversation
          </Link>
        ) : slot ? (
          <ResumeCapture
            id={row.id}
            revision={row.revision}
            binding={memberWriteBinding(session.user.id)}
          />
        ) : (
          <p>
            This submitted conversation remains saved. Start a new conversation
            in Today to add more.
          </p>
        )}
      </article>,
    );
  }
  if (!visible.length && !page && (result.data?.length ?? 0) < 21) return null;
  return (
    <section className="native-log native-review-queue review-history">
      <h2>Submitted conversations</h2>
      {visible}
      <nav aria-label="Submitted conversation pages">
        {page ? (
          <Link href={`/review?capturePage=${page - 1}`}>
            Previous conversations
          </Link>
        ) : null}
        {(result.data?.length ?? 0) > 20 ? (
          <Link href={`/review?capturePage=${page + 1}`}>
            More conversations
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
