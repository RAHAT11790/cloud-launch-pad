// ============================================================
// Download server reference — which server serves every download
// ============================================================
// The admin picks one of the Video Servers (or a custom server) for
// downloads. Video server addresses change on their own (tunnels restart,
// "RS FR 03" gets a new URL), so the choice is stored as a REFERENCE to the
// server — position + name — and its address is read live from the current
// Video Servers list. A copied address would go stale and break downloads.

export type DownloadServerMode = "http" | "https";
export type ServerEntry = { name?: string; domain?: string };

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

/** Stable key of a server NAME ("RS FR 03" → "rs_fr_03"). */
export const serverNameKey = (name?: string | null): string =>
  String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** serverModes key that follows a video server across address changes. */
export const serverNameModeKey = (name?: string | null): string => {
  const k = serverNameKey(name);
  return k ? `name_${k}` : "";
};

export const videoServerRef = (index: number, name?: string | null) => `video:${Math.max(0, Math.trunc(index))}:${serverNameKey(name)}`;
export const customServerRef = (id: string) => `custom:${id}`;

export type ActiveServerSettings = {
  activeServerRef?: string;
  activeServerDomain?: string;
  activeServerKey?: string;
  activeServerMode?: string;
  serverModes?: Record<string, DownloadServerMode>;
};

export type ResolvedServer = { key: string; domain: string; mode: DownloadServerMode; name: string; live: boolean };

const sameHost = (a: string, b: string) => !!a && serverModeKey(a) === serverModeKey(b);

/** Picks the referenced video server from the CURRENT list (name first, then position). */
export function findReferencedServer(ref: string, videoServers: ServerEntry[], customServers: Record<string, ServerEntry> = {}): ServerEntry | null {
  const raw = String(ref || "");
  if (raw.startsWith("custom:")) {
    const hit = customServers[raw.slice(7)];
    return hit?.domain ? hit : null;
  }
  const m = raw.match(/^video:(\d+):(.*)$/);
  if (!m) return null;
  const index = Number(m[1]);
  const nameKey = m[2];
  const list = videoServers.filter((s) => s && s.domain);
  const atIndex = videoServers[index];
  if (nameKey) {
    const named = list.filter((s) => serverNameKey(s.name) === nameKey);
    if (named.length === 1) return named[0];
    if (named.length > 1) return atIndex && serverNameKey(atIndex.name) === nameKey ? atIndex : named[0];
  }
  return atIndex?.domain ? atIndex : null;
}

/** HTTP/HTTPS choice of a server; survives address changes through its name key. */
export function modeForServer(settings: ActiveServerSettings, domain: string, name?: string | null, fallback?: string): DownloadServerMode {
  const modes = settings.serverModes || {};
  const byDomain = modes[serverModeKey(domain)];
  if (byDomain) return byDomain === "https" ? "https" : "http";
  const byName = modes[serverNameModeKey(name)];
  if (byName) return byName === "https" ? "https" : "http";
  if (fallback === "https" || fallback === "http") return fallback;
  return "http";
}

/**
 * The download server to use right now, with its live address.
 * null = no server selected (every file downloads from its own server).
 */
export function resolveActiveServer(settings: ActiveServerSettings, videoServers: ServerEntry[], customServers: Record<string, ServerEntry> = {}): ResolvedServer | null {
  const stored = String(settings.activeServerDomain || "").trim();
  const ref = String(settings.activeServerRef || "");
  const storedMode = settings.activeServerMode || (settings.serverModes || {})[String(settings.activeServerKey || serverModeKey(stored))];
  if (ref) {
    const hit = findReferencedServer(ref, videoServers, customServers);
    if (hit?.domain) {
      const domain = String(hit.domain).trim();
      return { key: serverModeKey(domain), domain, mode: modeForServer(settings, domain, hit.name, storedMode), name: String(hit.name || ""), live: true };
    }
  }
  if (!stored) return null;
  // Older setting without a reference: still live when the address is in the list.
  const match = videoServers.find((s) => s?.domain && sameHost(String(s.domain), stored))
    || Object.values(customServers).find((s) => s?.domain && sameHost(String(s.domain), stored));
  const domain = match?.domain ? String(match.domain).trim() : stored;
  return { key: serverModeKey(domain), domain, mode: modeForServer(settings, domain, match?.name, storedMode), name: String(match?.name || ""), live: !!match };
}
