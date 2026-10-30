// Browser-safe. Detects a muted or blocked microphone without judging pauses.
// Calibrated on a Redmi Note 10 (28 October 2026): a quiet room peaked around
// -35 to -41 dBFS, a privacy-blocked microphone around -48 dBFS. People pause
// to remember, so only a long, near-silent stretch raises the warning.
export const SILENCE_PEAK_DBFS = -45;
export const SILENCE_AFTER_MS = 8000;

export class SilenceWatch {
  private startedAt: number;
  private heardAt: number | null = null;
  private warned = false;
  constructor(now: number) {
    this.startedAt = now;
  }
  /** Feed one peak sample; returns the current state and whether it just changed. */
  observe(peakDbfs: number, now: number) {
    if (peakDbfs > SILENCE_PEAK_DBFS) this.heardAt = now;
    const silent = now - (this.heardAt ?? this.startedAt) >= SILENCE_AFTER_MS;
    const changed = silent !== this.warned;
    this.warned = silent;
    return { silent, changed, recovered: changed && !silent };
  }
}

/** Peak level of float audio samples in whole dBFS (-120 for silence). */
export function peakDbfs(samples: ArrayLike<number>) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return Math.max(-120, Math.min(0, Math.round(20 * Math.log10(Math.max(peak, 1e-6)))));
}
