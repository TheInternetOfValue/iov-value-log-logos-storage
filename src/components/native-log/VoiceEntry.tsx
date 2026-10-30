import { NativeWorkspace } from "./NativeWorkspace";
import "../cohort/cohort.css";
export function VoiceEntry({ date, draft }: { date: string; draft?: string }) {
  return (
    <section className="voice-entry" id="voice" aria-label="Log your day">
      <NativeWorkspace
        embedded
        searchParams={Promise.resolve({ date, draft })}
      />
    </section>
  );
}
