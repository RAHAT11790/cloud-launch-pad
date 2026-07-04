// Multi-Firebase mirror engine.
// Each extra Firebase = a warm replica of the primary Firebase. Admin can:
//   - Push a section (e.g. webseries/users/images) from main → replica
//   - Pull a section as JSON download (per replica)
//   - Upload a JSON file to overwrite a section (per replica)
//   - Ping connection
//
// The live app still reads/writes only the primary Firebase; replicas are
// passive copies for backup / load distribution that you can wire later.

import { initializeApp, deleteApp, getApps, type FirebaseApp } from "firebase/app";
import { getDatabase, ref as rRef, get as rGet, set as rSet, update as rUpdate, type Database } from "firebase/database";
import { db as mainDb, ref as mainRef, get as mainGet, set as mainSet, remove as mainRemove, update as mainUpdate } from "@/lib/firebase";

// Re-export the main DB so the UI can label it without re-importing firebase directly.
export const MAIN_DB_LABEL = "Main Firebase (primary)";


export interface ExtraFirebaseConfig {
  id: string;                 // uuid
  displayName: string;        // e.g. "Backup-A"
  apiKey: string;
  authDomain: string;
  projectId: string;
  databaseURL: string;        // primary RTDB URL
  mirrorURL?: string;         // optional secondary region URL (read fallback)
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  sections: string[];         // which top-level RTDB roots this FB handles
  autoMirrorMinutes?: number; // 0 / undefined = disabled
  createdAt: number;
  updatedAt: number;
}


// Default top-level sections used by the app.
export const ALL_SECTIONS = [
  "webseries", "movies", "liveTv",
  "users", "userProfiles", "watchHistory", "library",
  "comments", "notifications", "pushTokens", "fcmTokens",
  "subscriptions", "adminLinks", "admin",
  "seasonsByLanguage", "images", "analytics",
  "miniApp", "telegramPerAnimeButtons", "weeklyEpisodes",
  "categories", "branding",
] as const;
export type SectionName = typeof ALL_SECTIONS[number] | string;

// Standard RTDB rules (admin can copy + paste in Firebase console)
export const DEFAULT_RTDB_RULES = `{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}`;

const appCache = new Map<string, { app: FirebaseApp; db: Database }>();

function instanceName(id: string) { return `extra-fb-${id}`; }

function ensureApp(cfg: ExtraFirebaseConfig): { app: FirebaseApp; db: Database } {
  const cached = appCache.get(cfg.id);
  if (cached) return cached;

  // Re-use if already initialized in this session
  const existing = getApps().find(a => a.name === instanceName(cfg.id));
  const app = existing || initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    databaseURL: cfg.databaseURL,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  }, instanceName(cfg.id));
  const db = getDatabase(app, cfg.databaseURL);
  const entry = { app, db };
  appCache.set(cfg.id, entry);
  return entry;
}

export async function disposeExtraFirebase(cfg: ExtraFirebaseConfig) {
  const cached = appCache.get(cfg.id);
  if (cached) {
    try { await deleteApp(cached.app); } catch { /* ignore */ }
    appCache.delete(cfg.id);
  }
}

// ----------------- CRUD on the extra-firebase config list (stored in primary) -----------------

export async function listExtraFirebases(): Promise<ExtraFirebaseConfig[]> {
  const snap = await mainGet(mainRef(mainDb, "admin/extraFirebases"));
  const v = (snap.val() || {}) as Record<string, ExtraFirebaseConfig>;
  return Object.values(v).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveExtraFirebase(cfg: ExtraFirebaseConfig) {
  await mainSet(mainRef(mainDb, `admin/extraFirebases/${cfg.id}`), {
    ...cfg,
    updatedAt: Date.now(),
  });
}

export async function deleteExtraFirebase(id: string) {
  await mainRemove(mainRef(mainDb, `admin/extraFirebases/${id}`));
}

export async function updateSections(id: string, sections: string[]) {
  await mainUpdate(mainRef(mainDb, `admin/extraFirebases/${id}`), {
    sections, updatedAt: Date.now(),
  });
}

// ----------------- Connection ops -----------------

export async function pingExtra(cfg: ExtraFirebaseConfig): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = performance.now();
  try {
    const { db } = ensureApp(cfg);
    // Reading .info/connected can take a moment; race with a 5s timeout.
    const result = await Promise.race([
      rGet(rRef(db, ".info/serverTimeOffset")),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    void result;
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (e: any) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: e?.message || String(e) };
  }
}

// ----------------- Per-section operations -----------------

export type ProgressFn = (info: {
  doneNodes: number;
  totalNodes: number;
  currentSection: string;
  currentKey?: string;
  phase: "reading" | "writing" | "done";
}) => void;

const CHUNK = 25;

/** Push one section from main DB → extra DB (full overwrite of each top-level child). */
export async function pushSection(
  cfg: ExtraFirebaseConfig,
  section: string,
  onProgress?: ProgressFn,
) {
  const { db: extraDb } = ensureApp(cfg);
  onProgress?.({ doneNodes: 0, totalNodes: 1, currentSection: section, phase: "reading" });
  const snap = await mainGet(mainRef(mainDb, section));
  const val = snap.val();
  if (val == null) {
    // empty section → set null in replica too
    await rSet(rRef(extraDb, section), null);
    onProgress?.({ doneNodes: 0, totalNodes: 0, currentSection: section, phase: "done" });
    return { nodes: 0 };
  }
  // If value is primitive or array (no top-level children to chunk), just set whole.
  if (typeof val !== "object" || Array.isArray(val)) {
    await rSet(rRef(extraDb, section), val);
    onProgress?.({ doneNodes: 1, totalNodes: 1, currentSection: section, phase: "done" });
    return { nodes: 1 };
  }
  const keys = Object.keys(val);
  const total = keys.length;
  let done = 0;
  // Wipe section first so deleted nodes get removed in the replica too.
  await rSet(rRef(extraDb, section), null);
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const batch: Record<string, any> = {};
    for (const k of slice) batch[k] = val[k];
    await rUpdate(rRef(extraDb, section), batch);
    done += slice.length;
    onProgress?.({
      doneNodes: done,
      totalNodes: total,
      currentSection: section,
      currentKey: slice[slice.length - 1],
      phase: "writing",
    });
  }
  onProgress?.({ doneNodes: total, totalNodes: total, currentSection: section, phase: "done" });
  return { nodes: total };
}

/** Push multiple sections sequentially, aggregating progress. */
export async function pushAllSelectedSections(
  cfg: ExtraFirebaseConfig,
  sections: string[],
  onProgress?: ProgressFn,
) {
  for (const s of sections) {
    await pushSection(cfg, s, onProgress);
  }
}

/** Pull a section from extra DB → return JSON object. */
export async function pullSectionJson(cfg: ExtraFirebaseConfig, section: string): Promise<any> {
  const { db: extraDb } = ensureApp(cfg);
  const snap = await rGet(rRef(extraDb, section));
  return snap.val();
}

/** Upload a section JSON object → write to extra DB (full overwrite). */
export async function uploadSectionJson(cfg: ExtraFirebaseConfig, section: string, data: any) {
  const { db: extraDb } = ensureApp(cfg);
  await rSet(rRef(extraDb, section), data);
}

/** Helper for browser download. */
export function triggerJsonDownload(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildRealtimeJsonDownloadUrl(databaseURL: string, filename: string) {
  const base = String(databaseURL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/.json?download=${encodeURIComponent(filename)}`;
}

export function getMainRemoteJsonDownloadUrl(filename: string) {
  const mainUrl = String((mainDb as any)?.app?.options?.databaseURL || "").trim();
  return buildRealtimeJsonDownloadUrl(mainUrl, filename);
}

export function getExtraRemoteJsonDownloadUrl(cfg: ExtraFirebaseConfig, filename: string) {
  return buildRealtimeJsonDownloadUrl(cfg.databaseURL, filename);
}

export function triggerRemoteJsonDownload(downloadUrl: string) {
  if (typeof document === "undefined") return;
  const clean = String(downloadUrl || "").trim();
  if (!clean) throw new Error("Missing remote download URL.");
  const a = document.createElement("a");
  a.href = clean;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function streamJsonDownload(
  filename: string,
  data: any,
  onProgress?: (info: { stage: "preparing" | "writing" | "done"; progress: number; writtenBytes: number; totalBytes: number }) => void,
) {
  const encoder = new TextEncoder();
  const json = JSON.stringify(data, null, 2);
  const totalBytes = encoder.encode(json).length;
  onProgress?.({ stage: "preparing", progress: 0, writtenBytes: 0, totalBytes });

  if (typeof window === "undefined") {
    triggerJsonDownload(filename, data);
    onProgress?.({ stage: "done", progress: 100, writtenBytes: totalBytes, totalBytes });
    return;
  }

  const fileStreamApi = (window as any).showSaveFilePicker;
  if (typeof fileStreamApi === "function") {
    const handle = await fileStreamApi({
      suggestedName: filename,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    const writable = await handle.createWritable();
    const chunkSize = 256 * 1024;
    let writtenBytes = 0;
    for (let i = 0; i < json.length; i += chunkSize) {
      const chunk = json.slice(i, i + chunkSize);
      const encoded = encoder.encode(chunk);
      await writable.write(encoded);
      writtenBytes += encoded.length;
      onProgress?.({
        stage: "writing",
        progress: totalBytes > 0 ? Math.min(99, Math.round((writtenBytes / totalBytes) * 100)) : 100,
        writtenBytes,
        totalBytes,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await writable.close();
    onProgress?.({ stage: "done", progress: 100, writtenBytes: totalBytes, totalBytes });
    return;
  }

  triggerJsonDownload(filename, data);
  onProgress?.({ stage: "done", progress: 100, writtenBytes: totalBytes, totalBytes });
}

// ============================================================
// FULL-DB operations (entire RTDB tree)
// ============================================================

/** Download the entire MAIN Firebase RTDB tree as JSON. */
export async function pullMainFullJson(): Promise<any> {
  const snap = await mainGet(mainRef(mainDb, "/"));
  return snap.val();
}

/** Download the entire EXTRA Firebase RTDB tree as JSON. */
export async function pullExtraFullJson(cfg: ExtraFirebaseConfig): Promise<any> {
  const { db: extraDb } = ensureApp(cfg);
  const snap = await rGet(rRef(extraDb, "/"));
  return snap.val();
}

/**
 * Upload a full JSON tree to MAIN Firebase. MERGES at root level (safer than overwrite).
 * Top-level keys present in `data` replace those subtrees; keys not in `data` are preserved.
 */
export async function uploadMainFullJson(data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Full JSON must be a plain object with top-level sections.");
  }
  // Use update to merge top-level children rather than wiping entire DB.
  await mainUpdate(mainRef(mainDb, "/"), data);
}

/** Upload a full JSON tree to an EXTRA Firebase (merge at root). */
export async function uploadExtraFullJson(cfg: ExtraFirebaseConfig, data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Full JSON must be a plain object with top-level sections.");
  }
  const { db: extraDb } = ensureApp(cfg);
  await rUpdate(rRef(extraDb, "/"), data);
}

// ============================================================
// Storage analytics — estimate RTDB usage from JSON byte size
// ============================================================

export interface StorageStats {
  bytes: number;
  human: string;
  sections: Array<{ name: string; bytes: number; nodeCount: number }>;
  totalNodes: number;
}

function humanBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function analyzeTree(root: any): StorageStats {
  if (!root || typeof root !== "object") {
    const bytes = root == null ? 0 : new Blob([JSON.stringify(root)]).size;
    return { bytes, human: humanBytes(bytes), sections: [], totalNodes: 0 };
  }
  const sections: StorageStats["sections"] = [];
  let total = 0;
  let totalNodes = 0;
  for (const name of Object.keys(root)) {
    const sub = root[name];
    const bytes = new Blob([JSON.stringify(sub)]).size;
    const nodeCount =
      sub && typeof sub === "object" && !Array.isArray(sub) ? Object.keys(sub).length : 1;
    sections.push({ name, bytes, nodeCount });
    total += bytes;
    totalNodes += nodeCount;
  }
  sections.sort((a, b) => b.bytes - a.bytes);
  return { bytes: total, human: humanBytes(total), sections, totalNodes };
}

export async function analyzeMainStorage(): Promise<StorageStats> {
  const data = await pullMainFullJson();
  return analyzeTree(data);
}

export async function analyzeExtraStorage(cfg: ExtraFirebaseConfig): Promise<StorageStats> {
  const data = await pullExtraFullJson(cfg);
  return analyzeTree(data);
}

// ============================================================
// Auto-mirror config (per-extra interval push from MAIN → extra)
// Stored alongside extra config: cfg.autoMirrorMinutes (0 = off)
// ============================================================

export async function setAutoMirror(id: string, minutes: number) {
  await mainUpdate(mainRef(mainDb, `admin/extraFirebases/${id}`), {
    autoMirrorMinutes: Math.max(0, Math.floor(minutes || 0)),
    updatedAt: Date.now(),
  });
}
