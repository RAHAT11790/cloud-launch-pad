// ============================================
// Adsterra Ads — real-script injection (player-scoped).
//
// Why this rewrite:
//   The previous sandboxed-iframe + srcdoc strategy never let Adsterra's
//   invoke.js execute in a useful context (most snippets attach DOM nodes
//   to the host document, set cookies, or read URL params — none of which
//   work in a fully sandboxed iframe). On top of that the bottom-fixed
//   social-bar iframe (z-index 2147483600, height 92px) sat above the
//   episode list and intercepted taps on the lower episode rows.
//
// New strategy:
//   • Parse the admin-saved <script> snippet, recreate real <script>
//     elements, and append them to a normal <div> inside <body>.
//   • Adsterra's social-bar / popunder scripts then load and self-mount
//     their own fixed elements as designed — when they fail (no fill /
//     blocked / network error) NOTHING is left over to block clicks.
//   • A MutationObserver tracks every node Adsterra adds to <body> while
//     the player is open, so when the player closes we can rip every
//     ad-injected node out (kills leftover social bars, popunder hooks).
//   • Live config subscription: changes to settings/adsterra in Firebase
//     are picked up immediately and re-mounted.
//   • Configurable refresh interval — full teardown + re-inject every N s.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __adsterraPlayerScopeActive?: boolean;
    __adsterraPremium?: boolean;
    __adsterraContainer?: HTMLDivElement | null;
    __adsterraTrackedNodes?: Set<Node>;
    __adsterraObserver?: MutationObserver | null;
    __adsterraRefreshTimer?: number;
    __adsterraConfigUnsub?: (() => void) | null;
    __adsterraLastConfigJson?: string;
    __adsterraActiveConfig?: AdsterraConfig | null;
    __adsterraCycleId?: number;
    __adsterraCloseButton?: HTMLButtonElement | null;
    __adsterraLastLoadAt?: number;
    __adsterraMountPromise?: Promise<void> | null;
    __adsterraLastInteractionAt?: number;
  }
}

export type AdsterraConfig = {
  enabled: boolean;
  popunder: string;
  socialBar: string;
  refreshIntervalSec: number; // 0 = no refresh
};

const DEFAULT: AdsterraConfig = {
  enabled: true,
  popunder: "",
  socialBar: "",
  refreshIntervalSec: 60,
};

let cached: AdsterraConfig | null = null;
let cachedPromise: Promise<AdsterraConfig> | null = null;

function normalize(v: any): AdsterraConfig {
  const n = Number(v?.refreshIntervalSec);
  return {
    enabled: v?.enabled !== false,
    popunder: typeof v?.popunder === "string" ? v.popunder : "",
    socialBar: typeof v?.socialBar === "string" ? v.socialBar : "",
    refreshIntervalSec: Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : 60,
  };
}

export async function getAdsterraConfig(): Promise<AdsterraConfig> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    try {
      const snap = await get(ref(db, "settings/adsterra"));
      cached = normalize(snap.val());
    } catch {
      cached = { ...DEFAULT };
    }
    cachedPromise = null;
    return cached!;
  })();
  return cachedPromise;
}

export function subscribeAdsterraConfig(cb: (c: AdsterraConfig) => void) {
  return onValue(ref(db, "settings/adsterra"), (snap) => {
    cached = normalize(snap.val());
    cb(cached);
  });
}

export function setAdsterraPremium(p: boolean) {
  if (typeof window !== "undefined") window.__adsterraPremium = !!p;
}

export function markAdsterraInteractionNow() {
  if (typeof window === "undefined") return;
  window.__adsterraLastInteractionAt = Date.now();
}

export function getAdsterraLastInteractionAt(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.__adsterraLastInteractionAt || 0);
}

function hasSnippets(cfg: AdsterraConfig) {
  return !!(cfg.popunder.trim() || cfg.socialBar.trim());
}

function isOwnedNode(node: Node) {
  return node instanceof HTMLElement && node.dataset.adsterraOwned === "true";
}

function clearCloseButton() {
  if (typeof window === "undefined") return;
  try { window.__adsterraCloseButton?.remove(); } catch {}
  window.__adsterraCloseButton = null;
}

function hasVisibleAdNodes() {
  if (typeof window === "undefined") return false;
  const tracked = window.__adsterraTrackedNodes;
  if (!tracked?.size) return false;

  for (const node of tracked) {
    if (!(node instanceof HTMLElement) || !node.isConnected) continue;
    const cs = window.getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
    if (node.offsetWidth > 0 || node.offsetHeight > 0 || node.querySelector("iframe")) return true;
  }

  return false;
}

function scheduleRefresh(cfg: AdsterraConfig, baseTs: number) {
  if (typeof window === "undefined") return;
  clearRefreshTimer();
  if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;
  if (!cfg.enabled || !hasSnippets(cfg) || cfg.refreshIntervalSec <= 0) return;

  const dueTs = baseTs + cfg.refreshIntervalSec * 1000;
  const delay = Math.max(0, dueTs - Date.now());
  window.__adsterraRefreshTimer = window.setTimeout(() => {
    const lastInteractionAt = getAdsterraLastInteractionAt();
    if (!lastInteractionAt || Date.now() - lastInteractionAt > 2000) return;
    const nextCfg = window.__adsterraActiveConfig ?? cfg;
    mountAdCycle(nextCfg, true).catch(() => {
      scheduleRefresh(nextCfg, Date.now());
    });
  }, delay) as unknown as number;
}

function dismissVisibleAds(resetTimer = true) {
  if (typeof window === "undefined") return;
  removeTrackedNodes();
  clearContainer();
  clearCloseButton();
  if (resetTimer) {
    const cfg = window.__adsterraActiveConfig;
    if (cfg) scheduleRefresh(cfg, Date.now());
  }
}

function ensureCloseButton(cfg: AdsterraConfig) {
  if (typeof window === "undefined") return;
  if (!cfg.enabled || !hasSnippets(cfg)) {
    clearCloseButton();
    return;
  }
  if (window.__adsterraCloseButton?.isConnected) return;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.adsterraOwned = "true";
  button.setAttribute("aria-label", "Close ad");
  button.textContent = "Close ad";
  button.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:12px",
    "z-index:2147483646",
    "padding:8px 12px",
    "border-radius:999px",
    "border:1px solid hsl(var(--border) / 0.7)",
    "background:hsl(var(--background) / 0.92)",
    "color:hsl(var(--foreground))",
    "box-shadow:0 10px 30px hsl(var(--background) / 0.45)",
    "font:600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "letter-spacing:0",
    "cursor:pointer",
    "backdrop-filter:blur(10px)",
    "-webkit-backdrop-filter:blur(10px)",
  ].join(";");
  button.addEventListener("click", () => dismissVisibleAds(false));
  document.body.appendChild(button);
  window.__adsterraCloseButton = button;
}

// ---------- Tracking & cleanup ----------
function ensureContainer(): HTMLDivElement {
  if (typeof document === "undefined") throw new Error("No document");
  if (window.__adsterraContainer && window.__adsterraContainer.isConnected) {
    return window.__adsterraContainer;
  }
  const div = document.createElement("div");
  div.setAttribute("data-adsterra-root", "true");
  div.dataset.adsterraOwned = "true";
  div.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-9999px;top:-9999px";
  document.body.appendChild(div);
  window.__adsterraContainer = div;
  return div;
}

function startObserver() {
  if (typeof window === "undefined") return;
  if (window.__adsterraObserver) return;
  if (!window.__adsterraTrackedNodes) window.__adsterraTrackedNodes = new Set();
  const tracked = window.__adsterraTrackedNodes!;
  const obs = new MutationObserver((mutations) => {
    if (!window.__adsterraPlayerScopeActive) return;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        // Skip nodes we added ourselves through the container
        if (node === window.__adsterraContainer) return;
        if (isOwnedNode(node)) return;
        // Track only direct children of <body>, <html>, or <head> — that's
        // where Adsterra typically attaches its fixed social bar/popunder
        // helpers. Avoid touching unrelated app DOM.
        const parent = (node as Node).parentNode;
        if (parent === document.body || parent === document.documentElement || parent === document.head) {
          tracked.add(node);
        }
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.__adsterraObserver = obs;
}

function stopObserver() {
  if (typeof window === "undefined") return;
  try { window.__adsterraObserver?.disconnect(); } catch {}
  window.__adsterraObserver = null;
}

function removeTrackedNodes() {
  if (typeof window === "undefined") return;
  const tracked = window.__adsterraTrackedNodes;
  if (!tracked) return;
  tracked.forEach((node) => {
    try {
      if ((node as ChildNode).isConnected) (node as ChildNode).remove();
    } catch {}
  });
  tracked.clear();
}

function clearRefreshTimer() {
  if (typeof window === "undefined") return;
  if (window.__adsterraRefreshTimer) {
    window.clearTimeout(window.__adsterraRefreshTimer);
    window.__adsterraRefreshTimer = undefined;
  }
}

function injectSnippet(snippet: string, container: HTMLElement) {
  const trimmed = (snippet || "").trim();
  if (!trimmed) return [] as Promise<void>[];
  const tmp = document.createElement("div");
  tmp.innerHTML = trimmed;

  // Move non-script nodes first (Adsterra often wants a <div id="..."></div>
  // mount point alongside the script).
  const scripts: HTMLScriptElement[] = [];
  const pending: Promise<void>[] = [];
  Array.from(tmp.childNodes).forEach((node) => {
    if (node.nodeType === 1 && (node as Element).tagName === "SCRIPT") {
      scripts.push(node as HTMLScriptElement);
    } else {
      container.appendChild(node);
    }
  });

  // Recreate real script elements so the browser actually executes them.
  scripts.forEach((old) => {
    const s = document.createElement("script");
    Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
    if (old.textContent) s.textContent = old.textContent;
    if (s.src) s.async = true;
    pending.push(new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (s.src) {
        s.addEventListener("load", finish, { once: true });
        s.addEventListener("error", finish, { once: true });
        window.setTimeout(finish, 8000);
      } else {
        queueMicrotask(finish);
      }
    }));
    container.appendChild(s);
  });

  return pending;
}

function clearContainer() {
  if (typeof window === "undefined") return;
  const c = window.__adsterraContainer;
  if (c) {
    try { c.innerHTML = ""; } catch {}
  }
}

async function injectOnce(cfg: AdsterraConfig) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;
  if (!cfg.enabled || !hasSnippets(cfg)) {
    dismissVisibleAds(false);
    return;
  }

  // Full teardown of previous cycle (both our container AND anything ad
  // scripts injected into body during the last cycle).
  dismissVisibleAds(false);

  const container = ensureContainer();
  startObserver();

  const pending: Promise<void>[] = [];
  if (cfg.socialBar?.trim()) pending.push(...injectSnippet(cfg.socialBar, container));
  if (cfg.popunder?.trim()) pending.push(...injectSnippet(cfg.popunder, container));
  if (pending.length) {
    await Promise.allSettled(pending);
  }

  if (hasVisibleAdNodes()) ensureCloseButton(cfg);
  else clearCloseButton();
}

async function mountAdCycle(cfg: AdsterraConfig, fromTimer = false) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;

  const nextCycleId = (window.__adsterraCycleId ?? 0) + 1;
  window.__adsterraCycleId = nextCycleId;
  window.__adsterraActiveConfig = cfg;
  if (!fromTimer) clearRefreshTimer();

  const run = (async () => {
    await injectOnce(cfg);
    if (window.__adsterraCycleId !== nextCycleId) return;

    window.__adsterraLastLoadAt = Date.now();
    scheduleRefresh(cfg, window.__adsterraLastLoadAt);
  })();

  window.__adsterraMountPromise = run;
  try {
    await run;
  } finally {
    if (window.__adsterraMountPromise === run) {
      window.__adsterraMountPromise = null;
    }
  }
}

export function enterAdsterraPlayerScope() {
  if (typeof window === "undefined") return;
  window.__adsterraPlayerScopeActive = true;
}

export function exitAdsterraPlayerScope() {
  if (typeof window === "undefined") return;
  window.__adsterraPlayerScopeActive = false;
  clearRefreshTimer();
  stopObserver();
  dismissVisibleAds(false);
  try { window.__adsterraContainer?.remove(); } catch {}
  window.__adsterraContainer = null;
  if (window.__adsterraConfigUnsub) {
    try { window.__adsterraConfigUnsub(); } catch {}
    window.__adsterraConfigUnsub = null;
  }
  window.__adsterraActiveConfig = null;
  window.__adsterraCycleId = 0;
  window.__adsterraLastLoadAt = undefined;
  window.__adsterraMountPromise = null;
  window.__adsterraLastConfigJson = undefined;
  window.__adsterraLastInteractionAt = undefined;
}

export async function loadAdsterraSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;

  const cfg = await getAdsterraConfig();
  const json = JSON.stringify(cfg);

  if (!window.__adsterraConfigUnsub) {
    window.__adsterraConfigUnsub = subscribeAdsterraConfig((nextCfg) => {
      const nextJson = JSON.stringify(nextCfg);
      if (nextJson === window.__adsterraLastConfigJson) return;
      window.__adsterraLastConfigJson = nextJson;
      mountAdCycle(nextCfg).catch(() => {
        scheduleRefresh(nextCfg, Date.now());
      });
    });
  }

  if (window.__adsterraLastConfigJson === json && (window.__adsterraRefreshTimer || window.__adsterraLastLoadAt)) {
    return;
  }
  if (window.__adsterraMountPromise) {
    return window.__adsterraMountPromise;
  }

  window.__adsterraLastConfigJson = json;
  await mountAdCycle(cfg);
}

export async function forceReloadAdsterraSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;
  const cfg = await getAdsterraConfig();
  window.__adsterraLastConfigJson = JSON.stringify(cfg);
  await mountAdCycle(cfg);
}
