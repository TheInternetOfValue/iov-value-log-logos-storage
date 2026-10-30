"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_CAPTURE_SECONDS } from "@/lib/native-log/capture-health";
import {
  NativeRecorder,
  type RecordingSnapshot,
  type RecorderPersistence,
} from "@/lib/native-log/recording";
const idle: RecordingSnapshot = {
  phase: "idle",
  elapsed: 0,
  audio: null,
  message: "",
};
export function VoiceReply({
  onReply,
  disabled,
  onCaptureState,
  onStart,
  automatic = false,
  persistence,
}: {
  onReply: (audio: Blob, capture: RecordingSnapshot) => Promise<void>;
  disabled: boolean;
  onCaptureState?: (active: boolean, recording?: boolean) => void;
  onStart?: () => void;
  automatic?: boolean;
  persistence?: RecorderPersistence;
}) {
  const [state, setState] = useState<RecordingSnapshot>(idle),
    [failed, setFailed] = useState(false),
    [sending, setSending] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const audioUrlRef = useRef("");
  const updateState = useCallback((snapshot: RecordingSnapshot) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = snapshot.audio
      ? URL.createObjectURL(snapshot.audio)
      : "";
    setAudioUrl(audioUrlRef.current);
    setState(snapshot);
  }, []);
  const recorder = useRef<NativeRecorder | null>(null),
    attempted = useRef<Blob | null>(null),
    active = useRef(true),
    callback = useRef(onReply);
  const persistenceRef = useRef(persistence);
  useEffect(() => { persistenceRef.current = persistence; }, [persistence]);
  useEffect(() => {
    callback.current = onReply;
  }, [onReply]);
  useEffect(() => {
    active.current = true;
    recorder.current = new NativeRecorder((snapshot) => {
      onCaptureState?.(
        Boolean(snapshot.audio) ||
          ["requesting", "recording", "stopping"].includes(snapshot.phase),
        ["requesting", "recording", "stopping"].includes(snapshot.phase),
      );
      updateState(snapshot);
    }, undefined, { chunk: (blob, index, elapsedMs) => persistenceRef.current?.chunk(blob, index, elapsedMs), finished: snapshot => persistenceRef.current?.finished(snapshot) });
    const stop = () => recorder.current?.stop("interrupted");
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      active.current = false;
      recorder.current?.dispose();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
      onCaptureState?.(false);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [onCaptureState, updateState]);
  useEffect(() => {
    if (state.elapsed >= MAX_CAPTURE_SECONDS) recorder.current?.stop("limit");
  }, [state.elapsed]);
  async function send(audio: Blob) {
    attempted.current = audio;
    setSending(true);
    setFailed(false);
    try {
      await callback.current(audio, state);
      if (active.current) {
        updateState(idle);
        onCaptureState?.(false);
      }
    } catch {
      if (active.current) setFailed(true);
    } finally {
      if (active.current) setSending(false);
    }
  }
  useEffect(() => {
    if (
      automatic &&
      state.audio &&
      !disabled &&
      !sending &&
      attempted.current !== state.audio
    )
      void send(state.audio);
    // A blob is sent once automatically. A failed turn requires an intentional retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automatic, state.audio, disabled, sending]);
  const recording = ["recording", "requesting"].includes(state.phase);
  return (
    <div className="native-mic-zone">
      <button
        type="button"
        className={`native-mic ${recording ? "is-recording" : ""}`}
        disabled={
          !recording && (disabled || sending || state.phase === "stopping")
        }
        aria-label={
          recording
            ? "Finish voice message"
            : failed
              ? "Retry voice message"
              : "Correct or add by voice"
        }
        onClick={() => {
          if (recording) {
            recorder.current?.stop();
            return;
          }
          if (state.audio) {
            void send(state.audio);
            return;
          }
          onStart?.();
          setFailed(false);
          void recorder.current?.start();
        }}
      >
        <svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
          <rect
            x="23"
            y="7"
            width="18"
            height="31"
            rx="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M15 29v4a17 17 0 0 0 34 0v-4M32 50v9M23 59h18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
        <span>
          {recording
            ? `Finish · ${state.elapsed}s`
            : sending
              ? "Updating your log…"
              : failed
                ? "Retry voice message"
                : "Speak again"}
        </span>
      </button>
      <p className="meta">
        {recording
          ? "Listening. Tap the microphone when you’ve finished."
          : "Up to ten minutes each time. Speak again to correct the table or add more."}
      </p>
      {state.message ? <p role="status">{state.message}</p> : null}
      {failed ? (
        <>
          <p role="status">
            Your voice message is kept here. Tap to retry, or use the captured
            words after listening.
          </p>
          {audioUrl ? (
            <>
              <audio
                controls
                src={audioUrl}
                preload="none"
                aria-label="Listen to your voice message"
              />
              <a href={audioUrl} download="value-log-voice-message">
                Download this recording
              </a>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
