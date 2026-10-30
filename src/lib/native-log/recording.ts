import { peakDbfs } from "./silence";
import { MAX_CAPTURE_SECONDS } from "./capture-health";
export const MAX_RECORDING_SECONDS = MAX_CAPTURE_SECONDS;
export const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
export type RecordingSnapshot = {
  phase: "idle" | "requesting" | "recording" | "stopping" | "ready" | "error";
  elapsed: number;
  audio: Blob | null;
  message: string;
  elapsedMs?: number;
  stopReason?: "user" | "limit" | "interrupted" | "size";
};
type Recorder = Pick<
  MediaRecorder,
  | "state"
  | "mimeType"
  | "start"
  | "stop"
  | "ondataavailable"
  | "onstop"
  | "onerror"
  | "onpause"
>;
export type RecordingRuntime = {
  stream(): Promise<MediaStream>;
  recorder(stream: MediaStream): Recorder;
  now(): number;
  every(callback: () => void): ReturnType<typeof setInterval>;
  clear(timer: ReturnType<typeof setInterval>): void;
};
export type RecorderPersistence = { chunk(blob: Blob, index: number, elapsedMs: number): void; finished(snapshot: RecordingSnapshot): void };
export const browserRecordingRuntime: RecordingRuntime = {
  async stream() {
    if (
      !globalThis.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error(
        "Recording is not available in this browser. You can type your day instead.",
      );
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: { ideal: 1 } },
      video: false,
    });
  },
  recorder(stream) {
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    return mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  },
  now: () => Date.now(),
  every: (callback) => setInterval(callback, 250),
  clear: (timer) => clearInterval(timer),
};
export class NativeRecorder {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: Recorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private unlisten: (() => void)[] = [];
  private started = 0;
  private stoppedMs: number | null = null;
  private requestedStop: RecordingSnapshot["stopReason"];
  private finish: (() => void) | null = null;
  private snapshot: RecordingSnapshot = {
    phase: "idle",
    elapsed: 0,
    audio: null,
    message: "",
  };
  constructor(
    private changed: (state: RecordingSnapshot) => void,
    private runtime = browserRecordingRuntime,
    private persistence?: RecorderPersistence,
    private levels?: (peakDbfs: number) => void,
  ) {}
  /** Optional live level for the meter and silence warning. Recording never depends on it. */
  private monitorLevels(stream: MediaStream) {
    const Context = typeof window === "undefined" ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!this.levels || !Context) return;
    try {
      const context = new Context(), analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      void context.resume?.().catch(() => {});
      const samples = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        this.levels?.(peakDbfs(samples));
      }, 250);
      this.unlisten.push(() => {
        clearInterval(timer);
        void context.close().catch(() => {});
      });
    } catch {
      /* Metering is optional; capture continues without it. */
    }
  }
  private emit(changes: Partial<RecordingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    if (!this.disposed) this.changed(this.snapshot);
  }
  private release() {
    if (this.timer !== null) this.runtime.clear(this.timer);
    this.timer = null;
    for (const remove of this.unlisten) remove();
    this.unlisten = [];
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  async start() {
    if (
      this.disposed ||
      ["requesting", "recording", "stopping"].includes(this.snapshot.phase)
    )
      return;
    const generation = ++this.generation;
    this.requestedStop = undefined;
    this.stoppedMs = null;
    this.emit({
      phase: "requesting",
      elapsed: 0,
      elapsedMs: 0,
      stopReason: undefined,
      audio: null,
      message: "Allow microphone access when your browser asks.",
    });
    try {
      const stream = await this.runtime.stream();
      if (generation !== this.generation || this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.monitorLevels(stream);
      const recorder = this.runtime.recorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      this.started = this.runtime.now();
      const elapsedMs = () => Math.max(0, this.runtime.now() - this.started);
      recorder.ondataavailable = (event) => {
        if (generation !== this.generation || this.disposed || !event.data.size)
          return;
        // Keep the final blob too. A limit must never silently drop its tail.
        chunks.push(event.data);
        bytes += event.data.size;
        try { this.persistence?.chunk(event.data, chunks.length - 1, elapsedMs()); } catch { /* Device storage must never interrupt microphone capture. */ }
        if (bytes >= MAX_RECORDING_BYTES) this.stop("size");
      };
      recorder.onerror = () => {
        if (generation === this.generation && !this.disposed)
          this.stop("interrupted");
      };
      recorder.onpause = () => {
        if (generation === this.generation && !this.disposed)
          this.stop("interrupted");
      };
      let finalized = false;
      const finish = () => {
        if (finalized) return;
        finalized = true;
        if (generation !== this.generation || this.disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const duration = this.stoppedMs ?? elapsedMs();
        const reason = this.requestedStop ?? "interrupted";
        this.release();
        this.recorder = null;
        this.finish = null;
        const audio = chunks.length
          ? new Blob(chunks, {
              type: recorder.mimeType || chunks[0].type || "audio/webm",
            })
          : null;
        const warning =
          reason === "limit"
            ? "Recording stopped at ten minutes. You can speak again after checking this recording."
            : reason === "size"
              ? "Recording reached its size limit. Your captured audio is still here; check it before continuing."
              : reason === "interrupted"
                ? "Recording was interrupted. Your captured audio is still here; check it before continuing."
                : "";
        this.emit({
          phase: audio ? "ready" : "error",
          elapsed: Math.floor(duration / 1000),
          elapsedMs: Math.round(duration),
          stopReason: reason,
          audio,
          message: audio
            ? warning
            : "No audio was captured. Try recording again, or type your day.",
        });
        try { this.persistence?.finished(this.snapshot); } catch { /* Keep the captured in-memory audio. */ }
      };
      recorder.onstop = finish;
      this.finish = finish;
      for (const track of stream.getAudioTracks?.() ?? stream.getTracks()) {
        for (const event of ["ended", "mute"]) {
          const interrupted = () => {
            if (generation === this.generation && !this.disposed)
              this.stop("interrupted");
          };
          track.addEventListener?.(event, interrupted);
          this.unlisten.push(() =>
            track.removeEventListener?.(event, interrupted),
          );
        }
      }
      recorder.start(1000);
      this.emit({ phase: "recording", message: "" });
      this.timer = this.runtime.every(() => {
        this.emit({ elapsed: Math.floor(elapsedMs() / 1000) });
        if (elapsedMs() >= MAX_RECORDING_SECONDS * 1000) this.stop("limit");
      });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.release();
      this.recorder = null;
      const name =
        error && typeof error === "object" && "name" in error ? error.name : "";
      const message =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was not allowed. You can try again or type your day."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one, or type your day."
            : error instanceof Error &&
                error.message.startsWith("Recording is not available")
              ? error.message
              : "The microphone could not start. Try again, or type your day.";
      this.emit({ phase: "error", message });
    }
  }
  stop(reason: NonNullable<RecordingSnapshot["stopReason"]> = "user") {
    if (this.snapshot.phase === "requesting") {
      if (reason !== "user") return;
      this.generation++;
      this.emit({ phase: "idle", message: "Microphone request cancelled." });
      return;
    }
    if (!this.recorder || this.snapshot.phase === "stopping") return;
    this.requestedStop = reason;
    this.stoppedMs = Math.max(0, this.runtime.now() - this.started);
    this.emit({ phase: "stopping" });
    if (this.timer !== null) this.runtime.clear(this.timer);
    this.timer = null;
    // Wait for final dataavailable/onstop before releasing the microphone.
    try {
      if (this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      this.requestedStop = "interrupted";
      this.finish?.();
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {}
    }
    this.release();
    this.recorder = null;
    this.finish = null;
  }
}
