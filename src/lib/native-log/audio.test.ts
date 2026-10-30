import { afterEach, expect, it, vi } from "vitest";
import { prepareRecording } from "./audio";
afterEach(() => vi.unstubAllGlobals());
it("preserves the complete ten-minute PCM recording, including its last sample, in 24 ordered WAV requests", async () => {
  const samples = new Float32Array(600 * 16000);
  samples[0] = 0.25;
  samples[samples.length - 1] = 0.75;
  const close = vi.fn();
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData() {
        return Promise.resolve({
          duration: 600,
          sampleRate: 16000,
          numberOfChannels: 1,
          getChannelData: () => samples,
        });
      }
      close = close;
    },
  );
  const result = await prepareRecording(
    new Blob(["synthetic encoded audio"], { type: "audio/webm" }),
    { elapsedMs: 600000, stopReason: "user" },
  );
  expect(result.chunks).toHaveLength(24);
  let bytes = 0;
  for (const chunk of result.chunks) {
    const buffer = Buffer.from(await chunk.arrayBuffer());
    expect(buffer.readUInt32LE(24)).toBe(16000);
    expect(buffer.readUInt32LE(40)).toBe(800000);
    bytes += buffer.length - 44;
  }
  const last = Buffer.from(await result.chunks.at(-1)!.arrayBuffer());
  expect(last.readInt16LE(last.length - 2)).toBeGreaterThan(24000);
  expect(bytes).toBe(600 * 32000);
  expect(close).toHaveBeenCalledTimes(1);
  expect(result.manifest.decodedMs).toBe(600000);
});
it("keeps a large elapsed/decoded mismatch visible in the manifest, rather than inventing audio", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData() {
        return Promise.resolve({
          duration: 125,
          sampleRate: 16000,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(125 * 16000),
        });
      }
      close = close;
    },
  );
  const result = await prepareRecording(new Blob(["synthetic"]), {
    elapsedMs: 600000,
    stopReason: "interrupted",
  });
  expect(result.chunks).toHaveLength(5);
  expect(result.manifest).toMatchObject({
    elapsedMs: 600000,
    decodedMs: 125000,
    stopReason: "interrupted",
  });
});
