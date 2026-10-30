/** One reason beside the disabled action, without relaxing any approval guard. */
export function submissionState(input: {
  busy: boolean;
  captureIssue?: string;
  processingIssue?: string;
  timelineIssue?: string;
  writing: boolean;
  confirming: boolean;
  beforePilot: boolean;
  voiceActive: boolean;
  voiceRecording?: boolean;
  unsentWords: boolean;
}) {
  if (input.busy) return { disabled: true, message: "Updating your table. Please wait…" };
  if (input.captureIssue) return { disabled: true, message: input.captureIssue };
  if (input.processingIssue) return { disabled: true, message: input.processingIssue + (input.voiceActive && !input.voiceRecording ? " Retry the voice message using the microphone." : "") };
  if (!input.writing) return { disabled: true, message: "Saving is temporarily paused. Your draft is kept here." };
  if (!input.confirming) return { disabled: true, message: "Review access is paused. Your saved draft remains available." };
  if (input.beforePilot) return { disabled: true, message: "This activity is before your pilot starting day. Keep it as private history." };
  if (input.voiceActive) return { disabled: true, message: input.voiceRecording ? "Finish your voice message before submitting." : "Your voice message has not finished processing. Use the microphone to retry it." };
  if (input.unsentWords) return { disabled: true, message: "Send or clear your typed change before submitting." };
  if (input.timelineIssue) return { disabled: true, message: input.timelineIssue };
  return { disabled: false, message: "Check the table, then submit." };
}
