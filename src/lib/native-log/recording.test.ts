import { describe, expect, it, vi } from "vitest";
import {
  NativeRecorder,
  MAX_RECORDING_SECONDS,
  type RecordingRuntime,
  type RecordingSnapshot,
} from "./recording";
function harness() {
  let elapsed = 0,
    tick = () => {};
  const track = Object.assign(new EventTarget(), { stop: vi.fn() }),
    stream = { getTracks: () => [track] } as unknown as MediaStream;
  const media: {
    state: string;
    mimeType: string;
    ondataavailable: MediaRecorder["ondataavailable"];
    onstop: MediaRecorder["onstop"];
    onerror: MediaRecorder["onerror"];
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    state: "inactive",
    mimeType: "audio/webm",
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start: vi.fn(() => {
      media.state = "recording";
    }),
    stop: vi.fn(() => {
      media.state = "inactive";
    }),
  };
  const states: RecordingSnapshot[] = [];
  const runtime: RecordingRuntime = {
    stream: vi.fn(async () => stream),
    recorder: () => media as unknown as MediaRecorder,
    now: () => elapsed,
    every: (cb) => {
      tick = cb;
      return 1 as never;
    },
    clear: vi.fn(),
  };
  const recorder = new NativeRecorder((s) => states.push(s), runtime);
  return {
    recorder,
    media,
    runtime,
    stream,
    track,
    states,
    advance: (n: number) => {
      elapsed = n * 1000;
      tick();
    },
    chunk: (data: Blob) =>
      media.ondataavailable?.call(
        media as unknown as MediaRecorder,
        { data } as BlobEvent,
      ),
    finish: () =>
      media.onstop?.call(media as unknown as MediaRecorder, {} as Event),
  };
}
describe("browser audio lifecycle", () => {
  it("keeps the final audio chunk and releases every microphone track on stop", async () => {
    const h = harness();
    await h.recorder.start();
    h.chunk(new Blob(["first"]));
    h.recorder.stop();
    expect(h.track.stop).not.toHaveBeenCalled();
    h.chunk(new Blob(["last"]));
    h.finish();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("ready");
    expect(await h.states.at(-1)!.audio!.text()).toBe("firstlast");
  });
  it("releases permission arriving after cancellation without starting a recorder", async () => {
    const h = harness();
    let resolve!: (s: MediaStream) => void;
    h.runtime.stream = () =>
      new Promise((r) => {
        resolve = r;
      });
    const start = h.recorder.start();
    h.recorder.stop();
    resolve(h.stream);
    await start;
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.media.start).not.toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("idle");
  });
  it("handles denied microphone access and disposal safely", async () => {
    const h = harness();
    h.runtime.stream = async () => {
      throw Object.assign(new Error("private device error"), {
        name: "NotAllowedError",
      });
    };
    await h.recorder.start();
    expect(h.states.at(-1)?.message).toContain("not allowed");
    expect(h.states.at(-1)?.message).not.toContain("private device");
    h.recorder.dispose();
  });
  it("stops at the ten minute limit and prevents duplicate recording starts", async () => {
    const h = harness();
    await h.recorder.start();
    await h.recorder.start();
    expect(h.runtime.stream).toHaveBeenCalledTimes(1);
    h.advance(MAX_RECORDING_SECONDS);
    expect(h.media.stop).toHaveBeenCalledTimes(1);
    expect(h.track.stop).not.toHaveBeenCalled();
    h.chunk(new Blob(["audio"]));
    h.finish();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.states.at(-1)?.stopReason).toBe("limit");
    expect(h.states.at(-1)?.elapsedMs).toBe(600000);
  });
  it("retains audio and a bounded reason when the microphone is muted or ends unexpectedly", async () => {
    for (const event of ["mute", "ended"]) {
      const h = harness();
      await h.recorder.start();
      h.advance(47);
      h.chunk(new Blob(["captured"]));
      h.track.dispatchEvent(new Event(event));
      h.chunk(new Blob(["final"]));
      h.finish();
      expect(await h.states.at(-1)!.audio!.text()).toBe("capturedfinal");
      expect(h.states.at(-1)?.stopReason).toBe("interrupted");
      expect(h.states.at(-1)?.elapsedMs).toBe(47000);
    }
  });
  it("does not label an unrequested recorder stop as an ordinary finish", async () => {
    const h = harness();
    await h.recorder.start();
    h.advance(25);
    h.chunk(new Blob(["captured"]));
    h.finish();
    expect(h.states.at(-1)?.stopReason).toBe("interrupted");
    expect(h.track.stop).toHaveBeenCalled();
  });
  it("keeps collected audio when the browser cannot finish normally", async () => {
    const h = harness();
    await h.recorder.start();
    h.chunk(new Blob(["kept audio"]));
    h.media.stop.mockImplementation(() => {
      throw new Error("synthetic stop failure");
    });
    h.recorder.stop();
    expect(h.states.at(-1)?.phase).toBe("ready");
    expect(h.states.at(-1)?.stopReason).toBe("interrupted");
    expect(await h.states.at(-1)!.audio!.text()).toBe("kept audio");
    expect(h.track.stop).toHaveBeenCalled();
    const count = h.states.length;
    h.finish();
    expect(h.states).toHaveLength(count);
  });
  it("invalidates old callbacks when disposed", async () => {
    const h = harness();
    await h.recorder.start();
    h.recorder.dispose();
    const count = h.states.length;
    h.chunk(new Blob(["late"]));
    h.finish();
    expect(h.states).toHaveLength(count);
    expect(h.track.stop).toHaveBeenCalled();
  });
});
