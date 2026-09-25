// ============================================================
// HTTPS Protection client
// ============================================================
// Servers in Admin → Video Servers may carry a `protect` gateway URL.
// For those servers the player never touches the real URL: it asks the
// gateway to sign every candidate URL (encrypted, viewer-bound, expiring)
// and plays only the returned `/v/<token>` link.
import { readCachedProxyServers, type ProxyServerEntry } from "@/lib/serverProxy";

type Signed = { link: string; exp: number };
const cache = new Map<string, Signed>();

const hostOf = (value: string) => {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host.toLowerCase(); } catch { return ""; }
};

export const getProtectionGateway = (url: string, servers?: ProxyServerEntry[]): string => {
  const host = hostOf(url);
  if (!host) return "";
  const list = servers?.length ? servers : readCachedProxyServers();
  return list.find((s) => hostOf(s.domain) === host)?.protect || "";
};

/** Sync lookup. Returns "" when the url is protected but not yet signed. */
export const getProtectedUrlSync = (url: string): string | null => {
  const gw = getProtectionGateway(url);
  if (!gw) return null; // not protected
  const hit = cache.get(url);
  if (hit && hit.exp * 1000 - Date.now() > 60_000) return hit.link;
  return "";
};

/** Expand urls to every configured server domain (server switching). */
export const expandAcrossServers = (urls: string[]): string[] => {
  const servers = readCachedProxyServers();
  const out = new Set<string>();
  for (const raw of urls) {
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    out.add(raw);
    try {
      const u = new URL(raw);
      if (!servers.some((s) => hostOf(s.domain) === u.host.toLowerCase())) continue;
      for (const s of servers) {
        try {
          const d = new URL(/^https?:\/\//i.test(s.domain) ? s.domain : `https://${s.domain}`);
          out.add(`${d.protocol}//${d.host}${u.pathname}${u.search}`);
        } catch {}
      }
    } catch {}
  }
  return [...out];
};

export const prefetchProtectedUrls = async (urls: string[], timeoutMs = 6000): Promise<void> => {
  const byGateway = new Map<string, string[]>();
  for (const u of urls) {
    const gw = getProtectionGateway(u);
    if (!gw) continue;
    const hit = cache.get(u);
    if (hit && hit.exp * 1000 - Date.now() > 10 * 60_000) continue;
    byGateway.set(gw, [...(byGateway.get(gw) || []), u]);
  }
  await Promise.all([...byGateway.entries()].map(async ([gw, list]) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${gw.replace(/\/+$/, "")}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: list }),
        signal: ctrl.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      (data?.links || []).forEach((link: string, i: number) => {
        if (link) cache.set(list[i], { link, exp: Number(data.exp || 0) });
      });
    } catch {
      /* gateway down → protected server yields no candidate, player fails over */
    } finally { clearTimeout(t); }
  }));
};
