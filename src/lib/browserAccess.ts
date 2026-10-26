import { useEffect, useState } from "react";
import { db, ref, onValue, set, push, remove } from "@/lib/firebase";

/** Firebase node for the Chrome-only gate switch (missing = on) and the IP allow list. */
export const BROWSER_GATE_PATH = "settings/browserGate";
const CACHE_KEY = "rs_browser_gate_v1";
const IP_KEY = "rs_network_ip_v1";

export type AllowedIp = { ip: string; label?: string; addedAt: number };
export type BrowserGateConfig = { enabled: boolean; allowIps: Record<string, AllowedIp> };

export const normalizeIp = (ip: string) => String(ip || "").trim().toLowerCase();
export const isValidIp = (ip: string) => {
  const v = normalizeIp(ip);
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const v6 = /^[0-9a-f:]+$/;
  return v4.test(v) || (v.includes(":") && v6.test(v) && v.length >= 3);
};

export const parseGateConfig = (raw: unknown): BrowserGateConfig => {
  const r = (raw && typeof raw === "object" ? raw : {}) as { enabled?: unknown; allowIps?: unknown };
  const list = (r.allowIps && typeof r.allowIps === "object" ? r.allowIps : {}) as Record<string, AllowedIp>;
  const allowIps: Record<string, AllowedIp> = {};
  for (const [k, v] of Object.entries(list)) if (v && typeof v.ip === "string") allowIps[k] = v;
  return { enabled: r.enabled !== false, allowIps };
};

/**
 * Final say on the Chrome-only gate. Admin switch off → everyone passes.
 * An allowed network IP lets every browser in. Otherwise only supported browsers pass.
 */
export const browserGateBlocks = (supported: boolean, cfg: BrowserGateConfig, ip: string | null) => {
  if (supported || !cfg.enabled) return false;
  if (ip && Object.values(cfg.allowIps).some(a => normalizeIp(a.ip) === normalizeIp(ip))) return false;
  return true;
};

const readCache = (): BrowserGateConfig => {
  try { return parseGateConfig(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")); } catch { return parseGateConfig(null); }
};
export const cachedNetworkIp = (): string | null => {
  try { return localStorage.getItem(IP_KEY); } catch { return null; }
};

let ipPromise: Promise<string | null> | null = null;
export const fetchNetworkIp = (): Promise<string | null> => {
  if (ipPromise) return ipPromise;
  ipPromise = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal });
      const j = r.ok ? await r.json() : null;
      const ip = typeof j?.ip === "string" ? j.ip : null;
      if (ip) try { localStorage.setItem(IP_KEY, ip); } catch { /* ignore */ }
      return ip;
    } catch { return null; } finally { clearTimeout(t); }
  })();
  return ipPromise;
};

/** Live, cached (instant first paint) gate config. */
export const useBrowserGateConfig = (): BrowserGateConfig => {
  const [cfg, setCfg] = useState(readCache);
  useEffect(() => onValue(ref(db, BROWSER_GATE_PATH), snap => {
    const next = parseGateConfig(snap.val());
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setCfg(next);
  }), []);
  return cfg;
};

export const setBrowserGateEnabled = (on: boolean) => set(ref(db, `${BROWSER_GATE_PATH}/enabled`), on);
export const addAllowedIp = (ip: string, label?: string) =>
  push(ref(db, `${BROWSER_GATE_PATH}/allowIps`), { ip: normalizeIp(ip), label: (label || "").trim() || null, addedAt: Date.now() });
export const removeAllowedIp = (key: string) => remove(ref(db, `${BROWSER_GATE_PATH}/allowIps/${key}`));
