// Local synthetic fixture only: generated tone, no microphone permission or provider.
import {
  NativeRecorder,
  browserRecordingRuntime,
} from "../src/lib/native-log/recording";
import { prepareRecording } from "../src/lib/native-log/audio";
const start = document.querySelector<HTMLButtonElement>("#start")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
const output = document.querySelector<HTMLPreElement>("#result")!;
let source: AudioContext | null = null;
const recorder = new NativeRecorder(
  (snapshot) => {
    output.textContent = JSON.stringify(
      {
        phase: snapshot.phase,
        elapsedMs: snapshot.elapsedMs,
        stopReason: snapshot.stopReason,
        bytes: snapshot.audio?.size ?? 0,
      },
      null,
      2,
    );
    if (snapshot.audio && snapshot.phase === "ready") {
      void prepareRecording(snapshot.audio, snapshot)
        .then(async (prepared) => {
          const diff = Math.abs(
            (prepared.manifest.elapsedMs ?? 0) - prepared.manifest.decodedMs,
          );
          output.textContent = JSON.stringify(
            {
              syntheticOnly: true,
              passed: diff < 3000 && prepared.chunks.length > 0,
              manifest: prepared.manifest,
              parts: prepared.chunks.length,
              bytes: snapshot.audio!.size,
            },
            null,
            2,
          );
          await source?.close();
          source = null;
        })
        .catch(() => {
          output.textContent =
            "Synthetic recording check failed during decoding.";
        });
    }
  },
  {
    ...browserRecordingRuntime,
    async stream() {
      source = new AudioContext();
      await source.resume();
      const tone = source.createOscillator(),
        gain = source.createGain(),
        destination = source.createMediaStreamDestination();
      tone.frequency.value = 440;
      gain.gain.value = 0.05;
      tone.connect(gain).connect(destination);
      tone.start();
      return destination.stream;
    },
  },
);
start.onclick = () => {
  start.disabled = true;
  stop.disabled = false;
  void recorder.start();
};
stop.onclick = () => {
  stop.disabled = true;
  recorder.stop();
};
