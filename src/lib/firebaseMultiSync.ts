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
import { auth as mainAuth, db as mainDb, ref as mainRef, get as mainGet, set as mainSet, remove as mainRemove, update as mainUpdate } from "@/lib/firebase";

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

const appCache = new Map<string, { app: FirebaseApp; db: Database; url: string }>();

function instanceName(id: string) { return `extra-fb-${id}`; }

/**
 * Clean up a database URL so SDK calls always target the RTDB root.
 * Admins sometimes paste URLs with path/query/hash fragments, which causes
 * false "Invalid token in path" errors even when the database is healthy.
 */
function normalizeUrl(url: string | undefined): string {
  if (!url) return "";
  let s = url.trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (s && !s.startsWith("http")) s = "https://" + s;
  try {
    const u = new URL(s);
    u.hash = "";
    u.search = "";
    u.pathname = "/";
    return u.toString().replace(/\/+$/, "");
  } catch {
    s = s.replace(/[?#].*$/, "").replace(/\/\.json$/i, "").replace(/\/+$/, "");
  }
  return s;
}

/**
 * Extract the root of an RTDB URL (origin only).
 * Necessary because .info paths only work at the REAL database root.
 */
function getRootUrl(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    return u.origin;
  } catch {
    return normalizeUrl(url);
  }
}

function ensureApp(cfg: ExtraFirebaseConfig): { app: FirebaseApp; db: Database } {
  const normUrl = normalizeUrl(cfg.databaseURL);
  const cached = appCache.get(cfg.id);

  // If URL changed in config, kill old app instance to avoid stale connection
  if (cached && cached.url !== normUrl) {
    disposeExtraFirebase(cfg);
  } else if (cached) {
    return cached;
  }

  // Re-use if already initialized in this session
  const name = instanceName(cfg.id);
  const existing = getApps().find(a => a.name === name);
  
  if (existing) {
    if ((existing as any).options.databaseURL !== normUrl) {
      try { deleteApp(existing); } catch {}
    } else {
      const db = getDatabase(existing, normUrl);
      const entry = { app: existing, db, url: normUrl };
      appCache.set(cfg.id, entry);
      return entry;
    }
  }

  const app = initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    databaseURL: normUrl,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  }, name);

  const db = getDatabase(app, normUrl);
  const entry = { app, db, url: normUrl };
  appCache.set(cfg.id, entry);
  return entry;
}

export async function disposeExtraFirebase(cfg: ExtraFirebaseConfig) {
  const cached = appCache.get(cfg.id);
  if (cached) {
    try { await deleteApp(cached.app); } catch { /* ignore */ }
    appCache.delete(cfg.id);
  } else {
    // Check global state too
    const name = instanceName(cfg.id);
    const existing = getApps().find(a => a.name === name);
    if (existing) {
      try { await deleteApp(existing); } catch { /* ignore */ }
    }
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

/**
 * Ping an RTDB. If primary fails and mirror exists, try mirror.
 * We probe a normal root node instead of /.info/* because pasted custom URLs
 * with path fragments can make the SDK throw a misleading path-token error.
 */
export async function pingExtra(cfg: ExtraFirebaseConfig): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = performance.now();
  
  const attemptPing = async (url: string) => {
    const { app } = ensureApp(cfg);
    const rootUrl = getRootUrl(url);
    const rootDb = getDatabase(app, rootUrl);
    
    await Promise.race([
      rGet(rRef(rootDb, "/admin")),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
  };

  try {
    await attemptPing(cfg.databaseURL);
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (e: any) {
    if (cfg.mirrorURL) {
      try {
        await attemptPing(cfg.mirrorURL);
        return { ok: true, ms: Math.round(performance.now() - t0), error: "(via mirror)" };
      } catch (me: any) {
        return { ok: false, ms: Math.round(performance.now() - t0), error: `Primary: ${e?.message}; Mirror: ${me?.message}` };
      }
    }
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
    await rSet(rRef(extraDb, section), null);
    onProgress?.({ doneNodes: 0, totalNodes: 0, currentSection: section, phase: "done" });
    return { nodes: 0 };
  }
  if (typeof val !== "object" || Array.isArray(val)) {
    await rSet(rRef(extraDb, section), val);
    onProgress?.({ doneNodes: 1, totalNodes: 1, currentSection: section, phase: "done" });
    return { nodes: 1 };
  }
  const keys = Object.keys(val);
  const total = keys.length;
  let done = 0;
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

export async function pushAllSelectedSections(
  cfg: ExtraFirebaseConfig,
  sections: string[],
  onProgress?: ProgressFn,
) {
  for (const s of sections) {
    await pushSection(cfg, s, onProgress);
  }
}

export async function pullSectionJson(cfg: ExtraFirebaseConfig, section: string): Promise<any> {
  const { db: extraDb } = ensureApp(cfg);
  try {
    const snap = await rGet(rRef(extraDb, section));
    return snap.val();
  } catch (e) {
    if (cfg.mirrorURL) {
      const { app } = ensureApp(cfg);
      const mirrorDb = getDatabase(app, normalizeUrl(cfg.mirrorURL));
      const snap = await rGet(rRef(mirrorDb, section));
      return snap.val();
    }
    throw e;
  }
}

export async function uploadSectionJson(cfg: ExtraFirebaseConfig, section: string, data: any) {
  const { db: extraDb } = ensureApp(cfg);
  await rSet(rRef(extraDb, section), data);
}

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

const encodeDatabasePath = (path: string) =>
  String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

async function buildRealtimeJsonDownloadUrl(databaseURL: string, filename: string, includeMainAuth = false, path = "") {
  const base = String(databaseURL || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const encodedPath = encodeDatabasePath(path);
  const url = new URL(`${base}/${encodedPath ? encodedPath : ""}.json`);
  url.searchParams.set("download", filename);
  if (includeMainAuth) {
    try {
      const token = await mainAuth.currentUser?.getIdToken(false);
      if (token) url.searchParams.set("auth", token);
    } catch {}
  }
  return url.toString();
}

export async function getMainRemoteJsonDownloadUrl(filename: string) {
  const mainUrl = String((mainDb as any)?.app?.options?.databaseURL || "").trim();
  return buildRealtimeJsonDownloadUrl(mainUrl, filename, true);
}

export async function getExtraRemoteJsonDownloadUrl(cfg: ExtraFirebaseConfig, filename: string) {
  return buildRealtimeJsonDownloadUrl(cfg.databaseURL, filename, false);
}

export async function getExtraRemoteSectionDownloadUrl(cfg: ExtraFirebaseConfig, section: string, filename: string) {
  return buildRealtimeJsonDownloadUrl(cfg.databaseURL, filename, false, section);
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
    try {
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
    } catch (e: any) {
      if (e?.name === "AbortError") {
        onProgress?.({ stage: "done", progress: 0, writtenBytes: 0, totalBytes: 0 });
        return;
      }
    }
  }

  triggerJsonDownload(filename, data);
  onProgress?.({ stage: "done", progress: 100, writtenBytes: totalBytes, totalBytes });
}

// ============================================================
// FULL-DB operations
// ============================================================

export async function pullMainFullJson(): Promise<any> {
  const snap = await mainGet(mainRef(mainDb, "/"));
  return snap.val();
}

export async function pullExtraFullJson(cfg: ExtraFirebaseConfig): Promise<any> {
  const { db: extraDb } = ensureApp(cfg);
  try {
    const snap = await rGet(rRef(extraDb, "/"));
    return snap.val();
  } catch (e) {
    if (cfg.mirrorURL) {
      const { app } = ensureApp(cfg);
      const mirrorDb = getDatabase(app, normalizeUrl(cfg.mirrorURL));
      const snap = await rGet(rRef(mirrorDb, "/"));
      return snap.val();
    }
    throw e;
  }
}

export async function uploadMainFullJson(data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Full JSON must be a plain object with top-level sections.");
  }
  await mainUpdate(mainRef(mainDb, "/"), data);
}

export async function uploadExtraFullJson(cfg: ExtraFirebaseConfig, data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Full JSON must be a plain object with top-level sections.");
  }
  const { db: extraDb } = ensureApp(cfg);
  await rUpdate(rRef(extraDb, "/"), data);
}

// ============================================================
// Storage analytics
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

export async function setAutoMirror(id: string, minutes: number) {
  await mainUpdate(mainRef(mainDb, `admin/extraFirebases/${id}`), {
    autoMirrorMinutes: Math.max(0, Math.floor(minutes || 0)),
    updatedAt: Date.now(),
  });
}
