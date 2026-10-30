export type ReelBeat = {
  timecode: string;
  label: string | null;
  shotEdit: string | null;
  narrator: string | null;
  onScreenText: string | null;
  finalBeat: boolean;
};

export type ParsedReelScript = { kind: "structured"; beats: ReelBeat[] } | { kind: "fallback"; text: string };

function clean(value: string) {
  return value.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
}

function append(current: string | null, value: string) {
  return current ? `${current}\n${value}` : value;
}

export function parseCinematicReelScript(script: string): ParsedReelScript {
  const beats: ReelBeat[] = [];
  let current: ReelBeat | null = null;
  let activeField: "shotEdit" | "narrator" | "onScreenText" | null = null;

  for (const rawLine of script.replace(/\r\n/g, "\n").split("\n")) {
    const line = clean(rawLine);
    const beat = line.match(/^(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})(?:\s*[—-]\s*(.+))?$/);
    if (beat) {
      current = { timecode: beat[1].replace(/\s+/g, ""), label: beat[2]?.trim() ?? null, shotEdit: null, narrator: null, onScreenText: null, finalBeat: /final\s+beat/i.test(beat[2] ?? "") };
      beats.push(current);
      activeField = null;
      continue;
    }
    if (!current) continue;
    const field = line.match(/^(Shot\s*\/\s*edit|Visual|Narrator|Voiceover|On-screen text):\s*(.*)$/i);
    if (field) {
      const name = field[1].toLowerCase();
      activeField = name === "shot / edit" || name === "visual" ? "shotEdit" : name === "narrator" || name === "voiceover" ? "narrator" : "onScreenText";
      current[activeField] = field[2] || null;
      continue;
    }
    if (activeField && line && line !== "---") current[activeField] = append(current[activeField], line);
  }

  return beats.length && beats.some((beat) => beat.shotEdit || beat.narrator || beat.onScreenText) ? { kind: "structured", beats } : { kind: "fallback", text: script };
}
