// Offline data layer: keeps a local IndexedDB snapshot of library tables and an
// outbox of pending changes that is replayed to Supabase when back online.
// Server-side RLS still validates every replayed change.
import { supabase } from "@/integrations/supabase/client";

export type TableName = "books" | "categories" | "students" | "book_issues" | "fines";
export const TABLES: TableName[] = ["books", "categories", "students", "book_issues", "fines"];
type Row = Record<string, unknown> & { id: number };
export type Snapshot = Record<TableName, Row[]>;

export type Op =
  | { kind: "insert"; table: TableName; values: Record<string, unknown>; tempId: number }
  | { kind: "update"; table: TableName; values: Record<string, unknown>; col: string; val: unknown }
  | { kind: "delete"; table: TableName; col: string; val: unknown };
type QueuedOp = Op & { qid: number };

const DB_NAME = "library-pro-offline";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// The signed-in user id is cached in memory so offline reads/writes never wait
// on Supabase's token refresh (which retries slowly without a network).
let currentUserId: string | null = null;
export function setOfflineUser(id: string | null) { currentUserId = id; }
const scopeKey = async (k: string) => {
  if (!currentUserId) {
    const { data } = await supabase.auth.getSession();
    currentUserId = data.session?.user.id ?? null;
  }
  return `${currentUserId ?? "anon"}:${k}`;
};

/** Abort slow requests so a weak connection falls back to offline quickly. */
function withTimeout<T>(p: PromiseLike<T>, ms = 6000): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("network timeout")), ms))]);
}
const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

const emptySnap = (): Snapshot => ({ books: [], categories: [], students: [], book_issues: [], fines: [] });
export async function readSnapshot(): Promise<Snapshot | null> {
  return (await idbGet<Snapshot>(await scopeKey("snapshot"))) ?? null;
}
export async function writeSnapshot(s: Snapshot) { await idbSet(await scopeKey("snapshot"), s); }
async function readQueue(): Promise<QueuedOp[]> { return (await idbGet<QueuedOp[]>(await scopeKey("outbox"))) ?? []; }
async function writeQueue(q: QueuedOp[]) {
  await idbSet(await scopeKey("outbox"), q);
  emit();
}

// ---- status subscription ----
type Status = { pending: number; syncing: boolean };
let status: Status = { pending: 0, syncing: false };
const listeners = new Set<(s: Status) => void>();
function emit() {
  void readQueue().then((q) => { status = { ...status, pending: q.length }; listeners.forEach((l) => l(status)); });
}
export function subscribeSync(fn: (s: Status) => void) {
  listeners.add(fn); fn(status); emit();
  return () => { listeners.delete(fn); };
}
const dataListeners = new Set<() => void>();
export function onSynced(fn: () => void) { dataListeners.add(fn); return () => { dataListeners.delete(fn); }; }

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String((e as { message?: string })?.message ?? e ?? "");
  return /fetch|network|load failed|timeout/i.test(msg);
}

function applyOp(s: Snapshot, op: Op) {
  const rows = s[op.table];
  if (op.kind === "insert") rows.unshift({ ...op.values, id: op.tempId } as Row);
  else if (op.kind === "update") s[op.table] = rows.map((r) => (r[op.col] === op.val ? { ...r, ...op.values } : r));
  else s[op.table] = rows.filter((r) => r[op.col] !== op.val);
}

async function sendOp(op: Op): Promise<{ error: { message: string } | null; id?: number | undefined }> {
  const t = supabase.from(op.table) as never as {
    insert: (v: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: number } | null; error: { message: string } | null }> } };
    update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> };
    delete: () => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> };
  };
  if (op.kind === "insert") {
    const r = await t.insert(op.values).select("id").single();
    return { error: r.error, id: r.data?.id };
  }
  if (op.kind === "update") return t.update(op.values).eq(op.col, op.val);
  return t.delete().eq(op.col, op.val);
}

let tempCounter = -Date.now();
export const newTempId = () => --tempCounter;

/** Run a change now if possible, otherwise save it locally and queue it. */
export async function mutate(op: Op): Promise<{ error: { message: string } | null; queued?: boolean }> {
  const queue = await readQueue();
  if (isOnline() && queue.length === 0) {
    try {
      const r = await withTimeout(sendOp(op));
      if (!r.error) {
        const snap = (await readSnapshot()) ?? emptySnap();
        applyOp(snap, op.kind === "insert" ? { ...op, tempId: r.id ?? op.tempId } : op);
        await writeSnapshot(snap);
        return { error: null };
      }
      if (!isNetworkError(r.error)) return { error: r.error };
    } catch (e) {
      if (!isNetworkError(e)) return { error: { message: String(e) } };
    }
  }
  queue.push({ ...op, qid: Date.now() + Math.random() });
  await writeQueue(queue);
  const snap = (await readSnapshot()) ?? emptySnap();
  applyOp(snap, op);
  await writeSnapshot(snap);
  return { error: null, queued: true };
}

const REF_COLS = ["id", "book_id", "student_id", "issue_id", "cat_id"];
let syncing = false;
/** Replay queued changes in order. Temporary IDs are swapped for real ones. */
export async function syncNow(): Promise<void> {
  if (syncing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  syncing = true; status = { ...status, syncing: true }; emit();
  let changed = false;
  try {
    let queue = await readQueue();
    const idMap = new Map<number, number>();
    const fix = (v: unknown) => (typeof v === "number" && idMap.has(v) ? idMap.get(v) : v);
    while (queue.length) {
      const op = queue[0]!;
      const values = "values" in op ? Object.fromEntries(Object.entries(op.values).map(([k, v]) => [k, REF_COLS.includes(k) ? fix(v) : v])) : undefined;
      const resolved = { ...op, ...(values ? { values } : {}), ...("val" in op ? { val: fix(op.val) } : {}) } as Op;
      try {
        const r = await withTimeout(sendOp(resolved), 10000);
        if (r.error && isNetworkError(r.error)) break;
        if (r.error) console.warn("Offline change rejected by server:", r.error.message);
        if (op.kind === "insert" && r.id != null) idMap.set(op.tempId, r.id);
      } catch (e) {
        if (isNetworkError(e)) break;
      }
      queue = queue.slice(1);
      // persist remaining queue with already-resolved temp ids
      queue = queue.map((q) => ({
        ...q,
        ...("values" in q ? { values: Object.fromEntries(Object.entries(q.values).map(([k, v]) => [k, REF_COLS.includes(k) ? fix(v) : v])) } : {}),
        ...("val" in q ? { val: fix(q.val) } : {}),
      })) as QueuedOp[];
      await writeQueue(queue);
      changed = true;
    }
  } finally {
    syncing = false; status = { ...status, syncing: false }; emit();
    if (changed) void refreshAll();
  }
}

/** Read the saved local copy instantly (works offline). */
export async function readLocal(): Promise<Snapshot> {
  return (await readSnapshot()) ?? emptySnap();
}

const IMG_RE = /^https?:\/\//i;
const prefetched = new Set<string>();
/** Download book covers and student photos so they show offline. */
async function prefetchImages(s: Snapshot) {
  if (typeof caches === "undefined") return;
  const urls = [...s.books.map((b) => b["cover_url"]), ...s.students.map((x) => x["image_url"])]
    .filter((u): u is string => typeof u === "string" && IMG_RE.test(u) && !prefetched.has(u));
  const cache = await caches.open("lp-images");
  for (let i = 0; i < urls.length; i += 6) {
    await Promise.allSettled(urls.slice(i, i + 6).map(async (u) => {
      if (await cache.match(u)) { prefetched.add(u); return; }
      const res = await fetch(u, { mode: "no-cors", credentials: "omit" });
      await cache.put(u, res);
      prefetched.add(u);
    }));
  }
}

let refreshing: Promise<Snapshot | null> | null = null;
/** Download every table in the background and save it for offline use. */
export function refreshAll(): Promise<Snapshot | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!isOnline()) return null;
    try {
      if ((await readQueue()).length > 0) return null;
      const res = await withTimeout(Promise.all(TABLES.map((t) => supabase.from(t).select("*").order("id", { ascending: false }))), 20000);
      if (!res.every((r) => !r.error && r.data)) return null;
      const snap = Object.fromEntries(TABLES.map((t, i) => [t, res[i]!.data])) as unknown as Snapshot;
      if ((await readQueue()).length > 0) return null;
      await writeSnapshot(snap);
      dataListeners.forEach((l) => l());
      void prefetchImages(snap).catch(() => {});
      return snap;
    } catch { return null; } finally { refreshing = null; }
  })();
  return refreshing;
}

/** Instant local data; a fresh copy is fetched in the background when online. */
export async function loadTables(): Promise<{ data: Snapshot; offline: boolean }> {
  const local = await readSnapshot();
  if (local) { void refreshAll(); return { data: local, offline: !isOnline() }; }
  const fresh = await refreshAll();
  return { data: fresh ?? emptySnap(), offline: !fresh };
}

// Confirmed-librarian marker so a signed-in librarian can open cached data offline.
// Only used when the network is unreachable; every change is re-checked by RLS on sync.
export async function rememberLibrarian(userId: string) { await idbSet(`librarian:${userId}`, true); }
export async function wasLibrarian(userId: string) { return (await idbGet<boolean>(`librarian:${userId}`)) === true; }

let started = false;
export function startAutoSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = async () => { await syncNow(); await refreshAll(); };
  window.addEventListener("online", () => void tick());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void tick(); });
  setInterval(() => void syncNow(), 30_000);
  setInterval(() => void refreshAll(), 5 * 60_000);
  void syncNow();
}
