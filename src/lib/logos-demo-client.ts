import "server-only";
// Local demo only: a stand-in for the Supabase client over a Value Log export stored (encrypted) on the
// local Logos Storage node by `npm run logos:import`. Exported tables are read-only; rows the app writes
// (native voice drafts, submitted records, audit events) live in a local overlay that is saved, encrypted,
// back to the node after every change. The native-log RPCs mirror their SQL rules; calculation does not run.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "./logos-demo-csv";
import { logosDemoActive, logosDemoDelete, logosDemoEnabled, logosDemoFetch, logosDemoStore } from "./logos-demo";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Result = { data: unknown; error: null | { message: string }; count: number | null };

const storageDir = () => resolve(process.cwd(), ".logos-storage");
const tablesFile = () => resolve(storageDir(), "demo-tables.json");
const writesFile = () => resolve(storageDir(), "demo-writes.json");
const numeric = new Set(["w_before", "w_after", "delta_w", "vcperformance_event_amount", "pre_slice_w", "post_slice_w", "applied_change", "formula_result", "baseline_wellbeing_score", "revision_number", "version", "display_order"]);
const sliceRelation = ["id", "start_at", "end_at", "timezone", "activity", "wellbeing_node", "slice_type", "community", "sao_lane", "skill_level", "status"];

function typed(row: Record<string, string>): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === "") return [key, null];
    if (numeric.has(key)) return [key, Number(value)];
    if (value === "True" || value === "true") return [key, true];
    if (value === "False" || value === "false") return [key, false];
    if (key === "evidence" && /^[[{]/.test(value)) { try { return [key, JSON.parse(value)]; } catch { return [key, value]; } }
    return [key, value];
  }));
}

type State = { mtime: number; tables: Tables; local: Tables };
let state: State | null = null;
let loading: Promise<State> | null = null;

async function loadState(): Promise<State> {
  const file = tablesFile();
  if (!existsSync(file)) throw new Error("LOGOS_DEMO_NOT_IMPORTED");
  const mtime = statSync(file).mtimeMs;
  if (state?.mtime === mtime) return state;
  loading ??= (async () => {
    const index = JSON.parse(readFileSync(file, "utf8")) as Record<string, { cid: string }>;
    const raw: Tables = {};
    await Promise.all(Object.entries(index).map(async ([table, entry]) => { raw[table] = parseCsv(await logosDemoFetch(entry.cid)).map(typed); }));
    const local: Tables = existsSync(writesFile())
      ? (JSON.parse(await logosDemoFetch((JSON.parse(readFileSync(writesFile(), "utf8")) as { cid: string }).cid)) as { tables: Tables }).tables
      : {};
    const slices = [...(raw.canonical_slices ?? []), ...(local.canonical_slices ?? [])];
    const byId = new Map(slices.map((slice) => [slice.id as string, slice]));
    const relation = (id: unknown) => {
      const slice = byId.get(id as string);
      return slice ? Object.fromEntries(sliceRelation.map((key) => [key, slice[key] ?? null])) : null;
    };
    const completed = { status: "completed" };
    const baseline = raw.current_promoted_founder_replay?.[0];
    const tables: Tables = {
      validation_events: [], draft_slices: [], replay_runs: [], intake_sessions: [], observer_events: [], audit_events: [], native_log_drafts: [],
      ...raw,
      canonical_slices: slices,
      w_transitions: (raw.w_transitions ?? []).map((row) => ({ ...row, canonical_slices: relation(row.canonical_slice_id), replay_runs: completed })),
      credit_events: (raw.credit_events ?? []).map((row) => ({ ...row, canonical_slices: relation(row.canonical_slice_id), replay_runs: completed })),
      founder_wellbeing_value_events: (raw.founder_wellbeing_value_events ?? []).map((row) => ({ ...row, replay_run_id: baseline?.replay_run_id ?? null, canonical_slices: relation(row.canonical_slice_id) })),
    };
    // Local rows are shared by reference so in-place updates reach the overlay that gets persisted.
    for (const [table, rows] of Object.entries(local)) if (table !== "canonical_slices") tables[table] = [...(raw[table] ?? []), ...rows];
    state = { mtime, tables, local };
    return state;
  })().finally(() => { loading = null; });
  return loading;
}

const currentSlices = (tables: Tables) => tables.canonical_slices.filter((slice) => slice.is_current !== false && slice.status !== "superseded");

let saving: Promise<void> = Promise.resolve();
function persist(current: State) {
  saving = saving.then(async () => {
    const previous = existsSync(writesFile()) ? (JSON.parse(readFileSync(writesFile(), "utf8")) as { cid: string }).cid : null;
    const cid = await logosDemoStore(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), tables: current.local }));
    writeFileSync(writesFile(), JSON.stringify({ cid, savedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
    if (previous && previous !== cid) await logosDemoDelete(previous).catch(() => undefined);
  }).catch((error) => { console.warn("logos demo: could not save local writes", error instanceof Error ? error.message : error); });
  return saving;
}

function addLocal(current: State, table: string, row: Row) {
  (current.local[table] ??= []).push(row);
  if (table === "canonical_slices") current.tables.canonical_slices.push(row);
  else (current.tables[table] ??= []).push(row);
}

function valueAt(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (Array.isArray(value)) value = value[0];
    return value && typeof value === "object" ? (value as Row)[key] : undefined;
  }, row);
}

const isTimestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);
function compare(left: unknown, right: unknown) {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : -1;
  if (right === null || right === undefined) return 1;
  if (isTimestamp(left) && isTimestamp(right)) return Date.parse(left as string) - Date.parse(right as string);
  if (typeof left === "number" || typeof right === "number") return Number(left) - Number(right);
  return String(left).localeCompare(String(right));
}

class DemoQuery implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private wantsCount = false;
  private headOnly = false;
  private write: { kind: "insert" | "upsert" | "update" | "delete"; values?: Row | Row[]; onConflict?: string; ignoreDuplicates?: boolean } | null = null;

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) { this.wantsCount = Boolean(options?.count); this.headOnly = Boolean(options?.head); return this; }
  insert(values: Row | Row[]) { this.write = { kind: "insert", values }; return this; }
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.write = { kind: "upsert", values, ...options }; return this; }
  update(values: Row) { this.write = { kind: "update", values }; return this; }
  delete() { this.write = { kind: "delete" }; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => compare(valueAt(row, column), value) === 0 || String(valueAt(row, column)) === String(value)); return this; }
  neq(column: string, value: unknown) { this.filters.push((row) => String(valueAt(row, column)) !== String(value)); return this; }
  gt(column: string, value: unknown) { this.filters.push((row) => compare(valueAt(row, column), value) > 0); return this; }
  gte(column: string, value: unknown) { this.filters.push((row) => compare(valueAt(row, column), value) >= 0); return this; }
  lt(column: string, value: unknown) { this.filters.push((row) => compare(valueAt(row, column), value) < 0); return this; }
  lte(column: string, value: unknown) { this.filters.push((row) => compare(valueAt(row, column), value) <= 0); return this; }
  in(column: string, values: unknown[]) { const set = new Set(values.map(String)); this.filters.push((row) => set.has(String(valueAt(row, column)))); return this; }
  is(column: string, value: unknown) { this.filters.push((row) => (valueAt(row, column) ?? null) === value); return this; }
  not(column: string, operator: string, value: unknown) {
    this.filters.push((row) => operator === "is" ? (valueAt(row, column) ?? null) !== value : String(valueAt(row, column)) !== String(value));
    return this;
  }
  ilike(column: string, pattern: string) { const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("%", ".*")}$`, "i"); this.filters.push((row) => re.test(String(valueAt(row, column) ?? ""))); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending ?? true }); return this; }
  limit(count: number) { this.window = [0, count - 1]; return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private shape(rows: Row[], count: number | null): Result {
    if (this.headOnly) return { data: null, error: null, count };
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null, count: null } : { data: null, error: { message: "NOT_SINGLE" }, count: null };
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null, count: null };
    return { data: rows, error: null, count: this.wantsCount ? count : null };
  }

  private async applyWrite(current: State): Promise<Result> {
    const write = this.write!;
    const rows = this.table === "current_time_slices" ? currentSlices(current.tables) : (current.tables[this.table] ??= []);
    let affected: Row[] = [];
    if (write.kind === "insert" || write.kind === "upsert") {
      const keys = (write.onConflict ?? "id").split(",").map((key) => key.trim());
      for (const value of [write.values ?? []].flat()) {
        const existing = write.kind === "upsert" ? rows.find((row) => keys.every((key) => String(row[key]) === String(value[key]))) : undefined;
        if (existing) { if (!write.ignoreDuplicates) Object.assign(existing, value); affected.push(existing); continue; }
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...value };
        addLocal(current, this.table, row);
        affected.push(row);
      }
    } else {
      affected = rows.filter((row) => this.filters.every((keep) => keep(row)));
      const localRows = new Set(current.local[this.table] ?? []);
      if (affected.some((row) => !localRows.has(row))) return { data: null, error: { message: "LOGOS_DEMO_EXPORT_READ_ONLY" }, count: null };
      if (write.kind === "update") for (const row of affected) Object.assign(row, write.values);
      else {
        current.local[this.table] = (current.local[this.table] ?? []).filter((row) => !affected.includes(row));
        current.tables[this.table] = rows.filter((row) => !affected.includes(row));
      }
    }
    await persist(current);
    return this.shape(affected, affected.length);
  }

  private async run(): Promise<Result> {
    const current = await loadState();
    if (this.write) return this.applyWrite(current);
    const source = this.table === "current_time_slices" ? currentSlices(current.tables) : current.tables[this.table] ?? [];
    let rows = source.filter((row) => this.filters.every((keep) => keep(row)));
    for (const { column, ascending } of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * compare(valueAt(a, column), valueAt(b, column)));
    const count = rows.length;
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    return this.shape(rows, count);
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(onfulfilled, onrejected);
  }
}

// Native voice-log RPCs, following supabase/migrations/202610250002_native_voice_logging.sql.
type Args = Record<string, unknown>;
class RpcError extends Error {}
const leaseActive = (row: Row) => typeof row.lease_until === "string" && Date.parse(row.lease_until) > Date.now();

const rpcs: Record<string, (current: State, args: Args) => unknown> = {
  consume_ingestion_rate_limit: () => true,
  pending_native_log_mirrors: () => [],
  stale_native_log_mirrors: () => [],
  save_native_log_draft(current, { p_owner, p_id, p_revision, p_content, p_lease }) {
    const content = p_content as Row;
    const drafts = current.tables.native_log_drafts;
    const row = drafts.find((draft) => draft.owner_id === p_owner && draft.id === p_id);
    if (row) {
      if (row.status !== "draft") throw new RpcError("NATIVE_DRAFT_CLOSED");
      if (row.revision === Number(p_revision) + 1 && row.content_digest === content.digest) return row.revision;
      if (row.revision !== p_revision) throw new RpcError("REVISION_CONFLICT");
      if (p_lease != null && row.lease_token !== p_lease) throw new RpcError("REVISION_CONFLICT");
      if (p_lease == null && leaseActive(row)) throw new RpcError("PROCESSING_BUSY");
    } else if (p_revision !== 0 || p_lease != null) throw new RpcError("REVISION_CONFLICT");
    if (!content?.ciphertext || !content.iv || !content.authTag || !content.keyVersion || !/^[a-f0-9]{64}$/.test(String(content.digest))) throw new RpcError("INVALID_INPUT");
    const now = new Date().toISOString(), next = Number(p_revision) + 1;
    const values = { revision: next, content_ciphertext: content.ciphertext, content_iv: content.iv, content_auth_tag: content.authTag, content_key_version: content.keyVersion, content_digest: content.digest, lease_token: null, lease_until: null, updated_at: now };
    if (row) Object.assign(row, values);
    else addLocal(current, "native_log_drafts", { owner_id: p_owner, id: p_id, status: "draft", receipt: null, intake_session_id: null, created_at: now, submitted_at: null, removed_at: null, ...values });
    return next;
  },
  reserve_native_log_processing(current, { p_owner, p_id, p_revision }) {
    const row = current.tables.native_log_drafts.find((draft) => draft.owner_id === p_owner && draft.id === p_id);
    if (!row || row.status !== "draft") throw new RpcError("NATIVE_DRAFT_CLOSED");
    if (row.revision !== p_revision) throw new RpcError("REVISION_CONFLICT");
    if (leaseActive(row)) throw new RpcError("PROCESSING_BUSY");
    row.lease_token = randomUUID();
    row.lease_until = new Date(Date.now() + 75_000).toISOString();
    return row.lease_token;
  },
  release_native_log_processing(current, { p_owner, p_id, p_token }) {
    const row = current.tables.native_log_drafts.find((draft) => draft.owner_id === p_owner && draft.id === p_id && draft.lease_token === p_token);
    if (row) { row.lease_token = null; row.lease_until = null; }
    return null;
  },
  remove_native_log_draft(current, { p_owner, p_id, p_revision }) {
    const row = current.tables.native_log_drafts.find((draft) => draft.owner_id === p_owner && draft.id === p_id);
    if (!row) throw new RpcError("UNAUTHORIZED");
    if (row.status === "removed") return true;
    if (row.revision !== p_revision) throw new RpcError("REVISION_CONFLICT");
    Object.assign(row, { status: "removed", content_ciphertext: null, content_iv: null, content_auth_tag: null, content_key_version: null, lease_token: null, lease_until: null, removed_at: new Date().toISOString(), updated_at: new Date().toISOString(), revision: Number(row.revision) + 1 });
    addLocal(current, "audit_events", { owner_id: p_owner, actor_id: p_owner, actor_type: "observer", event_type: "native_log_draft_removed", entity_type: "native_log_draft", entity_id: String(p_id), metadata: {} });
    return true;
  },
  confirm_native_log(current, { p_owner, p_id, p_revision, p_digest, p_mode, p_entries, p_narrative, p_confirmation, p_receipt }) {
    const row = current.tables.native_log_drafts.find((draft) => draft.owner_id === p_owner && draft.id === p_id);
    if (!row || row.status === "removed") throw new RpcError("NATIVE_DRAFT_CLOSED");
    if (row.status === "submitted") return row.receipt;
    if (row.revision !== p_revision || row.content_digest !== p_digest) throw new RpcError("REVISION_CONFLICT");
    if (leaseActive(row)) throw new RpcError("PROCESSING_BUSY");
    const entries = p_entries as Row[], receipt = p_receipt as Row, narrative = p_narrative as Row;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 30 || typeof p_confirmation !== "string" || !p_confirmation.length || p_confirmation.length > 500 || !receipt || typeof receipt !== "object") throw new RpcError("INVALID_INPUT");
    if (p_mode !== "pilot") throw new RpcError("UNAUTHORIZED");
    const now = new Date().toISOString(), intake = randomUUID();
    addLocal(current, "intake_sessions", { id: intake, owner_id: p_owner, source: "native_voice", parser_version: "native-sarvam-v1", idempotency_key: `native:${p_owner}:${p_id}`, timezone: receipt.timezone, narrative_ciphertext: narrative?.ciphertext, narrative_iv: narrative?.iv, narrative_auth_tag: narrative?.authTag, narrative_key_version: narrative?.keyVersion, narrative_digest: narrative?.digest, created_at: now });
    for (const entry of entries) {
      const fields = { owner_id: p_owner, start_at: entry.start_at, end_at: entry.end_at, timezone: entry.timezone, activity: entry.activity, proof: entry.proof ?? null, wellbeing_node: entry.wellbeing_node, slice_type: entry.slice_type, community: entry.community, sao_lane: entry.sao_lane ?? null, native_skill_level: entry.native_skill_level ?? null, impact_direction: entry.impact_direction ?? null, impact_intensity: entry.impact_intensity ?? null, confidence: entry.confidence ?? null, activity_occurrence_id: entry.activity_occurrence_id ?? null, created_at: now };
      addLocal(current, "draft_slices", { id: entry.draft_id, intake_session_id: intake, machine_source: "native_voice", status: "approved", ...fields });
      addLocal(current, "canonical_slices", { id: entry.id, protocol_link_id: entry.protocol_link_id, revision_number: 1, draft_slice_id: entry.draft_id, status: "validation_pending", is_current: true, ...fields });
      addLocal(current, "observer_events", { id: randomUUID(), draft_slice_id: entry.draft_id, canonical_slice_id: entry.id, owner_id: p_owner, actor_id: p_owner, decision: "approved", rationale: `Confirmed in Value Log: ${p_confirmation}`, created_at: now });
    }
    const result = { ...receipt, intakeId: intake };
    Object.assign(row, { status: "submitted", submitted_at: now, updated_at: now, revision: Number(row.revision) + 1, lease_token: null, lease_until: null, receipt: result, intake_session_id: intake });
    addLocal(current, "audit_events", { owner_id: p_owner, actor_id: p_owner, actor_type: "observer", event_type: "native_log_confirmed", entity_type: "native_log_draft", entity_id: String(p_id), metadata: { revision: p_revision, count: entries.length, mode: p_mode, confirmation_channel: "native_value_log" }, created_at: now });
    return result;
  },
  // The founder rate table is not exported: use the latest recognised level recorded for this community and lane.
  resolve_founder_flat_community_rate(current, { p_community, p_route }) {
    const level = [...current.tables.canonical_slices]
      .filter((slice) => slice.community === p_community && slice.sao_lane === p_route && (slice.native_skill_level || slice.skill_level))
      .sort((a, b) => compare(b.start_at, a.start_at))[0];
    return level ? [{ native_level: level.native_skill_level ?? level.skill_level, protocol_finality_status: "final" }] : [];
  },
};

async function callRpc(name: string, args: Args = {}): Promise<Result> {
  const handler = rpcs[name];
  if (!handler) return { data: null, error: { message: `LOGOS_DEMO_UNSUPPORTED:${name}` }, count: null };
  const current = await loadState();
  try {
    const data = handler(current, args);
    if (name !== "consume_ingestion_rate_limit" && !name.endsWith("_mirrors") && name !== "resolve_founder_flat_community_rate") await persist(current);
    return { data, error: null, count: null };
  } catch (error) {
    if (error instanceof RpcError) return { data: null, error: { message: error.message }, count: null };
    throw error;
  }
}

function demoClient(user?: { id: string; email: string }) {
  return {
    from: (table: string) => new DemoQuery(table),
    rpc: (name: string, args?: Args) => callRpc(name, args),
    auth: { getUser: async () => ({ data: { user: user ?? null }, error: user ? null : { message: "UNAUTHORIZED" } }) },
  } as unknown as SupabaseClient;
}

/** Service-role stand-in for server code (`adminClient()`) in the local demo. */
export function logosDemoAdminClient() {
  return demoClient();
}

/** A pilot (founder) session whose client reads the Logos-stored export. */
export async function logosDemoClient() {
  const owner = (await loadState()).tables.canonical_slices.find((slice) => slice.owner_id)?.owner_id;
  const user = { id: String(owner ?? "00000000-0000-4000-8000-000000000000"), email: "demo@logos.local" };
  return { client: demoClient(user), user };
}

// Lets the worker-safe adminClient() fall back to this store when Supabase is not configured.
if (logosDemoEnabled()) (globalThis as { __valueLogDemoAdmin?: () => SupabaseClient }).__valueLogDemoAdmin = () => { logosDemoActive(); return logosDemoAdminClient(); };
