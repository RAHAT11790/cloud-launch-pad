import { useEffect, useState } from "react";
import { db, ref, onValue, runTransaction } from "@/lib/firebase";

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

export type DownloadServerMode = "http" | "https";

export type DownloadManagerConfig = {
  telegramEnabled: boolean;
  websiteEnabled: boolean;
  serverModes: Record<string, DownloadServerMode>;
  /** Firebase-safe key of the server chosen to serve every download. */
  activeServerKey: string;
  /** Domain/base URL of that server, e.g. https://dl3.example.com */
  activeServerDomain: string;
};

export const DEFAULT_DOWNLOAD_MANAGER_CONFIG: DownloadManagerConfig = {
  telegramEnabled: true,
  websiteEnabled: true,
  serverModes: {},
  activeServerKey: "",
  activeServerDomain: "",
};

const CACHE_KEY = "rs_download_manager_config_v1";

const parseConfig = (raw: any): DownloadManagerConfig => {
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
  };
};

let config: DownloadManagerConfig = DEFAULT_DOWNLOAD_MANAGER_CONFIG;
const listeners = new Set<(cfg: DownloadManagerConfig) => void>();

try {
  if (typeof window !== "undefined") {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) config = parseConfig(JSON.parse(cached));
  }
} catch {}

try {
  if (typeof window !== "undefined") {
    onValue(ref(db, "settings/downloadManager"), (snap) => {
      config = parseConfig(snap.val() || {});
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(config)); } catch {}
      listeners.forEach((fn) => { try { fn(config); } catch {} });
    });
  }
} catch {}

export const getDownloadManagerConfig = () => config;

export const subscribeDownloadManagerConfig = (fn: (cfg: DownloadManagerConfig) => void) => {
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

/** Firebase-safe key for a server domain or any media URL. */
export const serverModeKey = (domainOrUrl?: string | null): string => {
  const raw = String(domainOrUrl || "").trim();
  if (!raw) return "";
  let host = raw;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    host = raw.replace(/^https?:\/\//i, "").split("/")[0];
  }
  return host.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
};

export const getServerDownloadMode = (domainOrUrl?: string | null): DownloadServerMode => {
  const key = serverModeKey(domainOrUrl);
  if (!key) return "http";
  return config.serverModes[key] === "https" ? "https" : "http";
};

// ---------------------------------------------------------------------------
// Active download server
// ---------------------------------------------------------------------------

/** The server the admin selected to serve every download ("" = keep source). */
export const getActiveDownloadServer = (): { key: string; domain: string; mode: DownloadServerMode } | null => {
  const domain = String(config.activeServerDomain || "").trim();
  if (!domain) return null;
  const key = config.activeServerKey || serverModeKey(domain);
  return { key, domain, mode: config.serverModes[key] === "https" ? "https" : "http" };
};

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
