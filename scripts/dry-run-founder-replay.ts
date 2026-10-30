import { existsSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildFounderReplayDryRunReport,
  renderFounderReplayDryRunReport,
  type FounderReplayDryRunInput,
} from "../src/lib/founder-replay-report";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function outputPathIsSafe(path: string, repoRoot: string) {
  const absolute = resolve(path);
  const relation = relative(repoRoot, absolute);
  if (relation === ".git" || relation.startsWith(`.git${process.platform === "win32" ? "\\" : "/"}`)) return false;
  if (relation.startsWith("..") || isAbsolute(relation)) return true;
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--no-index", absolute], { cwd: repoRoot });
  return ignored.status === 0;
}

const inputPath = argument("--input");
const outputPath = argument("--output");
const markdownOutputPath = argument("--markdown-output");
if (!inputPath || !outputPath) throw new Error("Usage: npm run dry-run:founder-replay -- --input PRIVATE_JSON --output PRIVATE_JSON");
if (!existsSync(inputPath)) throw new Error(`Dry-run input does not exist: ${inputPath}`);
const repoRoot = realpathSync(resolve(import.meta.dirname, ".."));
if (!outputPathIsSafe(outputPath, repoRoot)) throw new Error("Refusing to write a private replay report to a tracked repository path");

const input = JSON.parse(readFileSync(inputPath, "utf8")) as FounderReplayDryRunInput;
const report = buildFounderReplayDryRunReport(input);
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
if (markdownOutputPath) {
  if (!outputPathIsSafe(markdownOutputPath, repoRoot)) throw new Error("Refusing to write a private replay report to a tracked repository path");
  writeFileSync(markdownOutputPath, renderFounderReplayDryRunReport(report), { encoding: "utf8", mode: 0o600 });
}
process.stdout.write(`Read-only founder replay report written to ${resolve(outputPath)}\n`);
process.stdout.write(`Input SHA-256: ${report.inputSha256}\n`);
process.stdout.write(`Ending W: ${report.previous.endingW} -> ${report.corrected.endingW}\n`);
