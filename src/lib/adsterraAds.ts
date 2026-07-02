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
//   • Player clicks inject both configured placements: Stream/Social/Push link
//     and One-Click Popunder. No app-level cooldown is applied.
//   • A MutationObserver tracks every node Adsterra adds to <body> while
//     the player is open, so when the player closes we can rip every
//     ad-injected node out (kills leftover social bars, popunder hooks).
//   • Live config subscription: changes to settings/adsterra in Firebase
//     are picked up immediately and re-mounted.
//   • No timer cooldown: every player tap can request a fresh ad call.
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
    __adsterraLastPopAt?: number;
    __adsterraOpenWrapped?: boolean;
    __adsterraOpenOriginal?: Window["open"];
    __adsterraPendingPopunderUrl?: string;
    __adsterraPendingPopunderSnippet?: string;
    __adsterraGestureBridgeInstalled?: boolean;

  }
}

export type AdsterraConfig = {
  enabled: boolean;
  popunder: string;
  streamLink: string;
  pushNotification: string;
  refreshIntervalSec: number; // legacy only; player no longer uses cooldown timers
};

const DEFAULT: AdsterraConfig = {
  enabled: true,
  popunder: "",
  streamLink: "",
  pushNotification: "",
  refreshIntervalSec: 50,
};

let cached: AdsterraConfig | null = null;
let cachedPromise: Promise<AdsterraConfig> | null = null;

function normalize(v: any): AdsterraConfig {
  const n = Number(v?.refreshIntervalSec);
  return {
    enabled: v?.enabled !== false,
    popunder: typeof v?.popunder === "string" ? v.popunder : "",
    streamLink: typeof v?.streamLink === "string" ? v.streamLink : "",
    pushNotification: typeof v?.pushNotification === "string" ? v.pushNotification : "",
    refreshIntervalSec: Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : 50,
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

function hasSnippets(cfg: AdsterraConfig) {
  return !!(cfg.popunder.trim() || cfg.streamLink.trim());
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
  div.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;overflow:hidden;pointer-events:none;z-index:2147483000";
  document.body.appendChild(div);
  window.__adsterraContainer = div;
  return div;
}

function removeNotificationLikeNode(node: HTMLElement | null) {
  if (!node || !(node instanceof HTMLElement) || !node.isConnected) return;
  if (isOwnedNode(node)) return;
}

function installPopunderThrottle() {
  if (typeof window === "undefined") return;
  if (window.__adsterraOpenWrapped) return;
  window.__adsterraOpenWrapped = true;
  const origOpen = window.open?.bind(window);
  if (!origOpen) return;
  window.__adsterraOpenOriginal = origOpen as typeof window.open;
  window.open = function (url?: string | URL, target?: string, features?: string): Window | null {
    try {
      const urlStr = String(url ?? "");
      // Treat empty / same-origin / hash links as legitimate app navigation.
      const isAppUrl =
        !urlStr ||
        urlStr.startsWith("#") ||
        urlStr.startsWith("/") ||
        urlStr.startsWith("mailto:") ||
        urlStr.startsWith("tel:") ||
        urlStr.startsWith(location.origin);
      if (!isAppUrl) window.__adsterraLastPopAt = Date.now();
    } catch {}
    return origOpen(url as any, target as any, features as any);
  } as typeof window.open;
}

function triggerPopunderUrl(url: string) {
  if (typeof window === "undefined") return;
  const clean = String(url || "").trim();
  if (!clean) return;
  try {
    window.__adsterraLastPopAt = Date.now();
    const opener = window.__adsterraOpenOriginal || window.open;
    opener?.(clean, "_blank", "noopener,noreferrer");
  } catch {}
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
          window.setTimeout(() => removeNotificationLikeNode(node as HTMLElement), 80);
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

function removeKnownAdResidue() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const shouldSkip = (el: HTMLElement) => {
    if (el.id === "root") return true;
    if (el.closest("[data-sonner-toaster], [data-radix-portal], [data-vaul-drawer]") || el.matches("[data-sonner-toaster], [data-radix-portal], [data-vaul-drawer]")) return true;
    return false;
  };
  const looksLikeAd = (el: HTMLElement) => {
    const fingerprint = `${el.id || ""} ${el.className || ""} ${el.getAttribute("data-zone") || ""} ${el.getAttribute("data-cfasync") || ""}`.toLowerCase();
    if (/adsterra|social.?bar|popunder|invoke|atcontainer|ads?[-_]/i.test(fingerprint)) return true;
    if (el.querySelector('script[src*="adsterra"], script[src*="highperformanceformat"], script[src*="profitabledisplaynetwork"], iframe[src*="adsterra"], iframe[src*="highperformanceformat"], iframe[src*="profitabledisplaynetwork"]')) return true;
    try {
      const cs = window.getComputedStyle(el);
      const zi = Number.parseInt(cs.zIndex || "0", 10);
      if (cs.position === "fixed" && zi >= 10000 && (el.querySelector("iframe") || /ad|banner|pop|social/i.test(fingerprint))) return true;
    } catch {}
    return false;
  };

  Array.from(document.body.children).forEach((node) => {
    if (!(node instanceof HTMLElement) || shouldSkip(node)) return;
    if (isOwnedNode(node) || looksLikeAd(node)) {
      try { node.remove(); } catch {}
    }
  });
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

  if (/^https?:\/\//i.test(trimmed) && !trimmed.includes("<")) {
    triggerPopunderUrl(trimmed);
    return [] as Promise<void>[];
  }

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

function extractDirectUrl(snippet: string) {
  const trimmed = String(snippet || "").trim();
  if (/^https?:\/\//i.test(trimmed) && !trimmed.includes("<")) return trimmed;
  const match = trimmed.match(/https?:\/\/[^'"\s<>]+/i);
  return match?.[0] || "";
}

function prewarmPopunderForNextGesture(cfg: AdsterraConfig) {
  if (typeof window === "undefined") return;
  if (!cfg.popunder.trim()) return;
  window.__adsterraPendingPopunderUrl = extractDirectUrl(cfg.popunder);
  window.__adsterraPendingPopunderSnippet = cfg.popunder;
}

function installPopunderGestureBridge() {
  if (typeof window === "undefined") return;
  if (window.__adsterraGestureBridgeInstalled) return;
  window.__adsterraGestureBridgeInstalled = true;
  const handler = () => {
    const url = window.__adsterraPendingPopunderUrl;
    const snippet = window.__adsterraPendingPopunderSnippet;
    if (!url && !snippet) return;
    window.__adsterraPendingPopunderUrl = undefined;
    window.__adsterraPendingPopunderSnippet = undefined;
    if (snippet && !/^https?:\/\//i.test(snippet.trim())) {
      try { injectSnippet(snippet, ensureContainer()); } catch {}
      return;
    }
    if (url) triggerPopunderUrl(url);
  };
  window.addEventListener("pointerup", handler, { capture: true, passive: true });
  window.addEventListener("touchend", handler, { capture: true, passive: true });
  window.addEventListener("click", handler, { capture: true, passive: true });
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

  prewarmPopunderForNextGesture(cfg);

  const pending: Promise<void>[] = [];
  pending.push(...injectSnippet(cfg.streamLink, container));
  pending.push(...injectSnippet(cfg.popunder, container));
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
  removeKnownAdResidue();
  window.__adsterraPlayerScopeActive = true;
  installPopunderThrottle();
  installPopunderGestureBridge();

}

export function exitAdsterraPlayerScope() {
  if (typeof window === "undefined") return;
  window.__adsterraPlayerScopeActive = false;
  clearRefreshTimer();
  stopObserver();
  dismissVisibleAds(false);
  removeKnownAdResidue();
  window.setTimeout(removeKnownAdResidue, 250);
  window.setTimeout(removeKnownAdResidue, 1200);
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
  window.__adsterraPendingPopunderUrl = undefined;
  window.__adsterraPendingPopunderSnippet = undefined;
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

  if (window.__adsterraMountPromise) {
    return window.__adsterraMountPromise;
  }

  window.__adsterraLastConfigJson = json;
  await mountAdCycle(cfg);
}
