export type FounderWellbeingMode = "legacy" | "founder_v0_1_preview" | "founder_v0_1_live";

export function founderWellbeingMode(): FounderWellbeingMode {
  const value = process.env.FOUNDER_WELLBEING_V01?.trim();
  return value === "founder_v0_1_preview" || value === "founder_v0_1_live" ? value : "legacy";
}

export function founderWellbeingEnabled() {
  return founderWellbeingMode() !== "legacy";
}
