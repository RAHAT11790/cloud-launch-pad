// ============================================
// Monetag Ads — player-scoped loader with premium gate + per-slot cooldown.
// Ads are allowed ONLY while the video player is active and are torn down on exit.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __mtSlotsLoaded?: Record<string, boolean>;
    __mtCooldowns?: Record<string, number>;
    __mtPremium?: boolean;
    __mtPlayerScopeActive?: boolean;
    __mtCleanupState?: MonetagCleanupState;
  }
}

export type MonetagSlotKey =
  | "popunder"
  | "onclickPop"
  | "inPagePush"
  | "nativeBanner"
  | "vignette"
  | "smartBanner"
  | "directLink"
  | "custom1"
  | "custom2"
  | "custom3";

export type MonetagSlot = {
  enabled: boolean;
  src?: string;
  data?: Record<string, string | number>;
  raw?: string;
  cooldownSec?: number;
};

export type MonetagConfig = {
  enabled: boolean;
  slots: Partial<Record<MonetagSlotKey, MonetagSlot>>;
};

export type ParsedAd = {
  src?: string;
  dataAttrs?: Record<string, string>;
  rawHtml?: string;
};

type TrackedListener = {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};

type MonetagCleanupState = {
  nodes: HTMLElement[];
  listeners: TrackedListener[];
  timers: number[];
  intervals: number[];
  rafs: number[];
  captureUntil: number;
  observer?: MutationObserver;
};

const DEFAULT_CONFIG: MonetagConfig = { enabled: true, slots: {} };
const DEFAULT_COOLDOWN_SEC = 60;
const CAPTURE_WINDOW_MS = 5000;

let cached: MonetagConfig | null = null;
let cachedPromise: Promise<MonetagConfig> | null = null;
let trackerInstalled = false;
let originalAddEventListener: typeof EventTarget.prototype.addEventListener | null = null;
let originalSetTimeout: typeof window.setTimeout | null = null;
let originalSetInterval: typeof window.setInterval | null = null;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame | null = null;

function ensureCleanupState(): MonetagCleanupState | null {
  if (typeof window === "undefined") return null;
  if (!window.__mtCleanupState) {
    window.__mtCleanupState = {
      nodes: [],
      listeners: [],
      timers: [],
      intervals: [],
      rafs: [],
      captureUntil: 0,
    };
  }
  return window.__mtCleanupState;
}

function playerScopeActive(): boolean {
  return typeof window !== "undefined" && window.__mtPlayerScopeActive === true;
}

function shouldCaptureRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const state = ensureCleanupState();
  return !!state && playerScopeActive() && Date.now() <= state.captureUntil;
}

function extendCaptureWindow(ms: number = CAPTURE_WINDOW_MS) {
  const state = ensureCleanupState();
  if (!state) return;
  state.captureUntil = Math.max(state.captureUntil, Date.now() + ms);
}

function trackNode(node?: Element | null) {
  if (typeof window === "undefined" || !node || !(node instanceof HTMLElement)) return;
  const state = ensureCleanupState();
  if (!state) return;
  if (node === document.body || node === document.documentElement) return;
  if (!state.nodes.includes(node)) state.nodes.push(node);
}

function trackListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
  const state = ensureCleanupState();
  if (!state) return;
  state.listeners.push({ target, type, listener, options });
}

function installRuntimeTracker() {
  if (typeof window === "undefined" || trackerInstalled) return;

  originalAddEventListener = EventTarget.prototype.addEventListener;
  originalSetTimeout = window.setTimeout.bind(window);
  originalSetInterval = window.setInterval.bind(window);
  originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);

  EventTarget.prototype.addEventListener = function patchedAddEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener && shouldCaptureRuntime()) trackListener(this, type, listener, options);
    return originalAddEventListener!.call(this, type, listener, options as any);
  };

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    const id = originalSetTimeout!(handler, timeout, ...args);
    if (shouldCaptureRuntime()) ensureCleanupState()?.timers.push(Number(id));
    return id;
  }) as typeof window.setTimeout;

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    const id = originalSetInterval!(handler, timeout, ...args);
    if (shouldCaptureRuntime()) ensureCleanupState()?.intervals.push(Number(id));
    return id;
  }) as typeof window.setInterval;

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = originalRequestAnimationFrame!(callback);
    if (shouldCaptureRuntime()) ensureCleanupState()?.rafs.push(Number(id));
    return id;
  }) as typeof window.requestAnimationFrame;

  trackerInstalled = true;
}

function startDomObserver() {
  if (typeof window === "undefined") return;
  const state = ensureCleanupState();
  if (!state || state.observer) return;

  state.observer = new MutationObserver((mutations) => {
    if (!shouldCaptureRuntime()) return;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) trackNode(node);
      });
    }
  });

  state.observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function cleanupTrackedResources() {
  if (typeof window === "undefined") return;
  const state = ensureCleanupState();
  if (!state) return;

  state.observer?.disconnect();
  state.observer = undefined;

  for (const raf of state.rafs.splice(0)) {
    try { window.cancelAnimationFrame(raf); } catch {}
  }
  for (const timer of state.timers.splice(0)) {
    try { window.clearTimeout(timer); } catch {}
  }
  for (const interval of state.intervals.splice(0)) {
    try { window.clearInterval(interval); } catch {}
  }
  for (const { target, type, listener, options } of state.listeners.splice(0)) {
    try { target.removeEventListener(type, listener, options as any); } catch {}
  }
  for (const node of state.nodes.splice(0).reverse()) {
    try {
      if (node.isConnected) node.remove();
    } catch {}
  }

  state.captureUntil = 0;
}

function getCooldownMs(slot?: MonetagSlot): number {
  const value = Number(slot?.cooldownSec);
  const sec = value > 0 ? value : DEFAULT_COOLDOWN_SEC;
  return sec * 1000;
}

function getLastTriggerTs(slotKey: MonetagSlotKey): number {
  if (typeof window === "undefined") return 0;
  return window.__mtCooldowns?.[slotKey] || 0;
}

function isSlotCoolingDown(slotKey: MonetagSlotKey, slot?: MonetagSlot): boolean {
  const last = getLastTriggerTs(slotKey);
  if (!last) return false;
  return Date.now() - last < getCooldownMs(slot);
}

function markSlotTriggered(slotKey: MonetagSlotKey) {
  if (typeof window === "undefined") return;
  if (!window.__mtCooldowns) window.__mtCooldowns = {};
  window.__mtCooldowns[slotKey] = Date.now();
}

function slotMarker(key: string) {
  if (typeof window === "undefined") return false;
  if (!window.__mtSlotsLoaded) window.__mtSlotsLoaded = {};
  if (window.__mtSlotsLoaded[key]) return true;
  window.__mtSlotsLoaded[key] = true;
  return false;
}

function resetSessionMarkers() {
  if (typeof window === "undefined") return;
  window.__mtSlotsLoaded = {};
}

function premiumActive(): boolean {
  return typeof window !== "undefined" && window.__mtPremium === true;
}

function resolveSlotInput(slot?: MonetagSlot): string {
  if (!slot) return "";
  const raw = typeof slot.raw === "string" ? slot.raw.trim() : "";
  const src = typeof slot.src === "string" ? slot.src.trim() : "";
  return raw || src;
}

function canUseSlot(slotKey: MonetagSlotKey, slot?: MonetagSlot): boolean {
  if (typeof window === "undefined") return false;
  if (!playerScopeActive()) return false;
  if (premiumActive()) return false;
  if (!slot || slot.enabled === false) return false;
  if (!resolveSlotInput(slot)) return false;
  if (isSlotCoolingDown(slotKey, slot)) return false;
  return true;
}

export function parseAdInput(input: string): ParsedAd {
  const txt = (input || "").trim();
  if (!txt) return {};

  if (/^https?:\/\/\S+$/i.test(txt)) return { src: txt };

  const dataAttrs: Record<string, string> = {};
  const scriptTagMatch = txt.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/i);
  if (scriptTagMatch) {
    const attrs = scriptTagMatch[1] || "";
    const inner = (scriptTagMatch[2] || "").trim();

    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const dataAttrRe = /\bdata-([a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = dataAttrRe.exec(attrs))) dataAttrs[m[1]] = m[2];

    if (inner) {
      const innerSrc = inner.match(/s\.src\s*=\s*['"]([^'"]+)['"]/);
      const datasetRe = /s\.dataset\.([a-zA-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g;
      let dm: RegExpExecArray | null;
      while ((dm = datasetRe.exec(inner))) dataAttrs[dm[1]] = dm[2];

      if (innerSrc?.[1]) {
        return { src: innerSrc[1], dataAttrs: Object.keys(dataAttrs).length ? dataAttrs : undefined };
      }
      if (!srcMatch) return { rawHtml: txt };
    }

    if (srcMatch?.[1]) {
      return { src: srcMatch[1], dataAttrs: Object.keys(dataAttrs).length ? dataAttrs : undefined };
    }
    return { rawHtml: txt };
  }

  const bareSrc = txt.match(/s\.src\s*=\s*['"]([^'"]+)['"]/);
  if (bareSrc?.[1]) {
    const datasetRe = /s\.dataset\.([a-zA-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g;
    let dm: RegExpExecArray | null;
    while ((dm = datasetRe.exec(txt))) dataAttrs[dm[1]] = dm[2];
    return { src: bareSrc[1], dataAttrs: Object.keys(dataAttrs).length ? dataAttrs : undefined };
  }

  if (/[{};=()]/.test(txt) && !/^</.test(txt)) {
    return { rawHtml: `<script>${txt}</script>` };
  }
  return { rawHtml: txt };
}

function normalize(v: any): MonetagConfig {
  const slots: MonetagConfig["slots"] = {};
  const raw = (v && v.slots) || {};
  for (const k of Object.keys(raw)) {
    const s = raw[k] || {};
    slots[k as MonetagSlotKey] = {
      enabled: s.enabled !== false,
      src: typeof s.src === "string" ? s.src.trim() : "",
      data: typeof s.data === "object" && s.data ? s.data : undefined,
      raw: typeof s.raw === "string" ? s.raw : "",
      cooldownSec: Number(s.cooldownSec) > 0 ? Number(s.cooldownSec) : undefined,
    };
  }
  return { enabled: v?.enabled !== false, slots };
}

export async function getMonetagConfig(): Promise<MonetagConfig> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const snap = await get(ref(db, "settings/monetag"));
      cached = normalize(snap.val());
    } catch {
      cached = { ...DEFAULT_CONFIG };
    }
    return cached!;
  })();
  return cachedPromise;
}

export function subscribeMonetagConfig(cb: (c: MonetagConfig) => void) {
  return onValue(ref(db, "settings/monetag"), (snap) => {
    cached = normalize(snap.val());
    cb(cached);
  });
}

export function setPremium(isPremium: boolean) {
  if (typeof window !== "undefined") window.__mtPremium = !!isPremium;
}

export function enterMonetagPlayerScope() {
  if (typeof window === "undefined") return;
  window.__mtPlayerScopeActive = true;
  ensureCleanupState();
  installRuntimeTracker();
  startDomObserver();
  resetSessionMarkers();
}

export function exitMonetagPlayerScope() {
  if (typeof window === "undefined") return;
  window.__mtPlayerScopeActive = false;
  cleanupTrackedResources();
  resetSessionMarkers();
}

async function loadScriptResilient(
  url: string,
  dataAttrs?: Record<string, string | number>,
  attr: string = "data-mt-x",
): Promise<boolean> {
  if (!url || typeof document === "undefined" || !playerScopeActive()) return false;
  extendCaptureWindow();

  const direct = await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };

    try {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.referrerPolicy = "no-referrer";
      s.setAttribute(attr, "1");
      s.dataset.cfasync = "false";
      if (dataAttrs) {
        for (const k of Object.keys(dataAttrs)) {
          try { s.setAttribute(`data-${k}`, String(dataAttrs[k])); } catch {}
        }
      }
      trackNode(s);
      s.onload = () => {
        extendCaptureWindow(1500);
        finish(true);
      };
      s.onerror = () => finish(false);
      (document.body || document.documentElement).appendChild(s);
      window.setTimeout(() => finish(false), 2500);
    } catch {
      finish(false);
    }
  });
  if (direct) return true;

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return false;
    const code = await res.text();
    if (!code || code.length < 8) return false;
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<boolean>((resolve) => {
      try {
        const s = document.createElement("script");
        s.src = blobUrl;
        s.async = true;
        s.setAttribute(attr, "2");
        s.dataset.cfasync = "false";
        if (dataAttrs) {
          for (const k of Object.keys(dataAttrs)) {
            try { s.setAttribute(`data-${k}`, String(dataAttrs[k])); } catch {}
          }
        }
        trackNode(s);
        s.onload = () => {
          extendCaptureWindow(1500);
          resolve(true);
        };
        s.onerror = () => resolve(false);
        (document.body || document.documentElement).appendChild(s);
        window.setTimeout(() => resolve(true), 1500);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

async function injectRawSnippet(html: string, attr: string): Promise<void> {
  if (!html || typeof document === "undefined" || !playerScopeActive()) return;
  extendCaptureWindow();
  try {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(attr, "1");
    wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    wrapper.innerHTML = html;
    const scripts = Array.from(wrapper.querySelectorAll("script"));
    for (const old of scripts) {
      const ns = document.createElement("script");
      for (const a of Array.from(old.attributes)) ns.setAttribute(a.name, a.value);
      ns.text = old.text;
      trackNode(ns);
      old.replaceWith(ns);
    }
    trackNode(wrapper);
    document.body.appendChild(wrapper);
  } catch {}
}

async function injectSlot(slotKey: MonetagSlotKey, slot: MonetagSlot, attrBase: string) {
  const parsed = parseAdInput(resolveSlotInput(slot));
  const mergedData = { ...(slot.data || {}), ...(parsed.dataAttrs || {}) };
  if (parsed.src) {
    await loadScriptResilient(parsed.src, mergedData, attrBase);
    return;
  }
  if (parsed.rawHtml) {
    await injectRawSnippet(parsed.rawHtml, attrBase);
  }
}

export async function loadAmbientSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!playerScopeActive() || premiumActive()) return;
  const cfg = await getMonetagConfig();
  if (!cfg.enabled) return;

  const ambientKeys: MonetagSlotKey[] = [
    "inPagePush",
    "nativeBanner",
    "vignette",
    "smartBanner",
    "custom1",
    "custom2",
    "custom3",
  ];

  for (const key of ambientKeys) {
    const slot = cfg.slots[key];
    if (!canUseSlot(key, slot)) continue;
    if (slotMarker(`mt_${key}`)) continue;
    markSlotTriggered(key);
    await injectSlot(key, slot!, `data-mt-${key}`);
  }
}

export async function triggerClickSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!playerScopeActive() || premiumActive()) return;

  const cfg = await getMonetagConfig();
  if (!cfg.enabled) return;

  const clickScriptKeys: MonetagSlotKey[] = ["popunder", "onclickPop"];

  for (const key of clickScriptKeys) {
    const slot = cfg.slots[key];
    if (!canUseSlot(key, slot)) continue;
    if (slotMarker(`mt_${key}`)) continue;
    markSlotTriggered(key);
    await injectSlot(key, slot!, `data-mt-${key}`);
  }

  const directLink = cfg.slots.directLink;
  if (canUseSlot("directLink", directLink)) {
    const parsed = parseAdInput(resolveSlotInput(directLink));
    const target = parsed.src || resolveSlotInput(directLink);
    if (target && /^https?:\/\//i.test(target)) {
      markSlotTriggered("directLink");
      try { window.open(target, "_blank", "noopener,noreferrer"); } catch {}
    }
  }
}

export const loadPopunderOnce = loadAmbientSlots;
export const triggerDirectLink = async (): Promise<boolean> => {
  await triggerClickSlots();
  return true;
};

export function resetMonetagSession() {
  if (typeof window === "undefined") return;
  cleanupTrackedResources();
  resetSessionMarkers();
}
