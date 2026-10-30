"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NativeRecorder,
  type RecordingSnapshot,
} from "@/lib/native-log/recording";
import { prepareRecording } from "@/lib/native-log/audio";
import {
  captureBlocks,
  captureMessage,
  type CaptureStatus,
  type CaptureManifest,
} from "@/lib/native-log/capture-health";
import {
  audioRequest,
  retryAudioPart,
  NativeRequestError,
} from "@/lib/native-log/upload";
import {
  hasUnsavedNativeContent,
  changeDraft,
  newNativeDraft,
  canSubmitCapture,
  captureQuestions,
  activityInstants,
  type NativeDraft,
} from "@/lib/native-log/draft";
import { reconcileNarrativeTimes } from "@/lib/native-log/chronology";
import { ReadbackTable } from "./ReadbackTable";
import { submissionState } from "./submission-state";
import type { NativeReceipt } from "@/lib/native-log/server";
import { NativeExport } from "./NativeExport";
import { pollNativeProposal, NativePollError } from "@/lib/native-log/poll";
import { VoiceReply } from "./VoiceReply";
import {
  DeviceVoiceRecovery,
  availableDeviceTurns,
  recoverDeviceTurn,
  clearDeviceDraft,
} from "@/lib/native-log/recovery-client";
import {
  listRecoveryChunks,
  type RecoveryChunk,
} from "@/lib/native-log/device-recovery";
import "./native-log.css";
import { SilenceWatch } from "@/lib/native-log/silence";
import { CheckScreen, DoneScreen, Dock, FailedScreen, Mic, ProcessingScreen, RecordingScreen, Retry, Shell, StartScreen, Stop } from "./flow/FlowView";
import { doneSummary, failureFrom, flowScreen, longDate, missingTimes, plural, speechLength, spokenTimeText, type Failure } from "./flow/flow-model";

type Step = "record" | "words" | "activities" | "clarify" | "review" | "done";
type DraftView = {
  id: string;
  revision: number;
  status?: string;
  document: NativeDraft;
  receipt?: NativeReceipt | null;
  processingUntil?: string | null;
  processingError?: string | null;
  /** Proposed rows the server left out because they could not be matched to the person's words. */
  unmatchedRows?: number;
  captures?: CaptureStatus[];
  recording?: { id: string; manifest?: CaptureManifest };
  transcription?: { done: number; total: number | null };
};
type DraftSummary = {
  id: string;
  revision: number;
  status: string;
  date: string;
  count: number;
  updatedAt: string;
};
type Props = {
  ownerScope: string;
  mode: NativeDraft["mode"];
  date: string;
  today: string;
  timezone: string;
  binding: string;
  writing: boolean;
  processing: boolean;
  initial: DraftView | null;
  savedDrafts: DraftSummary[];
  embedded?: boolean;
  cohort?: NativeDraft["cohort"];
  confirming?: boolean;
  cohortBoundary?: string;
  deviceRecovery?: boolean;
  /** Approved logs, including untimed notes, are placed on the member's own day. */
  sharedDay?: boolean;
};
const initialRecording: RecordingSnapshot = {
  phase: "idle",
  elapsed: 0,
  audio: null,
  message: "",
};
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const consentText =
  "This summary accurately represents what happened, and I want to confirm this log.";
const processingMessage = (code?: string | null) =>
  code === "COVERAGE_CHECK_STALE"
    ? "Your saved table needs a fresh completeness check. Tap “Try preparing again”; your saved words will be reused."
    : code === "OMISSION_REVIEW_REQUIRED"
    ? "Some narrated activities may be missing from this table. Your words are saved. Process them again or add what’s missing before submitting."
    : code === "PROVIDER_ALLOWANCE"
      ? "Today's processing allowance is used. Your writing is saved; return later to finish."
      : "Activities could not be prepared. Your words are saved; try again.";
const savedWordsLabel = (document: NativeDraft) =>
  document.correctsRecordId
    ? "Correction saved · not submitted"
    : "Draft saved · not submitted";

export function NativeLog(props: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<NativeDraft>(() => {
    const document =
      props.initial?.document ??
      newNativeDraft(props.ownerScope, props.date, props.timezone, props.mode);
    return reconcileNarrativeTimes({
      ...document,
      cohort: props.cohort,
      revision:
        document.revision +
        (props.initial &&
        JSON.stringify(document.cohort) !== JSON.stringify(props.cohort)
          ? 1
          : 0),
    });
  });
  const [id, setId] = useState(props.initial?.id ?? "");
  const [step, setStep] = useState<Step>(
    props.initial?.receipt
      ? "done"
      : props.initial?.document.activities.length
        ? "activities"
        : props.initial
          ? "words"
          : "record",
  );
  const [receipt, setReceipt] = useState<NativeReceipt | null>(
    props.initial?.receipt ?? null,
  );
  const [processingIssue, setProcessingIssue] = useState(
    props.initial?.processingError ?? null,
  );
  const [captures, setCaptures] = useState<CaptureStatus[]>(
    props.initial?.captures ?? [],
  );
  const capturesRef = useRef(captures);
  const knownManifest = useRef(props.initial?.recording?.manifest);
  const preparedAudio = useRef<{
    audio: Blob;
    chunks: Blob[];
    manifest: CaptureManifest;
  } | null>(null);
  const blockedCapture = captures.find(captureBlocks);
  const [savedDrafts, setSavedDrafts] = useState(props.savedDrafts);
  const [recording, setRecordingState] = useState(initialRecording),
    [audioUrl, setAudioUrl] = useState("");
  const [hasCloudDraft, setHasCloudDraft] = useState(Boolean(props.initial));
  const [busy, setBusy] = useState(() =>
      Boolean(props.initial?.processingUntil),
    ),
    [message, setMessage] = useState(
      props.initial?.processingError
        ? processingMessage(props.initial.processingError)
        : "",
    ),
    [saveStatus, setSaveStatus] = useState(
      props.initial?.receipt
        ? "Submitted"
        : props.initial
        ? savedWordsLabel(props.initial.document)
        : "Only in this tab",
    );
  const [storageConsent, setStorageConsent] = useState(Boolean(props.initial)),
    [providerConsent, setProviderConsent] = useState(false),
    [needsSignin, setNeedsSignin] = useState(false);
  const [answer, setAnswer] = useState("");
  const autoAudio = useRef<Blob | null>(null),
    replyIds = useRef(new WeakMap<Blob, string>());
  const providerRef = useRef(false);
  function allowProcessing() {
    providerRef.current = true;
    setStoragePermission(true);
    setProviderConsent(true);
  }
  const draftRef = useRef(draft),
    idRef = useRef(id),
    cloudRevision = useRef(props.initial?.revision ?? 0),
    savedLocalRevision = useRef(props.initial?.document.revision ?? -1);
  const storageRef = useRef(storageConsent),
    receiptRef = useRef(receipt),
    active = useRef(true);
  const setStoragePermission = useCallback((value: boolean) => {
    storageRef.current = value;
    setStorageConsent(value);
  }, []);
  const saveChain = useRef<Promise<void>>(Promise.resolve()),
    request = useRef<AbortController | null>(null),
    recorder = useRef<NativeRecorder | null>(null),
    recordingId = useRef(props.initial?.recording?.id ?? "");
  const heading = useRef<HTMLHeadingElement>(null);
  const mainRecovery = useRef<DeviceVoiceRecovery | null>(null),
    replyRecovery = useRef<DeviceVoiceRecovery | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(""),
    [deviceTurns, setDeviceTurns] = useState<RecoveryChunk[]>([]);
  const recoveredPrepared = useRef<{
    chunks: Blob[];
    manifest: CaptureManifest;
  } | null>(null);
  const audioRef = useRef<Blob | null>(null),
    urlRef = useRef("");
  const answerUnsent = useRef(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceReset, setVoiceReset] = useState(0);
  // Multi-screen flow for members. The pilot keeps the existing single screen.
  const flow = props.mode === "personal";
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState<{ phase: "sending" | "table"; part: number; total: number }>({ phase: "sending", part: 0, total: 0 });
  const [level, setLevel] = useState<number | null>(null);
  const [silent, setSilent] = useState(false);
  const silence = useRef<SilenceWatch | null>(null);
  // The one open typed change on the check screen: an activity id, "new", or none. Its words live in `answer`.
  const [fixTarget, setFixTarget] = useState<string | null>(null);
  const [fixError, setFixError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [unmatchedRows, setUnmatchedRows] = useState(props.initial?.unmatchedRows ?? 0);
  const [unmatchedDismissed, setUnmatchedDismissed] = useState(false);
  const structureError = useRef("");
  const [flowNotice, setFlowNotice] = useState("");
  const [changedId, setChangedId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(true);
  const onLevel = useCallback((peak: number) => {
    setLevel(peak);
    const watch = silence.current;
    if (!watch) return;
    const state = watch.observe(peak, Date.now());
    if (state.changed) setSilent(state.silent);
  }, []);
  function listen() {
    silence.current = new SilenceWatch(Date.now());
    setSilent(false);
    setLevel(null);
  }
  const mainCapture = useRef(false),
    replyCapture = useRef(false);
  const trackReplyCapture = useCallback(
    (value: boolean, isRecording = false) => {
      replyCapture.current = value;
      setVoiceActive(value);
      setVoiceRecording(isRecording);
    },
    [],
  );
  const setRecording = useCallback((state: RecordingSnapshot) => {
    mainCapture.current = ["requesting", "recording", "stopping"].includes(
      state.phase,
    );
    if (audioRef.current !== state.audio) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current = state.audio;
      urlRef.current = state.audio ? URL.createObjectURL(state.audio) : "";
      setAudioUrl(urlRef.current);
    }
    setRecordingState(state);
  }, []);
  const headers = {
    "content-type": "application/json",
    "x-value-log-session": props.binding,
  };
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    receiptRef.current = receipt;
  }, [receipt]);
  useEffect(() => {
    active.current = true;
    recorder.current = new NativeRecorder(
      (state) => {
        if (active.current) setRecording(state);
      },
      undefined,
      {
        chunk: (blob, index, elapsedMs) => {
          void mainRecovery.current?.raw(blob, index, elapsedMs);
        },
        finished: (snapshot) => {
          void mainRecovery.current?.finish(snapshot);
        },
      },
      onLevel,
    );
    const stop = () => recorder.current?.stop("interrupted");
    const hidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      active.current = false;
      request.current?.abort();
      recorder.current?.dispose();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [setRecording, onLevel]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!props.deviceRecovery) return;
    let cancelled = false;
    void availableDeviceTurns(props.ownerScope)
      .then((turns) => {
        if (!cancelled) setDeviceTurns(turns);
      })
      .catch(() => {
        if (!cancelled)
          setRecoveryNotice(
            "Device recovery is unavailable in this browser. Keep this tab open while logging.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [props.deviceRecovery, props.ownerScope]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [step]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (
        !receiptRef.current &&
        hasUnsavedNativeContent(
          draftRef.current,
          savedLocalRevision.current,
          Boolean(audioRef.current) ||
            mainCapture.current ||
            replyCapture.current ||
            answerUnsent.current,
        )
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("a[href]") ||
        receiptRef.current
      )
        return;
      const link = event.target.closest("a[href]") as HTMLAnchorElement;
      if (
        link.hasAttribute("download") ||
        link.target === "_blank" ||
        link.href.startsWith("blob:")
      )
        return;
      if (
        hasUnsavedNativeContent(
          draftRef.current,
          savedLocalRevision.current,
          Boolean(audioRef.current) ||
            mainCapture.current ||
            replyCapture.current ||
            answerUnsent.current,
        ) &&
        !window.confirm(
          "Leave this log? Unsaved writing and the recording stay only in this tab. Download them or save your draft before leaving.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, []);
  function downloadDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draftRef.current, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `value-log-draft-${draftRef.current.date}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function mayReplace() {
    if (
      busy ||
      ["requesting", "recording", "stopping"].includes(recording.phase)
    ) {
      setMessage("Finish recording or processing before opening another log.");
      return false;
    }
    return (
      Boolean(receipt) ||
      !hasUnsavedNativeContent(
        draftRef.current,
        savedLocalRevision.current,
        Boolean(audioRef.current) ||
          mainCapture.current ||
          replyCapture.current ||
          answerUnsent.current,
      ) ||
      window.confirm(
        "Open another log? Download this recording and any unsaved writing first. Only saved writing will remain in your account.",
      )
    );
  }
  function edit(change: (current: NativeDraft) => NativeDraft) {
    const next = change(draftRef.current);
    draftRef.current = next;
    setDraft(next);

    setSaveStatus(storageRef.current ? "Waiting to save…" : "Only in this tab");
  }
  async function responseJson(response: Response) {
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      if ([401, 403].includes(response.status)) setNeedsSignin(true);
      throw new NativeRequestError(
        body?.error ||
          "Value Log could not finish. Your writing is still here.",
        response.status,
        body?.code ?? "UNAVAILABLE",
      );
    }
    return body;
  }
  const flushSave = useCallback(async () => {
    const work = saveChain.current
      .catch(() => {})
      .then(async () => {
        if (!storageRef.current || receiptRef.current) return;
        const document = draftRef.current;
        if (
          cloudRevision.current > 0 &&
          savedLocalRevision.current === document.revision
        )
          return;
        if (!props.writing)
          throw new Error(
            "Saving is temporarily paused. Your writing is still here.",
          );
        setSaveStatus("Saving privately…");
        const draftId = idRef.current || crypto.randomUUID();
        idRef.current = draftId;
        setId(draftId);
        const response = await fetch("/api/native-log/drafts", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-value-log-session": props.binding,
          },
          body: JSON.stringify({
            id: draftId,
            revision: cloudRevision.current,
            document,
            consent: true,
          }),
          // A request that never answers would otherwise hold the working screen forever.
          signal: AbortSignal.timeout(20000),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body) {
          if ([401, 403].includes(response.status)) setNeedsSignin(true);
          throw new Error(
            body?.error || "Could not save. Your writing is still here.",
          );
        }
        cloudRevision.current = body.revision;
        savedLocalRevision.current = document.revision;
        setHasCloudDraft(true);
        setSaveStatus(
          draftRef.current.revision === document.revision
            ? savedWordsLabel(document)
            : "Waiting to save…",
        );
        setSavedDrafts((current) => [
          {
            id: draftId,
            revision: body.revision,
            status: "draft",
            date: document.date,
            count: document.activities.length,
            updatedAt: new Date().toISOString(),
          },
          ...current.filter((item) => item.id !== draftId),
        ]);
        history.replaceState(
          null,
          "",
          props.embedded
            ? `/day?date=${props.date}&draft=${draftId}`
            : `/log?draft=${draftId}`,
        );
      });
    saveChain.current = work;
    try {
      await work;
    } catch (error) {
      setSaveStatus("Not saved — writing kept here");
      throw error;
    }
  }, [
    props.binding,
    props.writing,
    props.embedded,
    props.date,
  ]);
  useEffect(() => {
    if (
      !storageConsent ||
      receipt ||
      busy ||
      draft.revision === savedLocalRevision.current
    )
      return;
    const timer = setTimeout(() => {
      void flushSave().catch((error) => setMessage(error.message));
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, storageConsent, receipt, busy, flushSave]);
  const applyView = useCallback(
    (view: DraftView) => {
      setProcessingIssue(view.processingError ?? null);
      setUnmatchedRows((current) => {
        const next = view.unmatchedRows ?? 0;
        if (next !== current) setUnmatchedDismissed(false);
        return next;
      });
      cloudRevision.current = view.revision;
      savedLocalRevision.current = view.document.revision;
      draftRef.current = view.document;
      setDraft(view.document);
      capturesRef.current = view.captures ?? [];
      setCaptures(capturesRef.current);
      if (view.recording) {
        recordingId.current = view.recording.id;
        knownManifest.current = view.recording.manifest;
      }

      setSaveStatus(view.receipt ? "Submitted" : savedWordsLabel(view.document));
      setHasCloudDraft(true);
    },
    [],
  );
  useEffect(() => {
    const initial = props.initial;
    if (!initial?.processingUntil) return;
    const controller = new AbortController();
    request.current = controller;
    void pollNativeProposal<DraftView>({
      id: initial.id,
      revision: initial.revision,
      binding: props.binding,
      signal: controller.signal,
    })
      .then((view) => {
        if (controller.signal.aborted) return;
        applyView(view);
        if (view.processingError) {
          setMessage(processingMessage(view.processingError));
          return;
        }
        setStep("activities");
        setMessage("Your proposed activities are ready to check.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (
            error instanceof NativePollError &&
            [401, 403].includes(error.status)
          )
            setNeedsSignin(true);
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (active.current) setBusy(false);
      });
    return () => controller.abort();
  }, [props.initial, props.binding, applyView]);
  async function saveNow() {
    try {
      await flushSave();
      setMessage("Draft saved to your account.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    }
  }
  function startDeviceRecovery(kind: "initial" | "reply") {
    if (!props.deviceRecovery) return;
    const draftId = idRef.current || crypto.randomUUID();
    idRef.current = draftId;
    setId(draftId);
    const turnId =
      kind === "initial"
        ? (recordingId.current ||= crypto.randomUUID())
        : crypto.randomUUID();
    const capture = new DeviceVoiceRecovery(
      { ownerScope: props.ownerScope, draftId, turnId },
      kind,
      cloudRevision.current,
      props.binding,
      flushSave,
      setRecoveryNotice,
    );
    if (kind === "initial") mainRecovery.current = capture;
    else replyRecovery.current = capture;
  }
  async function resumeDeviceTurn(turn: RecoveryChunk) {
    if (!mayReplace()) return;
    try {
      await openDraft(turn.draftId);
      if (idRef.current !== turn.draftId || receiptRef.current) {
        if (receiptRef.current)
          await clearDeviceDraft(props.ownerScope, turn.draftId);
        return;
      }
      const rows = (
        await listRecoveryChunks({
          ownerScope: props.ownerScope,
          draftId: turn.draftId,
        })
      ).filter((row) => row.turnId === turn.turnId);
      const recovered = await recoverDeviceTurn(rows, props.binding);
      if (recovered.turnKind === "initial") {
        recordingId.current = turn.turnId;
        if (recovered.chunks && recovered.manifest) {
          recoveredPrepared.current = {
            chunks: recovered.chunks,
            manifest: recovered.manifest,
          };
          await transcribe();
        } else if (recovered.snapshot) setRecording(recovered.snapshot);
      } else {
        const prepared =
          recovered.chunks && recovered.manifest
            ? { chunks: recovered.chunks, manifest: recovered.manifest }
            : await prepareRecording(recovered.audio!, recovered.snapshot!);
        setBusy(true);
        const controller = new AbortController();
        request.current = controller;
        for (const [index, chunk] of prepared.chunks.entries())
          await uploadPart(
            "/api/native-log/reply",
            {
              id: turn.draftId,
              activityId: "",
              replyId: turn.turnId,
              index: String(index),
              total: String(prepared.chunks.length),
              consent: "true",
              capture: JSON.stringify(prepared.manifest),
            },
            chunk,
            turn.turnId,
            index,
            controller.signal,
          );
        await structure(true);
      }
    } catch {
      setMessage(
        "This recording could not resume. Return to its original account before expiry, or use the words already saved in your draft.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function uploadPart(
    url: string,
    fields: Record<string, string>,
    audio: Blob,
    captureKey: string,
    index: number,
    signal: AbortSignal,
  ) {
    const send = async (retryEmpty: boolean) =>
      retryAudioPart(async () => {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        form.set("revision", String(cloudRevision.current));
        form.set("retryEmpty", String(retryEmpty));
        form.set("audio", audio, "recording.wav");
        const body = await responseJson(
          await audioRequest(
            url,
            {
              method: "POST",
              headers: { "x-value-log-session": props.binding },
              body: form,
            },
            signal,
          ),
        );
        if (!signal.aborted) applyView(body);
        return body as DraftView;
      }, signal);
    let view = await send(false);
    const empty = view.captures
      ?.find((capture) => capture.key === captureKey)
      ?.emptyParts.includes(index);
    // Retry a non-silent empty response once. Successful parts never pay twice.
    if (
      empty &&
      !signal.aborted &&
      new Uint8Array(await audio.arrayBuffer())
        .subarray(44)
        .some((byte) => byte !== 0)
    )
      view = await send(true);
    return view;
  }
  async function transcribe() {
    if (
      (!recording.audio && !recoveredPrepared.current) ||
      !providerRef.current ||
      !storageRef.current
    ) {
      setMessage("Use the microphone or send your words to start processing.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure(null);
    setMessage("Preparing your recording…");
    let sending = 0, parts = 0;
    try {
      await flushSave();
      if (controller.signal.aborted) return;
      if (
        !recoveredPrepared.current &&
        preparedAudio.current?.audio !== recording.audio
      ) {
        const prepared = await prepareRecording(recording.audio!, recording);
        preparedAudio.current = { audio: recording.audio!, ...prepared };
      }
      const { chunks, manifest: preparedManifest } =
        recoveredPrepared.current ?? preparedAudio.current!;
      const manifest = knownManifest.current ?? preparedManifest;
      recordingId.current ||= crypto.randomUUID();
      if (!recoveredPrepared.current)
        await mainRecovery.current?.prepared(chunks, manifest);
      parts = chunks.length;
      for (const [index, audio] of chunks.entries()) {
        if (controller.signal.aborted) return;
        sending = index;
        setProgress({ phase: "sending", part: index, total: chunks.length });
        setMessage(
          `Listening to your recording… ${Math.round((index / chunks.length) * 100)}%`,
        );
        await uploadPart(
          "/api/native-log/transcribe",
          {
            id: idRef.current,
            recordingId: recordingId.current,
            index: String(index),
            total: String(chunks.length),
            consent: "true",
            capture: JSON.stringify(manifest),
          },
          audio,
          "initial",
          index,
          controller.signal,
        );
        await mainRecovery.current?.uploaded(
          index,
          audio,
          chunks.length,
          manifest,
        );
      }
      if (controller.signal.aborted) return;
      const blocked = capturesRef.current.find(
        captureBlocks,
      );
      if (blocked) {
        setMessage(captureMessage(blocked));
        setStep("words");
        return;
      }
      if (draftRef.current.transcript.trim()) {
        recoveredPrepared.current = null;
        await structure(true);
      } else {
        setStep("words");
        setFailure({ kind: "no_words", stage: "sending" });
        setMessage("No speech was found. You can listen back or record again.");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure({ ...failureFrom(error, "sending", navigator.onLine), ...(parts ? { part: { failed: sending + 1, total: parts } } : {}) });
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not transcribe. Your recording is still here.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function acceptCapturedWords(key: string, discardEmpty = false) {
    if (busy || mainCapture.current || voiceRecording || answerUnsent.current)
      return;
    allowProcessing();
    setBusy(true);
    try {
      await flushSave();
      const body = await responseJson(
        await fetch("/api/native-log/capture-review", {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: idRef.current,
            revision: cloudRevision.current,
            consent: true,
            captureKey: key,
            ...(discardEmpty
              ? { discardEmpty: true }
              : { useCapturedWords: true }),
          }),
        }),
      );
      applyView(body);
      if (discardEmpty) {
        setVoiceReset((value) => value + 1);
        setMessage(
          "Empty voice message discarded. Your previous log is unchanged; speak again when ready.",
        );
      } else if (
        !capturesRef.current.some(captureBlocks)
      )
        await structure(true);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function structure(followUp = false): Promise<boolean> {
    const blocked = capturesRef.current.find(
      captureBlocks,
    );
    if (blocked) {
      setMessage(captureMessage(blocked));
      return false;
    }
    if (!providerRef.current || !storageRef.current) {
      setMessage("Use the microphone or send your words to start processing.");
      return false;
    }
    if (
      !followUp &&
      draftRef.current.activities.length &&
      !window.confirm(
        "Create new proposals? This replaces the activities in this draft. Download a copy first if you want to keep your edits.",
      )
    )
      return false;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure(null);
    structureError.current = "";
    setProgress((current) => ({ ...current, phase: "table" }));
    setMessage("Preparing proposed activities from your words…");
    try {
      await flushSave();
      if (controller.signal.aborted) return false;
      // This only queues the background job, so it should answer within seconds. If it
      // doesn't, or the phone wakes this tab mid-request, stop trusting the request and ask
      // the draft directly: polling either finds the job running or reports that it stopped.
      const resumed = new AbortController();
      const onVisible = () => {
        if (document.visibilityState === "visible")
          resumed.abort(new DOMException("Tab resumed", "TimeoutError"));
      };
      document.addEventListener("visibilitychange", onVisible);
      let queued: Awaited<ReturnType<typeof responseJson>>, uncertain = false;
      try {
        queued = await responseJson(
          await fetch("/api/native-log/structure", {
            method: "POST",
            headers,
            body: JSON.stringify({
              id: idRef.current,
              revision: cloudRevision.current,
              consent: true,
            }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000), resumed.signal]),
          }),
        );
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: unknown })?.name !== "TimeoutError") throw error;
        queued = { processing: true };
        uncertain = true;
      } finally {
        document.removeEventListener("visibilitychange", onVisible);
      }
      setMessage(
        "Preparing activities… Your words are saved, and you can return to this draft.",
      );
      const body = queued.processing
        ? await pollNativeProposal<DraftView>({
            id: idRef.current,
            revision: cloudRevision.current,
            binding: props.binding,
            signal: controller.signal,
            // The request may still reach the server; give its job time to claim the draft.
            ...(uncertain ? { claimGraceMs: 15000 } : {}),
          })
        : queued;
      if (!controller.signal.aborted) {
        applyView(body);
        if (body.processingError)
          throw new NativeRequestError(processingMessage(body.processingError), 503, body.processingError);
        setStep(body.document.activities.length ? "review" : "words");
        setAnswer("");
        setMessage(
          body.document.activities.length
            ? "Speak again if anything needs changing. Submit when the table is right."
            : "No completed activities were found. Keep future intentions separate, or add something that has already happened.",
        );
        return true;
      }
      return false;
    } catch (error) {
      if (!controller.signal.aborted) {
        if (
          error instanceof NativePollError &&
          [401, 403].includes(error.status)
        )
          setNeedsSignin(true);
        setFailure(failureFrom(error, "table", navigator.onLine));
        structureError.current =
          error instanceof Error
            ? error.message
            : "Could not prepare activities. Your words are still here.";
        setMessage(structureError.current);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !recording.audio ||
      busy ||
      !providerConsent ||
      !storageConsent ||
      draft.transcript.trim() ||
      autoAudio.current === recording.audio
    )
      return;
    autoAudio.current = recording.audio;
    void transcribe();
    // The blob guard prevents a re-render or later consent from duplicating processing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.embedded,
    recording.audio,
    busy,
    providerConsent,
    storageConsent,
    draft.transcript,
  ]);
  async function replyText() {
    if (!answer.trim()) return;
    if (await sendTyped(answer.trim(), null)) answerUnsent.current = false;
  }
  /** Add a typed reply (for one activity, or the whole table) and prepare the table again. */
  async function sendTyped(text: string, activityId: string | null) {
    allowProcessing();
    if (!providerRef.current || !storageRef.current) {
      structureError.current = "Choose private saving and Sarvam processing before preparing a reply.";
      setMessage(structureError.current);
      return false;
    }
    const previous = draftRef.current.conversation?.at(-1);
    // Retrying the same words after a failure reuses that reply rather than adding it twice.
    if (previous?.activityId !== activityId || previous.text !== text) {
      if ((draftRef.current.conversation?.length ?? 0) >= 40) {
        structureError.current = "This draft has forty replies. Submit it, or start a separate log for the rest.";
        setMessage(structureError.current);
        return false;
      }
      const reply = { id: crypto.randomUUID(), activityId, text };
      edit((current) => ({
        ...changeDraft(current, {}),
        conversation: [...(current.conversation ?? []), reply],
      }));
    }
    return structure(true);
  }
  async function replyAudio(audio: Blob, capture: RecordingSnapshot, activityId = "") {
    if (!providerRef.current || !storageRef.current)
      throw new Error("Use the microphone to start processing.");
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure(null);
    let sending = 0, parts = 0;
    try {
      await flushSave();
      const prepared = await prepareRecording(audio, capture);
      let turnId = replyIds.current.get(audio);
      if (!turnId) {
        turnId = replyRecovery.current?.scope.turnId ?? crypto.randomUUID();
        replyIds.current.set(audio, turnId);
      }
      await replyRecovery.current?.prepared(prepared.chunks, prepared.manifest);
      parts = prepared.chunks.length;
      for (const [index, chunk] of prepared.chunks.entries()) {
        if (controller.signal.aborted) return;
        sending = index;
        setProgress({ phase: "sending", part: index, total: prepared.chunks.length });
        setMessage(
          `Listening to your message… ${Math.round((index / prepared.chunks.length) * 100)}%`,
        );
        await uploadPart(
          "/api/native-log/reply",
          {
            id: idRef.current,
            activityId,
            replyId: turnId,
            index: String(index),
            total: String(prepared.chunks.length),
            consent: "true",
            capture: JSON.stringify(prepared.manifest),
          },
          chunk,
          turnId,
          index,
          controller.signal,
        );
        await replyRecovery.current?.uploaded(
          index,
          chunk,
          prepared.chunks.length,
          prepared.manifest,
        );
      }
      if (!controller.signal.aborted && !(await structure(true)))
        throw new Error(
          "Your voice message is saved. Check the recording notice before continuing.",
        );
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage((error as Error).message);
        setFailure((current) => current ?? { ...failureFrom(error, "sending", navigator.onLine), ...(parts ? { part: { failed: sending + 1, total: parts } } : {}) });
      }
      throw error;
    } finally {
      setBusy(false);
    }
  }
  /** Name what a typed change did; false when it changed nothing. */
  function describeChange(before: NativeDraft["activities"], after: NativeDraft["activities"]) {
    const changed = after.find((item) => {
      const old = before.find((previous) => previous.id === item.id);
      return !old || old.startLocal !== item.startLocal || old.endLocal !== item.endLocal || old.activity !== item.activity || old.node !== item.node || old.timeLabel !== item.timeLabel;
    });
    const removed = before.find((previous) => !after.some((item) => item.id === previous.id));
    if (changed) {
      const when = spokenTimeText(changed);
      setFlowNotice(`${before.some((previous) => previous.id === changed.id) ? "Updated" : "Added"} ${changed.activity}${when ? `: ${when}` : ""}.`);
      setChangedId(changed.id);
      setTimeout(() => setChangedId((current) => (current === changed.id ? null : current)), 4000);
      return true;
    }
    if (removed) {
      setFlowNotice(`Removed ${removed.activity}.`);
      return true;
    }
    return false;
  }
  function openFix(target: string | null) {
    setFixTarget(target);
    setFixError("");
    setFlowNotice("");
    setAnswer("");
    answerUnsent.current = false;
  }
  /** Send the open typed change. The table stays on screen; nothing changes without the person's words. */
  async function sendFix() {
    const text = answer.trim(), target = fixTarget === "new" ? null : fixTarget;
    if (!text || busy || !fixTarget) return;
    const before = draftRef.current.activities;
    const name = before.find((item) => item.id === target)?.activity;
    setFixError("");
    setFlowNotice("");
    setFixing(true);
    try {
      if (!(await sendTyped(text, target))) {
        // Stay on the table: the failure is shown beside the words, which are kept for another try.
        setFailure(null);
        setFixError(`Couldn’t update the table. ${structureError.current || "Your words are kept — try again."}`);
        return;
      }
      if (describeChange(before, draftRef.current.activities)) {
        // Half a time (e.g. a finish that would land before the start is dropped) keeps the box open for the other half.
        const after = draftRef.current.activities.find((item) => item.id === target);
        if (after && Boolean(after.startLocal) !== Boolean(after.endLocal)) {
          const kept = spokenTimeText(after) ?? "";
          setAnswer("");
          answerUnsent.current = false;
          setFixError(after.startLocal
            ? `Got the start${kept ? ` (${kept})` : ""}, but not when ${after.activity} finished. Add the finish time, with am or pm if it could be either.`
            : `Got the finish, but not when ${after.activity} started. Add the start time, with am or pm if it could be either.`);
          return;
        }
        openFix(null);
        return;
      }
      setAnswer(text);
      answerUnsent.current = true;
      setFixError(name
        ? `Nothing changed for ${name}. Try saying it another way, like “it was 7 to 8 am”.`
        : "Nothing changed. Try naming the activity, like “the walk was 7 to 8 am” or “add lunch at 1 pm”.");
    } finally {
      setFixing(false);
    }
  }
  async function confirm() {
    // The member flow does not show `message`; a refused Submit must still say why.
    const refuse = (text: string) => {
      setMessage(text);
      if (flow) setFlowNotice(text);
    };
    const blocked = capturesRef.current.find(
      captureBlocks,
    );
    if (blocked) {
      refuse(captureMessage(blocked));
      return;
    }
    if (
      busy ||
      mainCapture.current ||
      replyCapture.current ||
      answerUnsent.current
    ) {
      refuse(answer.trim() ? "Send or clear your typed change before submitting." : "Finish your message before submitting.");
      return;
    }
    if (!canSubmitCapture(draftRef.current)) {
      refuse("Review the full timeline and confirm that it is accurate.");
      return;
    }
    setBusy(true);
    setSubmitting(true);
    setFlowNotice("");
    setMessage("Saving your confirmed log…");
    try {
      await flushSave();
      const body = await responseJson(
        await fetch("/api/native-log/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: idRef.current,
            revision: cloudRevision.current,
            confirmed: true,
            confirmationText: consentText,
          }),
        }),
      );
      setReceipt(body.receipt);
      receiptRef.current = body.receipt;
      if (props.deviceRecovery)
        void clearDeviceDraft(props.ownerScope, idRef.current)
          .then(() =>
            setDeviceTurns((turns) =>
              turns.filter((turn) => turn.draftId !== idRef.current),
            ),
          )
          .catch(() =>
            setRecoveryNotice(
              "The log was submitted. Device audio could not be cleared now; its recovery access still expires within 24 hours.",
            ),
          );
      setStep("done");
      setRecording(initialRecording);
      setSaveStatus("Submitted");
      setMessage("");
      if (props.embedded) router.refresh();
      setSavedDrafts((current) =>
        current.map((item) =>
          item.id === idRef.current ? { ...item, status: "submitted" } : item,
        ),
      );
    } catch (error) {
      setMessage((error as Error).message);
      if (flow) {
        const cause = failureFrom(error, "submit", navigator.onLine);
        setFlowNotice(cause.kind === "offline" ? "Couldn’t submit — this phone is offline. Your table is saved; submit when you’re back online."
          : cause.kind === "signin" ? "Couldn’t submit — please sign in again in another tab. Your table is saved."
          : `Couldn’t submit — ${(error as Error).message}`);
      }
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  }
  async function openDraft(draftId: string) {
    if (!mayReplace()) return;
    try {
      const body = await responseJson(
        await fetch(`/api/native-log/drafts?id=${draftId}`, {
          headers: { "x-value-log-session": props.binding },
          cache: "no-store",
        }),
      );
      if (!body.document)
        throw new Error(
          "This draft was removed. Your current writing is still here.",
        );
      idRef.current = draftId;
      setId(draftId);
      answerUnsent.current = false;
      setAnswer("");
      setFailure(null);
      setFixTarget(null);
      setFixError("");
      setFlowNotice("");
      applyView(body);
      setReceipt(body.receipt ?? null);
      setProcessingIssue(body.processingError ?? null);
      receiptRef.current = body.receipt ?? null;
      setStoragePermission(true);
      setRecording(initialRecording);
      recordingId.current = body.recording?.id ?? "";
      mainRecovery.current = null;
      replyRecovery.current = null;
      recoveredPrepared.current = null;
      setRecoveryNotice("");
      knownManifest.current = body.recording?.manifest;
      preparedAudio.current = null;
      setStep(
        body.receipt
          ? "done"
          : body.document.activities.length
            ? "activities"
            : "words",
      );
      setMessage("");
      history.replaceState(
        null,
        "",
        props.embedded
          ? `/day?date=${props.date}&draft=${draftId}`
          : `/log?draft=${draftId}`,
      );
      if (body.processingUntil) {
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setMessage("Preparing activities… Your words are saved.");
        try {
          const view = await pollNativeProposal<DraftView>({
            id: draftId,
            revision: body.revision,
            binding: props.binding,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            applyView(view);
            if (view.processingError)
              throw new Error(processingMessage(view.processingError));
            setStep("activities");
            setMessage("Your proposed activities are ready to check.");
          }
        } finally {
          setBusy(false);
        }
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  function startAnother() {
    if (!mayReplace()) return;
    const next = {
      ...newNativeDraft(
        props.ownerScope,
        props.date,
        props.timezone,
        props.mode,
      ),
      cohort: props.cohort,
    };
    draftRef.current = next;
    setDraft(next);
    idRef.current = "";
    setId("");
    cloudRevision.current = 0;
    savedLocalRevision.current = -1;
    setReceipt(null);
    setProcessingIssue(null);
    setUnmatchedRows(0);
    receiptRef.current = null;
    setRecording(initialRecording);
    recordingId.current = "";
    mainRecovery.current = null;
    replyRecovery.current = null;
    recoveredPrepared.current = null;
    setRecoveryNotice("");
    knownManifest.current = undefined;
    preparedAudio.current = null;
    capturesRef.current = [];
    setCaptures([]);
    setHasCloudDraft(false);
    setStoragePermission(false);
    setProviderConsent(false);
    providerRef.current = false;

    answerUnsent.current = false;
    setAnswer("");
    setFailure(null);
    setFixTarget(null);
    setFixError("");
    setFlowNotice("");
    setStep("record");
    setSaveStatus("Only in this tab");
    setMessage("");
    history.replaceState(
      null,
      "",
      props.embedded ? `/day?date=${props.date}` : "/log",
    );
  }
  async function removeDraft() {
    if (
      !idRef.current ||
      busy ||
      !window.confirm(
        receiptRef.current?.sourceReferenced
          ? "Remove this conversation from the saved draft list? Its approved source and review history remain private supporting evidence. Device audio will be cleared."
          : receiptRef.current?.dayIndexVersion === 1
            ? "Remove this private log, its transcript and its displayed unassessed activities? This cannot be undone."
          : "Remove this saved transcript and draft? Confirmed activity records remain in Value Log and have their own removal controls. This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      const latest = await responseJson(
        await fetch(`/api/native-log/drafts?id=${idRef.current}`, {
          headers: { "x-value-log-session": props.binding },
          cache: "no-store",
        }),
      );
      if (latest.status === "removed") {
        router.replace("/log");
        router.refresh();
        return;
      }
      if (
        latest.revision !== cloudRevision.current &&
        latest.status !== "submitted"
      )
        throw new Error(
          "This draft changed in another tab. Download your writing, then open its saved version before removing it.",
        );
      await responseJson(
        await fetch("/api/native-log/drafts", {
          method: "DELETE",
          headers,
          body: JSON.stringify({
            id: idRef.current,
            revision: latest.revision,
          }),
        }),
      );
      if (props.deviceRecovery)
        await clearDeviceDraft(props.ownerScope, idRef.current);
      receiptRef.current = receipt || {
        kind: "unassessed",
        ids: [],
        dates: [],
        count: 0,
        timezone: draft.timezone,
      };
      router.replace("/log");
      router.refresh();
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  }
  const beforePilot = Boolean(
    props.cohortBoundary &&
      draft.activities.some((a) => {
        const { start } = activityInstants(a, draft.timezone);
        return start && Date.parse(start) < Date.parse(props.cohortBoundary!);
      }),
  );
  const Heading = props.embedded ? "h2" : "h1";
  // Before anything is said, keep the card quiet: no storage or submission notes yet.
  const nothingYet = !draft.activities.length && !draft.transcript?.trim() && !busy && !message && !blockedCapture && !processingIssue;
  const blockers = captureQuestions(draft);
  const mainRecording = ["recording", "requesting"].includes(recording.phase);
  const submission = submissionState({
    busy,
    captureIssue: blockedCapture ? captureMessage(blockedCapture) : undefined,
    processingIssue: processingIssue ? processingMessage(processingIssue) : undefined,
    timelineIssue: !canSubmitCapture(draft)
      ? blockers[0]?.title ?? "Add a completed activity before submitting."
      : undefined,
    writing: props.writing,
    confirming: props.confirming !== false,
    beforePilot,
    voiceActive: voiceActive || mainRecording,
    voiceRecording: voiceRecording || mainRecording,
    unsentWords: Boolean(answer.trim()),
  });
  function startSpeaking() {
    if (busy || !props.writing || !props.processing) return;
    allowProcessing();
    setFlowNotice("");
    setFailure(null);
    listen();
    startDeviceRecovery("initial");
    void recorder.current?.start();
  }
  function retryFlow() {
    setFlowNotice("");
    if ((recording.audio || recoveredPrepared.current) && (!draftRef.current.transcript.trim() || failure?.stage === "sending" || blockedCapture)) {
      allowProcessing();
      void transcribe();
    } else void structure(true);
  }
  function recordAgain() {
    recordingId.current = "";
    knownManifest.current = undefined;
    preparedAudio.current = null;
    setRecording(initialRecording);
    autoAudio.current = null;
    startSpeaking();
  }
  function renderFlow() {
    const capturing = mainRecording || recording.phase === "stopping";
    // A typed change keeps the table on screen; only first preparation shows the working screen.
    const waiting = (busy && !submitting && !fixing) || Boolean(recording.audio && !draft.transcript.trim() && !failure && !blockedCapture && recording.phase === "ready" && providerConsent);
    const derivedFailure: Failure | null = failure
      ?? (blockedCapture ? { kind: blockedCapture.state === "empty" ? "no_words" : "partial_capture", stage: "sending" } : null)
      ?? (processingIssue && !draft.activities.length ? { kind: processingIssue === "PROVIDER_ALLOWANCE" ? "allowance" : "table_step", stage: "table" } : null)
      ?? (draft.transcript.trim() && !draft.activities.length && !busy ? { kind: "no_activities", stage: "table" } : null);
    const screen = flowScreen({ receipt, capturing, busy: waiting, failure: derivedFailure, activities: draft.activities.length, transcript: Boolean(draft.transcript.trim()) });
    const closeHref = `/day?date=${draft.date}`;
    const sharedDay = Boolean(props.sharedDay);
    const speechSeconds = recording.elapsed;
    const paused = !props.writing ? "Saving is temporarily paused. Your saved drafts remain available." : !props.processing ? "Voice processing is unavailable right now. You can type instead." : "";
    const typingControls = typing ? <div className="flow-typing">
      <label className="flow-meta" htmlFor="flow-typed">{draft.transcript ? "Type what you did, and roughly when" : "Type your day"}</label>
      <textarea id="flow-typed" maxLength={3000} value={answer} disabled={busy} onChange={(e) => { setAnswer(e.target.value); answerUnsent.current = Boolean(e.target.value.trim()); }} />
      <button type="button" className="secondary" disabled={busy || !answer.trim() || !props.processing || !props.writing} onClick={() => {
        allowProcessing();
        setTyping(false);
        if (!draftRef.current.transcript.trim()) {
          edit((d) => changeDraft(d, { transcript: answer.trim() }));
          answerUnsent.current = false;
          setAnswer("");
          void structure(true);
        } else void replyText();
      }}>Use my words</button>
    </div> : <button type="button" className="flow-link plain" onClick={() => setTyping(true)}>{draft.transcript ? "Type what you did" : "Type instead"}</button>;
    const submitAction = { label: submitting ? "Submitting…" : "Submit Value Log", onClick: () => void confirm(), disabled: submission.disabled || submitting || !online };
    const submitReason = !online ? "You’re offline. Your table is saved — submit when you’re back online." : submission.disabled ? submission.message : "";
    const savedPanel = savedDrafts.length ? <details className="flow-extras flow-saved">
      <summary><span><strong>Saved logs</strong><small>{savedDrafts.length ? plural(savedDrafts.length, "saved log", "saved logs") : "View your saved writing"}</small></span><span className="flow-saved-toggle" aria-hidden="true">+</span></summary>
      <div className="flow-saved-content">
        {savedDrafts.length ? <ul className="flow-saved-list">{savedDrafts.map((item) => <li key={item.id}>
          <div><strong>{longDate(item.date)}</strong><span>{item.status === "submitted" ? "Submitted" : "Draft"} · {plural(item.count, "activity", "activities")}</span></div>
          <button type="button" className="flow-saved-open" disabled={busy} onClick={() => void openDraft(item.id)} aria-label={`Open ${item.status === "submitted" ? "submitted log" : "draft"} for ${longDate(item.date)}`}>Open <span aria-hidden="true">↗</span></button>
        </li>)}</ul> : <p className="flow-saved-empty">No saved logs yet.</p>}
        <details className="flow-saved-tools"><summary>Download or remove writing</summary>
          <p>These options apply to your voice-log writing. Confirmed activities have separate controls.</p>
          <button type="button" className="secondary" onClick={downloadDraft}>Download this writing</button>
          {hasCloudDraft ? <button type="button" className="quiet" disabled={busy} onClick={() => void removeDraft()}>Remove saved transcript and draft</button> : null}
          <NativeExport binding={props.binding} />
        </details>
      </div>
    </details> : null;
    const signin = needsSignin ? <p className="flow-meta"><a href="/login" target="_blank" rel="noopener noreferrer">Sign in in another tab</a>, then return here. Nothing is lost.</p> : null;

    if (screen === "recording") {
      return <Shell title={props.deviceRecovery ? "Saving as you speak" : "Recording"} closeHref={closeHref} closeLabel="Stop, close and return to Today. Your recording is kept." live={silent ? "We can’t hear you — check your microphone isn’t muted." : ""}
        dock={<Dock top={{ label: "Finish", icon: <Stop />, tone: "ember", onClick: () => recorder.current?.stop(), disabled: recording.phase === "stopping" }} reason="Finish first — then check your table and submit." bottom={{ label: "Submit Value Log", disabled: true }} />}>
        <RecordingScreen elapsed={recording.elapsed} silent={silent} level={level} deviceSaved={Boolean(props.deviceRecovery)} stopping={recording.phase === "stopping"} />
      </Shell>;
    }
    if (screen === "processing") {
      const interrupted = recording.stopReason === "interrupted" ? `Recording stopped — another app or the screen lock used the microphone. Everything up to ${speechLength(recording.elapsed)} is kept.` : undefined;
      return <Shell title={props.deviceRecovery ? "Recording saved" : "Working"} closeHref={closeHref} closeLabel="Close and return to Today. Your recording is kept." live={progress.phase === "table" ? "Building your table" : progress.total ? `Sending part ${progress.part + 1} of ${progress.total}` : "Sending your recording"}
        dock={<Dock reason="Submit opens once your table is ready." bottom={{ label: "Submit Value Log", disabled: true }} />}>
        <ProcessingScreen speechSeconds={speechSeconds} phase={progress.phase} part={progress.part} total={progress.total} deviceSaved={Boolean(props.deviceRecovery)} interrupted={interrupted} />
      </Shell>;
    }
    if (screen === "failed" && derivedFailure) {
      const saved = props.deviceRecovery && recording.audio
        ? `Your recording is saved on this phone. ${speechLength(speechSeconds)} recorded. Encrypted, and kept for up to 24 hours.`
        : draft.transcript.trim() ? "Your words so far are saved in your account." : "Your recording is still in this tab. Keep it open.";
      const top = derivedFailure.kind === "no_words" && !draft.transcript.trim()
        ? { label: "Record again", icon: <Mic />, tone: "ember" as const, onClick: recordAgain }
        : derivedFailure.kind === "no_activities" && !typing
          ? { label: "Type what you did", tone: "ember" as const, onClick: () => setTyping(true) }
          : undefined;
      const retryable = !["no_activities", "paused"].includes(derivedFailure.kind);
      const useWords = blockedCapture && blockedCapture.withWords > 0
        ? <button type="button" className="flow-link plain" onClick={() => void acceptCapturedWords(blockedCapture.key)}>Use only the words that arrived</button> : null;
      return <Shell title={props.deviceRecovery ? "Recording saved" : "Not finished"} closeHref={closeHref} closeLabel="Close and return to Today. Nothing is lost."
        dock={<Dock top={top} bottom={retryable ? { label: "Retry", icon: <Retry />, tone: "ink", onClick: retryFlow, disabled: busy } : { label: "Submit Value Log", disabled: true }} />}>
        <FailedScreen failure={derivedFailure} saved={saved} extra={<>{useWords}{derivedFailure.kind === "no_activities" ? typingControls : null}{signin}</>} />
      </Shell>;
    }
    if (screen === "done" && receipt) {
      const summary = doneSummary(receipt, draft, id);
      return <Shell title="" closeHref={summary.href} closeLabel="Close and return to your day."
        dock={<Dock top={{ label: "Log more", icon: <Mic />, tone: "outline-ember", onClick: startAnother }} reason={summary.highlight} bottom={{ label: summary.hrefLabel, tone: "ink", href: summary.href }} />}>
        <DoneScreen summary={summary} draft={draft} audioNote={props.deviceRecovery ? "The audio for this log has been cleared from this phone." : undefined} />
      </Shell>;
    }
    if (screen === "check") {
      const missing = missingTimes(draft).length;
      const correction = {
        target: fixTarget, text: answer, error: fixError, sending: fixing,
        disabled: (busy && !fixing) || !props.writing || !props.processing,
        onOpen: (target: string) => openFix(fixTarget === target ? null : target),
        onChange: (text: string) => { setAnswer(text); setFixError(""); answerUnsent.current = Boolean(text.trim()); },
        onSend: () => void sendFix(),
        onCancel: () => openFix(null),
      };
      const reason = submitReason || (missing ? undefined : "Everything is ready to submit.");
      return <Shell title={saveStatus} closeHref={closeHref} closeLabel="Close and return to Today. Your draft is kept." live={flowNotice}
        dock={<Dock reason={reason} bottom={{ ...submitAction, tone: "ink" }} />}>
        <CheckScreen draft={draft} changedId={changedId} sharedDay={sharedDay} notice={flowNotice} correction={correction}
          unmatched={unmatchedRows && !unmatchedDismissed ? { count: unmatchedRows, onAdd: () => openFix("new"), onDismiss: () => setUnmatchedDismissed(true) } : null}
          preparation={processingIssue ? { message: processingMessage(processingIssue), disabled: busy || !props.processing, onRetry: () => { allowProcessing(); void structure(true); } } : null} />
        {signin}
      </Shell>;
    }
    const turn = deviceTurns[0];
    const resume = turn
      ? { label: `You have an unsent recording from ${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(turn.expiresAt - 24 * 60 * 60 * 1000))}.`, onResume: () => { allowProcessing(); void resumeDeviceTurn(turn); } }
      : null;
    return <Shell title={longDate(draft.date)} closeHref={closeHref} closeLabel="Close and return to Today. Your draft is kept."
      dock={<Dock top={{ label: "Start speaking", icon: <Mic />, tone: "ember", onClick: startSpeaking, disabled: busy || Boolean(paused) }} reason={paused || undefined} note={<p className="flow-start-privacy">{props.deviceRecovery ? "Audio is processed by Sarvam and kept encrypted on this phone for up to 24 hours." : "Audio is processed by Sarvam. Keep this screen open until your table appears."}</p>} />}>
      <StartScreen date={draft.date} resume={resume} typingControls={typingControls}
        notice={!online ? "You’re offline. You can still record — send it when you’re back online." : recording.phase === "error" ? recording.message : recoveryNotice || undefined}
        extras={<>{savedPanel}{signin}</>} />
    </Shell>;
  }
  if (flow) return renderFlow();
  return (
    <div
      className="native-log native-conversation"
      data-owner-scope={props.ownerScope}
    >
      <div className="native-heading">
        <div>
          <p className="meta">Private Value Log · {draft.date}</p>
          <Heading ref={heading} tabIndex={-1}>
            {receipt
              ? draft.correctsRecordId ? "Your correction is submitted." : "Your Value Log is submitted."
              : busy
                ? "Preparing your Value Log."
                : blockedCapture
                  ? "Check this recording."
                  : draft.activities.length
                    ? draft.correctsRecordId ? "Check your correction." : "Here’s your Value Log."
                    : "Walk me through your day."}
          </Heading>
        </div>
        <span className="native-save-state" role="status">
          {nothingYet && saveStatus === "Only in this tab" ? "" : saveStatus}
        </span>
      </div>
      {!receipt ? (
        <>
          {draft.activities.length ? (
            <>
              <ReadbackTable document={draft} />
              <p className="meta">
                {draft.correctsRecordId
                  ? "Check this activity, then submit the correction. Your other activities stay as they are."
                  : "Check the table. Speak again to correct or add something."}
              </p>
            </>
          ) : (
            <p className="lede">
              Say what you did, roughly when, and anything you noticed.
              Your log takes shape here as you talk.
            </p>
          )}
          {props.deviceRecovery && deviceTurns.length ? (
            <details>
              <summary>Unfinished recordings on this device</summary>
              {deviceTurns.map((turn) => (
                <button
                  className="secondary"
                  key={turn.turnId}
                  disabled={busy}
                  onClick={() => {
                    allowProcessing();
                    void resumeDeviceTurn(turn);
                  }}
                >
                  Resume saved recording
                </button>
              ))}
            </details>
          ) : null}
          {draft.reviewQuestion ? (
            <p className="native-notice">From Review: {draft.reviewQuestion}</p>
          ) : null}
          <div className={`native-action-bar${draft.activities.length ? " has-table" : ""}`} role="group" aria-label="Review and submit">
          {draft.activities.length ||
          (draft.transcript.trim() &&
            !(recording.audio && blockedCapture?.key === "initial")) ? (
            <VoiceReply
              key={`${draft.processedReplyId ?? "voice"}:${voiceReset}`}
              automatic
              onStart={() => {
                allowProcessing();
                startDeviceRecovery("reply");
              }}
              persistence={{
                chunk: (blob, index, elapsedMs) => {
                  void replyRecovery.current?.raw(blob, index, elapsedMs);
                },
                finished: (snapshot) => {
                  void replyRecovery.current?.finish(snapshot);
                },
              }}
              onReply={replyAudio}
              disabled={busy || !props.writing || !props.processing}
              onCaptureState={trackReplyCapture}
            />
          ) : (
            <div className="native-mic-zone">
              <button
                type="button"
                className={`native-mic ${mainRecording ? "is-recording" : ""}`}
                disabled={
                  busy ||
                  !props.writing ||
                  !props.processing ||
                  recording.phase === "stopping"
                }
                aria-label={
                  mainRecording
                    ? "Finish recording"
                    : recording.audio
                      ? "Retry recording processing"
                      : "Record your Value Log"
                }
                onClick={() => {
                  if (mainRecording) recorder.current?.stop();
                  else {
                    allowProcessing();
                    if (recording.audio) void transcribe();
                    else {
                      startDeviceRecovery("initial");
                      void recorder.current?.start();
                    }
                  }
                }}
              >
                <svg
                  viewBox="0 0 64 64"
                  width="52"
                  height="52"
                  aria-hidden="true"
                >
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
                  {mainRecording
                    ? `Finish · ${clock(recording.elapsed)}`
                    : recording.audio
                      ? "Try processing again"
                      : "Log by voice"}
                </span>
              </button>
              <p className="meta">
                {mainRecording
                  ? "Listening. Tap the microphone when you’ve finished."
                  : "Tap the microphone, speak, then tap it to finish."}
              </p>
            </div>
          )}
          {draft.activities.length ? (
            <button
              className="native-submit"
              disabled={submission.disabled}
              aria-describedby="native-submit-status"
              onClick={() => void confirm()}
            >
              Submit Value Log
            </button>
          ) : null}
          <p id="native-submit-status" className="native-submit-status" role="status">
            {nothingYet ? null : busy ? message || submission.message : submission.disabled ? submission.message : message || submission.message}
          </p>
          {processingIssue && !busy && !voiceActive ? (
            <button className="secondary native-processing-retry" disabled={voiceActive || mainRecording || Boolean(answer.trim()) || !props.processing || !props.writing} onClick={() => {
              allowProcessing();
              void structure(true);
            }}>
              Try preparing again
            </button>
          ) : null}
          {!busy && saveStatus.startsWith("Not saved") ? (
            <button className="secondary" onClick={() => void saveNow()}>Retry saving</button>
          ) : null}
          </div>
          <details className="native-recording-info" open={!draft.activities.length}>
            <summary>Recording and privacy</summary>
          {props.deviceRecovery ? (
            <p className="meta" role="status">
              {recoveryNotice ||
                "Pending audio can be encrypted on this device for up to 24 hours, until submission or removal. Browser storage may be cleared. Audio is sent for processing only when you use the microphone."}
            </p>
          ) : null}
          <p className="native-processing-note meta">
            Using the microphone saves your words privately and sends audio and
            text to Sarvam to prepare your log. Value Log saves words, not
            audio. <Link href="/privacy">Privacy</Link>
          </p>
          <p className="meta">
            Up to ten minutes each time. Keep this page open while recording.
          </p>
          </details>
          {recording.message ? <p role="status">{recording.message}</p> : null}
          {blockedCapture && !busy ? (
            <div className="native-notice" role="alert">
              <p>{captureMessage(blockedCapture)}</p>
              {audioUrl && blockedCapture.key === "initial" ? (
                <audio
                  controls
                  src={audioUrl}
                  preload="none"
                  aria-label="Listen to your captured recording"
                />
              ) : null}
              {blockedCapture.state === "empty" ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    voiceRecording ||
                    mainRecording ||
                    !props.writing ||
                    !props.processing ||
                    Boolean(answer.trim())
                  }
                  onClick={() => {
                    if (blockedCapture.key !== "initial") {
                      void acceptCapturedWords(blockedCapture.key, true);
                      return;
                    }
                    recordingId.current = "";
                    knownManifest.current = undefined;
                    preparedAudio.current = null;
                    allowProcessing();
                    void recorder.current?.start();
                  }}
                >
                  {blockedCapture.key === "initial"
                    ? "Record again"
                    : "Discard empty voice message"}
                </button>
              ) : null}
              {blockedCapture.withWords > 0 ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void acceptCapturedWords(blockedCapture.key)}
                  disabled={
                    Boolean(answer.trim()) ||
                    !props.writing ||
                    !props.processing ||
                    voiceRecording ||
                    mainRecording ||
                    recording.phase === "stopping"
                  }
                >
                  Use only the captured words
                </button>
              ) : null}
            </div>
          ) : null}
          <details className="native-more">
            <summary>Words and other options</summary>
            {draft.transcript ? (
              <details>
                <summary>Read what I said</summary>
                <p className="native-source">{draft.transcript}</p>
                {draft.conversation?.map((turn) => (
                  <p className="native-source" key={turn.id}>
                    {turn.text}
                  </p>
                ))}
              </details>
            ) : null}
            <label>
              {draft.transcript
                ? "Type a correction or addition"
                : "Or type your day"}
              <textarea
                rows={4}
                maxLength={3000}
                value={answer}
                disabled={busy}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  answerUnsent.current = Boolean(e.target.value.trim());
                }}
              />
            </label>
            <button
              className="secondary"
              disabled={
                busy || !answer.trim() || !props.processing || !props.writing
              }
              onClick={() => {
                allowProcessing();
                if (!draftRef.current.transcript.trim()) {
                  edit((d) => changeDraft(d, { transcript: answer.trim() }));
                  answerUnsent.current = false;
                  setAnswer("");
                  void structure(true);
                } else void replyText();
              }}
            >
              Use my words
            </button>
            {recording.audio ? (
              <>
                <audio controls src={audioUrl} />
                <a href={audioUrl} download="value-log-recording.webm">
                  Download recording
                </a>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    allowProcessing();
                    void transcribe();
                  }}
                >
                  Try processing again
                </button>
              </>
            ) : null}
            <label className="native-date">
              Day described
              <input
                type="date"
                value={draft.date}
                max={props.today}
                disabled={
                  busy ||
                  Boolean(draft.activities.length) ||
                  Boolean(draft.transcript && blockedCapture?.key !== "initial")
                }
                onChange={(e) =>
                  edit((d) => changeDraft(d, { date: e.target.value }))
                }
              />
            </label>
            {!draft.transcript.trim() || blockedCapture?.key === "initial" ? (
              <label>
                Use an audio recording
                <input
                  type="file"
                  accept="audio/*,video/webm,video/mp4"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!file.size || file.size > 24 * 1024 * 1024) {
                      setMessage("Choose a recording smaller than 24 MB.");
                      return;
                    }
                    allowProcessing();
                    setRecording({
                      phase: "ready",
                      audio: file,
                      elapsed: 0,
                      message: "",
                    });
                    recordingId.current ||= crypto.randomUUID();
                  }}
                />
              </label>
            ) : null}
          </details>
        </>
      ) : (
        <section className="native-done">
          <p className="lede">
            {receipt.count} {receipt.count === 1 ? "activity" : "activities"}{" "}
            saved.
          </p>
          <p>
            {receipt.kind === "capture_review_pending"
              ? "Your approved log is in Review. Missing facts remain unstated, and assessment is pending. Nothing has been treated as a neutral effect or calculated."
              : receipt.kind === "unassessed"
                ? "Your activities are private and unassessed."
                : "Your approved log is in Review. Validation comes before calculation."}
          </p>
          <div className="native-actions">
            <Link
              className="button"
              href={
                receipt.kind === "unassessed"
                  ? `/day?date=${receipt.dates[0]}`
                  : "/review"
              }
            >
              {receipt.kind === "unassessed"
                ? "See my activities"
                : "Open Review"}
            </Link>
            <button className="secondary" onClick={startAnother}>
              Log another moment
            </button>
          </div>
        </section>
      )}
      {receipt && !busy && message ? (
        <div className="native-message" role="status">
          {message}
        </div>
      ) : null}
      {needsSignin ? (
        <p>
          <a href="/login" target="_blank" rel="noopener noreferrer">
            Sign in in another tab
          </a>
          , then return here. Your writing is kept.
        </p>
      ) : null}
      {busy ? (
        <button
          className="quiet"
          onClick={() => {
            request.current?.abort();
            setMessage(
              "Your saved words remain available. Return to this draft to check whether processing finished.",
            );
          }}
        >
          Stop waiting
        </button>
      ) : null}
      <details className="native-saved">
        <summary>Saved conversations, export and removal</summary>
        {savedDrafts.length ? (
          <ul>
            {savedDrafts.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.date}</strong>
                  <span>
                    {item.count} activities ·{" "}
                    {item.status === "submitted" ? "Submitted" : "Draft"}
                  </span>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void openDraft(item.id)}
                >
                  {item.id === id ? "Open saved version" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button className="secondary" onClick={downloadDraft}>
          Download this writing
        </button>
        {hasCloudDraft ? (
          <button
            className="quiet"
            disabled={busy}
            onClick={() => void removeDraft()}
          >
            Remove saved transcript and draft
          </button>
        ) : null}
        <NativeExport binding={props.binding} />
        <p className="meta">
          Confirmed activity records have separate removal controls. Audio stays
          in this tab; download it if you want to keep it.
        </p>
      </details>
    </div>
  );
}
