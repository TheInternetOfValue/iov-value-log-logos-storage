import type { CaptureManifest } from "./capture-health";
export const TRANSCRIPTION_CHUNK_SECONDS = 25;
export function pcmWave(
  channels: Float32Array[],
  sourceRate: number,
  start: number,
  end: number,
): Blob {
  const rate = 16000,
    length = Math.floor((end - start) * rate);
  if (!channels.length || sourceRate < 8000 || length < 1 || length > rate * 28)
    throw new Error("Choose a recording with audible speech.");
  const bytes = new ArrayBuffer(44 + length * 2),
    view = new DataView(bytes);
  const ascii = (offset: number, text: string) =>
    [...text].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  ascii(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, length * 2, true);
  for (let index = 0; index < length; index++) {
    const position = (start + index / rate) * sourceRate,
      floor = Math.floor(position),
      fraction = position - floor;
    const sample =
      channels.reduce(
        (sum, channel) =>
          sum +
          (channel[floor] ?? 0) * (1 - fraction) +
          (channel[floor + 1] ?? 0) * fraction,
        0,
      ) / channels.length;
    view.setInt16(
      44 + index * 2,
      Math.round(
        Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767),
      ),
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
export async function prepareRecording(
  audio: Blob,
  capture?: {
    elapsedMs?: number;
    stopReason?: "user" | "limit" | "interrupted" | "size";
  },
): Promise<{ chunks: Blob[]; manifest: CaptureManifest }> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await audio.arrayBuffer());
    if (Math.round(decoded.duration * 1000) < 1 || decoded.duration > 601)
      throw new Error("Record up to ten minutes at a time.");
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    const chunks: Blob[] = [];
    for (
      let start = 0;
      start < Math.round(decoded.duration * 1000) / 1000;
      start += TRANSCRIPTION_CHUNK_SECONDS
    )
      chunks.push(
        pcmWave(
          channels,
          decoded.sampleRate,
          start,
          Math.min(decoded.duration, start + TRANSCRIPTION_CHUNK_SECONDS),
        ),
      );
    return {
      chunks,
      manifest: {
        version: 1,
        elapsedMs: capture?.elapsedMs ?? null,
        decodedMs: Math.round(decoded.duration * 1000),
        stopReason: capture?.stopReason ?? "file",
        mimeType: audio.type.slice(0, 100),
      },
    };
  } finally {
    await context.close();
  }
}

export async function recordingChunks(audio: Blob) {
  return (await prepareRecording(audio)).chunks;
}
