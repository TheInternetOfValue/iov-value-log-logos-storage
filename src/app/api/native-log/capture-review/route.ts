import { NextRequest } from "next/server";
import { z } from "zod";
import { nativeActionSchema } from "@/lib/native-log/schema";
import { reviewCapturedWords } from "@/lib/native-log/capture-storage";
import {
  nativeSession,
  nativeJson,
  nativeFailure,
  loadNative,
  readNativeContent,
  writeNative,
  nativeView,
} from "@/lib/native-log/server";
import { privateJson } from "@/lib/members/http";
const schema = nativeActionSchema
  .extend({
    captureKey: z.union([z.literal("initial"), z.uuid()]),
    useCapturedWords: z.literal(true).optional(),
    discardEmpty: z.literal(true).optional(),
  })
  .refine(
    (input) => Boolean(input.useCapturedWords) !== Boolean(input.discardEmpty),
  );
export async function POST(request: NextRequest) {
  try {
    const session = await nativeSession(request, true),
      parsed = schema.safeParse(await nativeJson(request));
    if (!parsed.success) throw new Error("INVALID_INPUT");
    const row = await loadNative(session, parsed.data.id);
    if (row.status !== "draft") throw new Error("NATIVE_DRAFT_CLOSED");
    if (row.revision !== parsed.data.revision)
      throw new Error("REVISION_CONFLICT");
    const previous = readNativeContent(row);
    const content = reviewCapturedWords(
      previous,
      parsed.data.captureKey,
      Boolean(parsed.data.discardEmpty),
    );
    if (content !== previous)
      await writeNative(session, row.id, row.revision, content);
    return privateJson(nativeView(await loadNative(session, row.id)));
  } catch (error) {
    return nativeFailure(error);
  }
}
