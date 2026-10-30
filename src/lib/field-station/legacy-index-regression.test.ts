import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { legacyNativeDayIndex } from "@/lib/members/native-day-index";
import { encryptNarrative } from "@/lib/crypto";
import {
  nativeOwnerScope,
  type NativeRow,
} from "@/lib/native-log/storage-core";
import { newNativeDraft, emptyNativeActivity } from "@/lib/native-log/draft";
import { accounts, fixtureId } from "./fixtures";
beforeEach(() => {
  vi.stubEnv(
    "NARRATIVE_ENCRYPTION_KEY_BASE64",
    Buffer.alloc(32, 3).toString("base64"),
  );
  vi.stubEnv(
    "AUDIT_DIGEST_KEY",
    "synthetic-backfill-key-longer-than-thirty-two",
  );
});
afterEach(() => vi.unstubAllEnvs());
function source(untimed = false) {
  const document = {
    ...newNativeDraft(
      nativeOwnerScope(accounts.brosA.owner),
      "2026-10-26",
      "Asia/Kolkata",
      "personal",
    ),
    transcript:
      "This prose mentions 8am; the backfill must not parse it into a clock.",
    activities: [
      {
        ...emptyNativeActivity(fixtureId(801)),
        activity: "Synthetic overnight sleep",
        startLocal: untimed ? "" : "2026-10-26T22:00",
        endLocal: untimed ? "" : "2026-10-27T06:00",
        sleepRest: true,
      },
    ],
  };
  const cipher = encryptNarrative(
    JSON.stringify({ document, parts: {}, totalParts: null }),
  );
  return {
    id: fixtureId(802),
    owner_id: accounts.brosA.owner,
    status: "submitted",
    revision: 2,
    content_ciphertext: cipher.ciphertext,
    content_iv: cipher.iv,
    content_auth_tag: cipher.authTag,
    content_digest: cipher.digest,
    created_at: "2026-10-26T00:00:00Z",
    updated_at: "2026-10-26T00:00:00Z",
    removed_at: null,
    receipt: {
      kind: "unassessed",
      ids: [fixtureId(803), fixtureId(804)],
      count: 2,
      dates: ["2026-10-26", "2026-10-27"],
      timezone: "Asia/Kolkata",
    },
  } as NativeRow;
}
it("U11/U12/U13: legacy typed overnight segments become one occurrence linked to both existing entries", () => {
  const row = source(),
    index = legacyNativeDayIndex(row);
  expect(index).toHaveLength(1);
  expect(index[0].memberEntryIds).toEqual(row.receipt!.ids);
  expect(index[0].start).toBe("2026-10-26T16:30:00.000Z");
  expect(index[0].end).toBe("2026-10-27T00:30:00.000Z");
});
it("U11: unknown typed times cannot be reconstructed from arbitrary note words", () => {
  expect(() => legacyNativeDayIndex(source(true))).toThrow(
    "LEGACY_INDEX_REVIEW_REQUIRED",
  );
});
it("U12/U19: mismatched legacy receipts are stopped, and new indexed approvals are not backfilled again", () => {
  const row = source();
  expect(() =>
    legacyNativeDayIndex({ ...row, receipt: { ...row.receipt!, count: 1 } }),
  ).toThrow("LEGACY_INDEX_REVIEW_REQUIRED");
  expect(
    legacyNativeDayIndex({
      ...row,
      receipt: { ...row.receipt!, dayIndexVersion: 1 },
    }),
  ).toEqual([]);
});
