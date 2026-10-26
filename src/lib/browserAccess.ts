import { useEffect, useState } from "react";
import { db, ref, onValue, set, push, remove } from "@/lib/firebase";

/** Firebase node for the Chrome-only gate switch (missing = on) and the IP allow list. */
export const BROWSER_GATE_PATH = "settings/browserGate";
const CACHE_KEY = "rs_browser_gate_v1";
const IP_KEY = "rs_network_ip_v1";

export type AllowedIp = { ip: string; label?: string; addedAt: number };
export type AllowedDevice = { deviceId: string; label?: string; addedAt: number };
export type BrowserGateConfig = { enabled: boolean; allowIps: Record<string, AllowedIp>; allowDevices: Record<string, AllowedDevice> };

export const normalizeDeviceId = (id: string) => String(id || "").trim().toUpperCase().replace(/\s+/g, "");
export const isValidDeviceId = (id: string) => /^RS-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(normalizeDeviceId(id));

const DEVICE_KEY = "rs_gate_device_id_v1";
const hash32 = (s: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
};
const part = (n: number) => n.toString(36).toUpperCase().padStart(4, "0").slice(-4);
/**
 * Device ID for the browser gate. Built only from hardware/screen traits (no IP, no browser version),
 * so it stays the same when the network IP or Wi-Fi changes and even after site data is cleared.
 */
export const getGateDeviceId = (): string => {
  try { const c = localStorage.getItem(DEVICE_KEY); if (c && isValidDeviceId(c)) return c; } catch { /* ignore */ }
  let canvas = "nc";
  try {
    const c = document.createElement("canvas"); c.width = 200; c.height = 40;
    const ctx = c.getContext("2d");
    if (ctx) { ctx.textBaseline = "top"; ctx.font = "14px Arial"; ctx.fillStyle = "#f60"; ctx.fillRect(10, 5, 60, 20); ctx.fillStyle = "#069"; ctx.fillText("RS-gate-ID", 2, 2); canvas = c.toDataURL(); }
  } catch { /* ignore */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const sc = window.screen;
  const raw = [nav.platform, sc ? `${Math.max(sc.width, sc.height)}x${Math.min(sc.width, sc.height)}x${sc.colorDepth}` : "", window.devicePixelRatio || 1,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "", nav.hardwareConcurrency || 0, nav.deviceMemory || 0, nav.maxTouchPoints || 0, canvas].join("|");
  const id = `RS-${part(hash32(raw, 1))}-${part(hash32(raw, 7))}`;
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
  return id;
};

export const normalizeIp = (ip: string) => String(ip || "").trim().toLowerCase();
export const isValidIp = (ip: string) => {
  const v = normalizeIp(ip);
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const v6 = /^[0-9a-f:]+$/;
  return v4.test(v) || (v.includes(":") && v6.test(v) && v.length >= 3);
};

export const parseGateConfig = (raw: unknown): BrowserGateConfig => {
  const r = (raw && typeof raw === "object" ? raw : {}) as { enabled?: unknown; allowIps?: unknown; allowDevices?: unknown };
  const list = (r.allowIps && typeof r.allowIps === "object" ? r.allowIps : {}) as Record<string, AllowedIp>;
  const allowIps: Record<string, AllowedIp> = {};
  for (const [k, v] of Object.entries(list)) if (v && typeof v.ip === "string") allowIps[k] = v;
  const dl = (r.allowDevices && typeof r.allowDevices === "object" ? r.allowDevices : {}) as Record<string, AllowedDevice>;
  const allowDevices: Record<string, AllowedDevice> = {};
  for (const [k, v] of Object.entries(dl)) if (v && typeof v.deviceId === "string") allowDevices[k] = v;
  return { enabled: r.enabled !== false, allowIps, allowDevices };
};

/**
 * Final say on the Chrome-only gate. Admin switch off → everyone passes.
 * An allowed network IP or allowed device ID lets every browser in. Otherwise only supported browsers pass.
 */
export const browserGateBlocks = (supported: boolean, cfg: BrowserGateConfig, ip: string | null, deviceId?: string | null) => {
  if (supported || !cfg.enabled) return false;
  if (deviceId && Object.values(cfg.allowDevices).some(d => normalizeDeviceId(d.deviceId) === normalizeDeviceId(deviceId))) return false;
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
export const addAllowedDevice = (deviceId: string, label?: string) =>
  push(ref(db, `${BROWSER_GATE_PATH}/allowDevices`), { deviceId: normalizeDeviceId(deviceId), label: (label || "").trim() || null, addedAt: Date.now() });
export const removeAllowedDevice = (key: string) => remove(ref(db, `${BROWSER_GATE_PATH}/allowDevices/${key}`));
