import { useEffect, useState } from "react";
import { db, ref, onValue, runTransaction } from "@/lib/firebase";
import { normalizeDownloadFlowSettings } from "@/lib/downloadFlow";
import { checkRouteAlive, isRouteKnownDead } from "@/lib/routeHealth";
import { resolveActiveServer, serverModeKey, type DownloadServerMode, type ServerEntry } from "@/lib/downloadServerRef";

export { serverModeKey, type DownloadServerMode };

/**
 * Download Manager settings (admin controlled, Firebase backed).
 *
 *   settings/downloadManager = {
 *     telegramEnabled: boolean,
 *     websiteEnabled: boolean,
 *     serverModes: { [serverKey]: "http" | "https" }
 *   }
 *
 * "http"  -> current behaviour: download proxy + filename renaming.
 * "https" -> direct download link (no proxy, no renaming). The playback URL's
 *            `/watch` segment is removed to reach the raw file.
 *
 * Daily counters live at stats/downloads/{YYYY-MM-DD} = { telegram, website, total }.
 */

export type DownloadManagerConfig = {
  telegramEnabled: boolean;
  websiteEnabled: boolean;
  serverModes: Record<string, DownloadServerMode>;
  /** Firebase-safe key of the server chosen to serve every download. */
  activeServerKey: string;
  /** Domain/base URL of that server when it was picked (may be stale — see activeServerRef). */
  activeServerDomain: string;
  /** Live reference to the picked server ("video:<index>:<name>" or "custom:<id>"). */
  activeServerRef: string;
  /** HTTP/HTTPS choice saved with the pick (kept when the address changes). */
  activeServerMode: string;
  customServers: Record<string, ServerEntry>;
  maxEpisodes: number;
  adSteps: number[];
  sponsorSeconds: number;
  adStepsByCount: Record<string, number[]>;
  socialBar: string;
  banner: string;
};

export const DEFAULT_DOWNLOAD_MANAGER_CONFIG: DownloadManagerConfig = {
  telegramEnabled: true,
  websiteEnabled: true,
  serverModes: {},
  activeServerKey: "",
  activeServerDomain: "",
  activeServerRef: "",
  activeServerMode: "",
  customServers: {},
  ...normalizeDownloadFlowSettings(),
};

const CACHE_KEY = "rs_download_manager_config_v1";

export const parseDownloadManagerConfig = (raw: any): DownloadManagerConfig => {
  const modesRaw = raw?.serverModes && typeof raw.serverModes === "object" ? raw.serverModes : {};
  const serverModes: Record<string, DownloadServerMode> = {};
  Object.keys(modesRaw).forEach((key) => {
    serverModes[key] = String(modesRaw[key]).toLowerCase() === "https" ? "https" : "http";
  });
  return {
    telegramEnabled: raw?.telegramEnabled !== false,
    websiteEnabled: raw?.websiteEnabled !== false,
    serverModes,
    activeServerKey: String(raw?.activeServerKey || ""),
    activeServerDomain: String(raw?.activeServerDomain || ""),
    activeServerRef: String(raw?.activeServerRef || ""),
    activeServerMode: String(raw?.activeServerMode || ""),
    customServers: raw?.customServers && typeof raw.customServers === "object" ? raw.customServers : {},
    ...normalizeDownloadFlowSettings(raw || {}),
  };
};

let config: DownloadManagerConfig = DEFAULT_DOWNLOAD_MANAGER_CONFIG;
const listeners = new Set<(cfg: DownloadManagerConfig) => void>();
let configReady = false;
const readyListeners = new Set<(ready: boolean) => void>();
function markConfigReady() {
  configReady = true;
  readyListeners.forEach(fn => fn(true));
}

// Live Video Servers list: the selected download server is a reference into
// it, so an address change there reaches downloads immediately.
const SERVERS_CACHE_KEY = "rs_dm_video_servers_v1";
let videoServers: ServerEntry[] = [];
export const parseVideoServers = (val: any): ServerEntry[] =>
  Array.isArray(val) ? val.map((s: any) => (s && s.domain ? { name: String(s.name || ""), domain: String(s.domain) } : {}))
    : val && typeof val === "object" ? (Object.values(val) as any[]).map((s) => (s && s.domain ? { name: String(s.name || ""), domain: String(s.domain) } : {}))
    : [];
try {
  if (typeof window !== "undefined") {
    const cachedServers = localStorage.getItem(SERVERS_CACHE_KEY);
    if (cachedServers) videoServers = parseVideoServers(JSON.parse(cachedServers));
  }
} catch {}

try {
  if (typeof window !== "undefined") {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) config = parseDownloadManagerConfig(JSON.parse(cached));
  }
} catch {}

try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/downloadManager"), (snap) => {
      config = parseDownloadManagerConfig(snap.val() || {});
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch {}
      listeners.forEach((fn) => { try { fn(config); } catch {} });
      void checkActiveDownloadServer();
      markConfigReady();
    }, markConfigReady);
    onValue(ref(db, "settings/videoServers"), (snap) => {
      videoServers = parseVideoServers(snap.val());
      try { localStorage.setItem(SERVERS_CACHE_KEY, JSON.stringify(videoServers)); } catch {}
      listeners.forEach((fn) => { try { fn(config); } catch {} });
      void checkActiveDownloadServer();
    });
  }
} catch {}

export const getDownloadManagerConfig = () => config;
export function useDownloadConfigReady() {
  const [ready, setReady] = useState(configReady);
  useEffect(() => { readyListeners.add(setReady); setReady(configReady); return () => { readyListeners.delete(setReady); }; }, []);
  return ready;
}

const subscribeDownloadManagerConfig = (fn: (cfg: DownloadManagerConfig) => void) => {
  listeners.add(fn);
  fn(config);
  return () => { listeners.delete(fn); };
};

export const useDownloadManagerConfig = (): DownloadManagerConfig => {
  const [value, setValue] = useState<DownloadManagerConfig>(config);
  useEffect(() => subscribeDownloadManagerConfig(setValue), []);
  return value;
};

// ---------------------------------------------------------------------------
// Server keys + mode lookup
// ---------------------------------------------------------------------------

const getServerDownloadMode = (domainOrUrl?: string | null): DownloadServerMode => {
  const key = serverModeKey(domainOrUrl);
  if (!key) return "http";
  return config.serverModes[key] === "https" ? "https" : "http";
};

// ---------------------------------------------------------------------------
// Active download server
// ---------------------------------------------------------------------------

/** The server the admin selected to serve every download ("" = keep source). */
const activeServerUrl = (domain: string, mode: DownloadServerMode) => {
  const base = domain.replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? base : `${mode === "https" ? "https" : "http"}://${base}`;
};
/** The selected download server with its CURRENT address (live from Video Servers). */
export const getSelectedDownloadServer = () => resolveActiveServer(config, videoServers, config.customServers);
const getActiveDownloadServer = (): { key: string; domain: string; mode: DownloadServerMode } | null => {
  const active = getSelectedDownloadServer();
  if (!active) return null;
  // A server that was just proven offline acts like "no server selected":
  // downloads come from the file's own server instead of a dead host.
  if (isRouteKnownDead(activeServerUrl(active.domain, active.mode))) return null;
  return active;
};

/** Checks (once, cached on the device) whether the selected download server is online. */
export function checkActiveDownloadServer(): Promise<boolean> {
  const active = getSelectedDownloadServer();
  if (!active || typeof window === "undefined") return Promise.resolve(true);
  return checkRouteAlive(activeServerUrl(active.domain, active.mode));
}

/**
 * Rewrites a media URL so it is served by the selected download server while
 * keeping the original file path intact. Returns the input unchanged when no
 * active server is configured or the URL cannot be parsed.
 */
export const applyActiveDownloadServer = (url: string): string => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const active = getActiveDownloadServer();
  if (!active) return raw;
  const base = active.domain.replace(/\/+$/, "");
  const baseWithScheme = /^https?:\/\//i.test(base) ? base : `${active.mode === "https" ? "https" : "http"}://${base}`;
  try {
    const source = new URL(raw);
    const target = new URL(baseWithScheme);
    const basePath = target.pathname.replace(/\/+$/, "");
    const out = new URL(source.pathname + source.search, `${target.protocol}//${target.host}`);
    out.pathname = `${basePath}${source.pathname}`.replace(/\/{2,}/g, "/");
    return out.toString();
  } catch {
    return raw;
  }
};

/** Download mode for a URL after the active-server override is applied. */
export const getEffectiveDownloadMode = (url: string): DownloadServerMode => {
  const active = getActiveDownloadServer();
  if (active) return active.mode;
  return getServerDownloadMode(url);
};

// ---------------------------------------------------------------------------
// Direct (HTTPS) download link
// ---------------------------------------------------------------------------

/** Removes the `/watch` path segment that only exists for playback URLs. */
export const stripWatchSegment = (url: string): string => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.pathname = parsed.pathname
      .replace(/\/watch(?=\/)/gi, "")
      .replace(/\/watch\/?$/i, "/");
    return parsed.toString();
  } catch {
    return raw.replace(/\/watch(?=\/)/gi, "");
  }
};

/** Direct download link for HTTPS servers, or "" when not possible. */
export const buildDirectDownloadLink = (url: string): string => {
  const stripped = stripWatchSegment(url);
  if (!/^https:\/\//i.test(stripped)) return "";
  return stripped;
};

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export const downloadStatsDayKey = (date = new Date()): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export type DownloadStatKind = "telegram" | "website";

export const recordDownloadEvent = (kind: DownloadStatKind, count = 1) => {
  const amount = Math.max(1, Math.trunc(Number(count) || 1));
  const day = downloadStatsDayKey();
  const bump = (path: string) => {
    try {
      runTransaction(ref(db, path), (current) => (Number(current) || 0) + amount);
    } catch {}
  };
  bump(`stats/downloads/${day}/${kind}`);
  bump(`stats/downloads/${day}/total`);
};

export type DownloadDayStat = { day: string; telegram: number; website: number; total: number };

export const parseDownloadStats = (raw: any): DownloadDayStat[] => {
  if (!raw || typeof raw !== "object") return [];
  return Object.keys(raw)
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort()
    .map((day) => {
      const entry = raw[day] || {};
      const telegram = Number(entry.telegram) || 0;
      const website = Number(entry.website) || 0;
      return { day, telegram, website, total: Number(entry.total) || telegram + website };
    });
};

export const sumDownloadStats = (stats: DownloadDayStat[], days: number): DownloadDayStat => {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffKey = downloadStatsDayKey(cutoff);
  return stats
    .filter((entry) => entry.day >= cutoffKey)
    .reduce(
      (acc, entry) => ({
        day: `${days}d`,
        telegram: acc.telegram + entry.telegram,
        website: acc.website + entry.website,
        total: acc.total + entry.total,
      }),
      { day: `${days}d`, telegram: 0, website: 0, total: 0 },
    );
};
