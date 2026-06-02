// Video Server Manager
// Stored at settings/videoServers as an ARRAY of { name, domain, premiumOnly?, isDefault? }.
// Player switches just the host part of any URL; pathname/query stay intact.
// Display in player is serial-based with admin name: S1 Name, S2 Name.
// If no server is flagged isDefault, the original episode URL plays as Default.
import { db, ref, onValue, set } from "@/lib/firebase";

export interface VideoServer {
  /** Stable id derived from index (since stored as array) */
  id: string;
  name: string;
  domain: string;
  /** When true, only premium users can use this server. */
  premiumOnly?: boolean;
  /** When true, this server is the default playback choice. Only one should be true. */
  isDefault?: boolean;
}

export const VIDEO_SERVERS_PATH = "settings/videoServers";

function normalizeServerDomain(domain: string): string {
  const trimmed = String(domain || "").trim();
  if (!trimmed) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/** Normalise the raw Firebase value (array or object map) into VideoServer[]. */
function normaliseServers(val: any): VideoServer[] {
  if (!val) return [];
  let raw: any[] = [];
  if (Array.isArray(val)) {
    raw = val;
  } else if (typeof val === "object") {
    raw = Object.values(val);
  }
  return raw
    .filter((s: any) => s && typeof s === "object" && s.domain)
    .map((s: any, idx: number) => ({
      id: String(idx),
      name: String(s.name || `Server ${idx + 1}`),
      domain: normalizeServerDomain(String(s.domain)),
      premiumOnly: !!(s.premiumOnly ?? s.locked),
      isDefault: !!s.isDefault,
    }));
}

export function subscribeVideoServers(cb: (servers: VideoServer[]) => void): () => void {
  const r = ref(db, VIDEO_SERVERS_PATH);
  return onValue(r, (snap) => cb(normaliseServers(snap.val())));
}

type ServerInput = { name: string; domain: string; premiumOnly?: boolean; isDefault?: boolean };

/** Persist the full list (array form). Ensures only one default. */
async function writeServers(list: ServerInput[]) {
  let defaultSeen = false;
  const cleaned = list.map((s) => {
    const isDef = !!s.isDefault && !defaultSeen;
    if (isDef) defaultSeen = true;
    return {
      name: s.name,
      domain: normalizeServerDomain(s.domain),
      premiumOnly: !!s.premiumOnly,
      isDefault: isDef,
    };
  });
  await set(ref(db, VIDEO_SERVERS_PATH), cleaned);
}

export async function setAllVideoServers(list: ServerInput[]) {
  await writeServers(list.filter((s) => s && s.domain));
}

export async function addVideoServerEntry(current: VideoServer[], entry: ServerInput) {
  const next = [...current.map(toInput), entry];
  await writeServers(next);
}

export async function deleteVideoServerAt(current: VideoServer[], index: number) {
  const next = current.filter((_, i) => i !== index).map(toInput);
  await writeServers(next);
}

export async function moveVideoServer(current: VideoServer[], index: number, dir: -1 | 1) {
  const newIdx = index + dir;
  if (newIdx < 0 || newIdx >= current.length) return;
  const arr = current.map(toInput);
  [arr[index], arr[newIdx]] = [arr[newIdx], arr[index]];
  await writeServers(arr);
}

export async function setDefaultServer(current: VideoServer[], index: number) {
  const arr = current.map((s, i) => ({
    ...toInput(s),
    isDefault: i === index,
  }));
  await writeServers(arr);
}

export async function clearDefaultServer(current: VideoServer[]) {
  await writeServers(current.map((s) => ({ ...toInput(s), isDefault: false })));
}

function toInput(s: VideoServer): ServerInput {
  return {
    name: s.name,
    domain: s.domain,
    premiumOnly: !!s.premiumOnly,
    isDefault: !!s.isDefault,
  };
}

/**
 * Replace the origin (protocol + host[:port]) of a URL with the given server domain.
 * Keeps pathname, query, fragment intact.
 */
export function rewriteUrlWithServer(originalUrl: string, serverDomain: string): string {
  if (!originalUrl) return originalUrl;
  if (!serverDomain) return originalUrl;
  try {
    const orig = new URL(originalUrl);
    const newServer = normalizeServerDomain(serverDomain);
    const next = new URL(newServer);
    // IMPORTANT: rebuild from the new origin so the new server's port (or
    // lack thereof) fully replaces the original host:port. Setting
    // `orig.host` to a host without a port does NOT clear an existing port,
    // which produces broken URLs like `https://example.com:22811/...`
    // when swapping an http://host:port source onto an https-only server.
    const rebuilt = `${next.origin}${orig.pathname}${orig.search}${orig.hash}`;
    return rebuilt;
  } catch {
    try {
      const m = originalUrl.match(/^(https?:\/\/[^/]+)(.*)$/);
      if (!m) return originalUrl;
      const cleanServer = serverDomain.replace(/\/$/, "");
      return cleanServer + (m[2] || "");
    } catch {
      return originalUrl;
    }
  }
}
