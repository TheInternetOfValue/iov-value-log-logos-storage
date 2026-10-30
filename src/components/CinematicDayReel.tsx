import { parseCinematicReelScript } from "@/lib/cinematic-reel-script";
import { formatLocalTime } from "@/lib/format";

export function CinematicDayReel({ title, durationSeconds, script, evidenceCutoffAt }: { title: string; durationSeconds: number; script: string; evidenceCutoffAt?: string | null }) {
  const parsed = parseCinematicReelScript(script);
  return <details className="cinematic-day-reel">
    <summary><span>Cinematic Day Reel</span><span>{durationSeconds} sec · saved</span></summary>
    <div className="cinematic-day-reel-body">
      <h2>{title}</h2>
      <p className="meta">{evidenceCutoffAt ? `Evidence through ${formatLocalTime(evidenceCutoffAt)} IST. ` : ""}A private retrospective script. It does not alter activities, campaign movement, or identity.</p>
      {parsed.kind === "structured" ? <div className="cinematic-day-reel-beats">{parsed.beats.map((beat) => <article className={beat.finalBeat ? "final-beat" : ""} key={`${beat.timecode}-${beat.label ?? "beat"}`}>
        <header><time>{beat.timecode}</time>{beat.label ? <strong>{beat.label}</strong> : null}</header>
        {beat.shotEdit ? <p><b>Shot / edit</b>{beat.shotEdit}</p> : null}
        {beat.narrator ? <p><b>Narrator</b>{beat.narrator}</p> : null}
        {beat.onScreenText ? <p><b>On-screen text</b>{beat.onScreenText}</p> : null}
      </article>)}</div> : <div className="cinematic-day-reel-script">{parsed.text}</div>}
    </div>
  </details>;
}
