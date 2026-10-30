// Loads a Value Log export (zip/folder with manifest, or a single records CSV) into the local
// Logos Storage node for demos. Each exported table is stored as one encrypted object; records are
// also stored per day.
// Current records are grouped by local day, encrypted with a demo key kept in .logos-storage/
// (never the production key) and uploaded through the mirror's own helpers. A local index maps
// each day to its CID; owner ids are dropped before encryption.
//   npm run logos:import -- ~/Downloads/moses-value-log-export-2026-10-29.zip
//   npm run logos:import -- ~/Downloads/moses-value-log-records-2026-10-29.csv
//   npm run logos:records                 # list stored days
//   npm run logos:records -- 2026-07-03   # fetch, decrypt and show one day
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCsv } from "../src/lib/logos-demo-csv";
import { decryptNarrative, encryptNarrative, narrativeDigest } from "../src/lib/crypto";
import { deleteFromNode, logosStorageConfig, mirrorEnvelope, uploadToNode } from "../src/lib/native-log/mirror";

process.env.LOGOS_STORAGE_URL ||= "http://127.0.0.1:8080/api/storage/v1";
const root = resolve(".logos-storage"), keyFile = resolve(root, "demo-key.json"), indexFile = resolve(root, "demo-records.json"), tablesFile = resolve(root, "demo-tables.json");
mkdirSync(root, { recursive: true });
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify({ encryption: randomBytes(32).toString("base64"), digest: randomBytes(32).toString("hex") }), { mode: 0o600 });
const keys = JSON.parse(readFileSync(keyFile, "utf8"));
process.env.NARRATIVE_ENCRYPTION_KEY_BASE64 = keys.encryption;
process.env.AUDIT_DIGEST_KEY = keys.digest;

type DayEntry = { cid: string; records: number; digest: string; uploadedAt: string };
type Index = Record<string, DayEntry>;
const config = logosStorageConfig()!;
const readIndex = (): Index => existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : {};
const writeIndex = (index: Index) => writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n", { mode: 0o600 });


// Display fields only; owner and internal link ids stay out of the stored copy.
const kept = ["id", "start_at", "end_at", "timezone", "activity", "wellbeing_node", "slice_type", "community", "impact_direction", "impact_intensity", "confidence", "status", "revision_number", "skill_level", "sao_lane", "founder_performance_impact", "proof"];
const localDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const encryptToNode = (plaintext: string) => {
  const sealed = encryptNarrative(plaintext);
  return uploadToNode(config, mirrorEnvelope({ content_ciphertext: sealed.ciphertext, content_iv: sealed.iv, content_auth_tag: sealed.authTag, content_key_version: sealed.keyVersion }));
};
const onNode = async (cid: string) => (await fetch(`${config.base}/data/${cid}`, { headers: config.headers })).ok;
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
// moses-w-transitions-2026-10-29.csv → w_transitions; the records export is canonical_slices.
const tableName = (file: string) => {
  const name = basename(file).replace(/\.csv$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/^[a-z]+-/, "");
  return name === "value-log-records" ? "canonical_slices" : name.replaceAll("-", "_");
};

async function importExport(input: string) {
  const path = resolve(input.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (!existsSync(path)) throw new Error(`Not found: ${path}`);
  if (path.endsWith(".csv")) return importDays(parseCsv(readFileSync(path, "utf8")));
  let dir = path, temp: string | null = null;
  if (!statSync(path).isDirectory()) {
    temp = mkdtempSync(join(tmpdir(), "logos-import-")); chmodSync(temp, 0o700);
    if (spawnSync("unzip", ["-q", "-o", path, "-d", temp]).status !== 0) throw new Error("Could not unzip the export");
    dir = temp;
  }
  try {
    const files = readdirSync(dir, { recursive: true }).map(String).map((name) => join(dir, name)).filter((file) => statSync(file).isFile());
    const manifestFile = files.find((file) => /manifest.*\.json$/.test(file));
    if (!manifestFile) throw new Error("Export has no manifest");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { snapshot_at?: string; files: { name: string; rows: number; sha256: string }[] };
    const tables = existsSync(tablesFile) ? JSON.parse(readFileSync(tablesFile, "utf8")) as Record<string, { cid: string; rows: number; sha256: string }> : {};
    let recordsRows: Record<string, string>[] = [];
    console.log(`Export snapshot ${manifest.snapshot_at ?? "unknown"}: ${manifest.files.length} files → ${config.base}`);
    for (const entry of manifest.files) {
      const file = files.find((candidate) => basename(candidate) === entry.name);
      if (!file) throw new Error(`Missing ${entry.name}`);
      const content = readFileSync(file);
      if (sha256(content) !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.name}`);
      const text = content.toString("utf8"), table = tableName(entry.name), rows = parseCsv(text);
      if (rows.length !== entry.rows) throw new Error(`${entry.name}: manifest says ${entry.rows} rows, parsed ${rows.length}`);
      if (table === "canonical_slices") recordsRows = rows;
      if (tables[table]?.sha256 === entry.sha256 && await onNode(tables[table].cid)) { console.log(`  ${table.padEnd(32)} ${String(rows.length).padStart(4)} rows  unchanged`); continue; }
      const cid = await encryptToNode(text);
      if (tables[table] && tables[table].cid !== cid) await deleteFromNode(config, tables[table].cid).catch(() => undefined);
      tables[table] = { cid, rows: rows.length, sha256: entry.sha256 };
      writeFileSync(tablesFile, JSON.stringify(tables, null, 2) + "\n", { mode: 0o600 });
      console.log(`  ${table.padEnd(32)} ${String(rows.length).padStart(4)} rows  ${cid}`);
    }
    if (recordsRows.length) await importDays(recordsRows);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

async function importDays(rows: Record<string, string>[]) {
  if (!rows.length || !("start_at" in rows[0]) || !("activity" in rows[0])) throw new Error("Not a value-log records export (missing start_at/activity)");
  const current = rows.filter(r => r.is_current !== "False" && r.status !== "superseded" && r.start_at);
  const days = new Map<string, Record<string, string>[]>();
  for (const r of current) {
    const date = localDate(r.start_at, r.timezone || "Asia/Kolkata");
    const record = Object.fromEntries(kept.filter(k => r[k]).map(k => [k, r[k]]));
    days.set(date, [...(days.get(date) ?? []), record]);
  }
  console.log(`${rows.length} rows, ${current.length} current records across ${days.size} days → ${config.base}`);
  const index = readIndex(); let uploaded = 0, unchanged = 0;
  for (const [date, records] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    records.sort((a, b) => a.start_at.localeCompare(b.start_at));
    const plaintext = JSON.stringify({ date, records });
    const digest = narrativeDigest(plaintext);
    if (index[date]?.digest === digest && await onNode(index[date].cid)) { unchanged++; continue; }
    const cid = await encryptToNode(plaintext);
    if (index[date]) await deleteFromNode(config, index[date].cid).catch(() => undefined);
    index[date] = { cid, records: records.length, digest, uploadedAt: new Date().toISOString() };
    writeIndex(index); uploaded++;
    process.stdout.write(`\r  uploaded ${uploaded} day(s)…`);
  }
  console.log(`\n${uploaded} day(s) uploaded, ${unchanged} unchanged. Index: ${indexFile}`);
  console.log("Show one: npm run logos:records -- <YYYY-MM-DD>");
}

async function list() {
  const entries = Object.entries(readIndex()).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return console.log("No records stored yet. Run: npm run logos:import -- <export.csv>");
  for (const [date, e] of entries) console.log(`${date}  ${String(e.records).padStart(3)} records  ${e.cid}`);
  console.log(`${entries.length} days, ${entries.reduce((n, [, e]) => n + e.records, 0)} records on ${config.base}`);
}

async function show(date: string) {
  const entry = readIndex()[date];
  if (!entry) throw new Error(`No stored day ${date}. Run npm run logos:records to list days.`);
  const response = await fetch(`${config.base}/data/${entry.cid}`, { headers: config.headers });
  if (!response.ok) throw new Error(`Node returned ${response.status} for ${entry.cid}`);
  const envelope = JSON.parse(await response.text());
  console.log(`CID ${entry.cid}\nOn the node: ${envelope.ciphertext.slice(0, 64)}…\n`);
  const day = JSON.parse(decryptNarrative(envelope)) as { date: string; records: Record<string, string>[] };
  const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  console.log(`${day.date} — ${day.records.length} records (decrypted locally)`);
  for (const r of day.records) {
    const tz = r.timezone || "Asia/Kolkata";
    const impact = [r.impact_direction, r.impact_intensity].filter(Boolean).join(" ");
    console.log(`  ${time(r.start_at, tz)}–${r.end_at ? time(r.end_at, tz) : "?"}  ${(r.wellbeing_node ?? "").padEnd(11)} ${r.activity}${impact ? `  (${impact})` : ""}`);
  }
}

const [command, arg] = process.argv.slice(2);
try {
  const up = await fetch(`${config.base}/space`, { headers: config.headers }).catch(() => null);
  if (!up?.ok) throw new Error(`No node at ${config.base}. Start it first: npm run logos:node`);
  if (command === "import") { if (!arg) throw new Error("Usage: npm run logos:import -- <export.zip | export folder | records.csv>"); await importExport(arg); }
  else if (arg) await show(arg);
  else await list();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
