/** Sequential, duplicate-safe retries. Existing successful parts are read back by hash. */
export class NativeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
export async function retryAudioPart<T>(
  send: () => Promise<T>,
  signal: AbortSignal,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    try {
      return await send();
    } catch (error) {
      const retryable =
        error instanceof NativeRequestError
          ? [408, 502, 503, 504].includes(error.status)
          : error instanceof TypeError ||
            (error instanceof DOMException && error.name === "TimeoutError");
      if (signal.aborted || !retryable || attempt >= 2) throw error;
      await pause(750 * (attempt + 1));
    }
  }
}

export async function audioRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 35000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !signal.aborted)
      throw new NativeRequestError(
        "The connection took too long. Your audio is kept here.",
        408,
        "NETWORK_TIMEOUT",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
