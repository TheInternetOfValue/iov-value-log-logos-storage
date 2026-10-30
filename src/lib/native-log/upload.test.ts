import { expect, it, vi } from "vitest";
import { retryAudioPart, NativeRequestError } from "./upload";
it("retries an unknown network result with the same operation and stops after bounded attempts", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockRejectedValueOnce(
      new NativeRequestError("upstream", 503, "PROVIDER_UNAVAILABLE"),
    )
    .mockResolvedValue({ revision: 3 });
  const pause = vi.fn(async () => {});
  expect(
    await retryAudioPart(send, new AbortController().signal, pause),
  ).toEqual({ revision: 3 });
  expect(send).toHaveBeenCalledTimes(3);
  const fail = vi.fn().mockRejectedValue(new TypeError("network"));
  await expect(
    retryAudioPart(fail, new AbortController().signal, pause),
  ).rejects.toThrow();
  expect(fail).toHaveBeenCalledTimes(3);
});
it("does not spend retries on authentication, conflicts, exhausted allowances or cancellation", async () => {
  for (const [status, code] of [
    [401, "UNAUTHORIZED"],
    [409, "REVISION_CONFLICT"],
    [429, "PROVIDER_ALLOWANCE"],
  ] as const) {
    const send = vi
      .fn()
      .mockRejectedValue(new NativeRequestError("safe error", status, code));
    await expect(
      retryAudioPart(send, new AbortController().signal),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  }
  const c = new AbortController();
  c.abort();
  const send = vi.fn();
  await expect(retryAudioPart(send, c.signal)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
