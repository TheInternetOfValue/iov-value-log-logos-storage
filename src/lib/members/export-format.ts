/** Assemble a complete file incrementally; keep each server response bounded. */
export function memberExportWriter(metadata: Record<string,unknown>) {
  const chunks: string[] = [JSON.stringify(metadata).slice(0,-1)];
  let current: "activities" | "audit" | null = null, hasRecords = false;
  return {
    append(stage: "activities" | "audit", records: unknown[]) {
      if (current !== stage) {
        if (current === "audit" || current === null && stage !== "activities") throw new Error("Invalid export order");
        chunks.push(stage === "activities" ? ',"activities":[' : '],"audit":[');
        current = stage; hasRecords = false;
      }
      if (records.length) { if (hasRecords) chunks.push(","); chunks.push(JSON.stringify(records).slice(1,-1)); hasRecords = true; }
    },
    finish() {
      if (current !== "audit") throw new Error("Incomplete export");
      return [...chunks, "]}"];
    },
  };
}
