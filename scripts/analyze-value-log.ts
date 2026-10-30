import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildValueLogAnalysis, type AnalysisInput } from "../src/lib/value-log-analysis";
import { renderValueLogAnalysis } from "../src/lib/value-log-analysis-format";
import { buildValueLogAnalysisQuery } from "../src/lib/value-log-analysis-query";

type Options = { asOf: string; period: "week" | "month" | "both"; format: "text" | "json"; output?: string };

export function parseAnalysisArgs(args: string[], today = todayInIndia()): Options {
  const options: Options = { asOf: today, period: "both", format: "text" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--help" || flag === "-h") throw new HelpRequested();
    if (!["--as-of", "--period", "--format", "--output"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--as-of") options.asOf = value;
    if (flag === "--period") {
      if (!(["week", "month", "both"] as string[]).includes(value)) throw new Error("--period must be week, month, or both");
      options.period = value as Options["period"];
    }
    if (flag === "--format") {
      if (!(["text", "json"] as string[]).includes(value)) throw new Error("--format must be text or json");
      options.format = value as Options["format"];
    }
    if (flag === "--output") options.output = value;
    index += 1;
  }
  return options;
}

export function extractAnalysisPayload(output: string): AnalysisInput {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("Supabase returned no analysis data.");
  const candidates = [trimmed, ...trimmed.split("\n").filter(Boolean).reverse()];
  for (const candidate of candidates) {
    try {
      const found = findPayload(JSON.parse(candidate));
      if (found) return found;
    } catch { /* Continue through JSON/NDJSON candidates. */ }
  }
  throw new Error("Supabase query output did not contain the expected analysis payload.");
}

export function outputPathIsSafe(path: string, repoRoot: string) {
  const absolute = resolve(path);
  const relation = relative(repoRoot, absolute);
  if (relation === ".git" || relation.startsWith(`.git${process.platform === "win32" ? "\\" : "/"}`)) return false;
  if (relation.startsWith("..") || isAbsolute(relation)) return true;
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", absolute], { cwd: repoRoot });
  return ignored.status === 0;
}

function main() {
  try {
    const options = parseAnalysisArgs(process.argv.slice(2));
    const repoRoot = realpathSync(resolve(import.meta.dirname, ".."));
    const config = resolve(repoRoot, "supabase/config.toml");
    const linkedRef = resolve(repoRoot, "supabase/.temp/project-ref");
    if (!existsSync(config)) throw new Error("Supabase is not initialized. Expected supabase/config.toml.");
    if (!existsSync(linkedRef)) throw new Error("Supabase is not linked. Run `npx supabase login` and `npx supabase link --project-ref <project-ref>` first.");
    if (options.output && !outputPathIsSafe(options.output, repoRoot)) {
      throw new Error("Refusing to write a private report to a tracked or unignored repository path. Use stdout, /tmp, or an ignored path.");
    }
    const query = buildValueLogAnalysisQuery(options.asOf);
    const result = spawnSync("npx", ["--no-install", "supabase", "db", "query", "--linked", "--output-format", "json", query], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(safeSupabaseError(result.stderr || result.stdout));
    const input = extractAnalysisPayload(result.stdout);
    const analysis = buildValueLogAnalysis(input, options.asOf);
    const selected = options.period === "both" ? analysis : {
      ...analysis,
      periods: { [options.period]: analysis.periods[options.period] },
      comparisons: options.period === "week" ? analysis.comparisons : undefined,
    };
    const content = options.format === "json" ? `${JSON.stringify(selected, null, 2)}\n` : renderValueLogAnalysis(analysis, options.period);
    if (options.output) {
      const destination = resolve(options.output);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { encoding: "utf8", mode: 0o600 });
      process.stdout.write(`Private analysis written to ${destination}\n`);
    } else process.stdout.write(content);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(helpText());
      return;
    }
    process.stderr.write(`Value Log analysis failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function findPayload(value: unknown): AnalysisInput | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return findPayload(JSON.parse(value)); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findPayload(item); if (found) return found; }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.schema_version === "value-log-analysis-input-v1") return record as AnalysisInput;
    if ("value_log_analysis" in record) return findPayload(record.value_log_analysis);
    for (const item of Object.values(record)) { const found = findPayload(item); if (found) return found; }
  }
  return null;
}

function safeSupabaseError(value: string) {
  const line = value.split("\n").find((item) => /not logged|not linked|unauthorized|forbidden|error/i.test(item));
  return line?.trim() || "Supabase read-only query failed. Confirm CLI login and the linked project.";
}
function todayInIndia() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function helpText() { return `Usage: npm run analyze:value-log -- [options]\n\n  --as-of YYYY-MM-DD       Analysis end date in Asia/Kolkata\n  --period week|month|both Default: both\n  --format text|json       Default: text\n  --output PATH            Optional private output; tracked paths are rejected\n`; }
class HelpRequested extends Error {}

if (process.env.NODE_ENV !== "test") main();
