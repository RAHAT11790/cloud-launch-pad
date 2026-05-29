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

// ---------- Tracking & cleanup ----------
function ensureContainer(): HTMLDivElement {
  if (typeof document === "undefined") throw new Error("No document");
  if (window.__adsterraContainer && window.__adsterraContainer.isConnected) {
    return window.__adsterraContainer;
  }
  const div = document.createElement("div");
  div.setAttribute("data-adsterra-root", "true");
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
    window.clearInterval(window.__adsterraRefreshTimer);
    window.__adsterraRefreshTimer = undefined;
  }
}

function injectSnippet(snippet: string, container: HTMLElement) {
  const trimmed = (snippet || "").trim();
  if (!trimmed) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = trimmed;

  // Move non-script nodes first (Adsterra often wants a <div id="..."></div>
  // mount point alongside the script).
  const scripts: HTMLScriptElement[] = [];
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
    s.async = true;
    container.appendChild(s);
  });
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
  if (!cfg.enabled) return;

  // Full teardown of previous cycle (both our container AND anything ad
  // scripts injected into body during the last cycle).
  removeTrackedNodes();
  clearContainer();

  const container = ensureContainer();
  startObserver();

  if (cfg.socialBar?.trim()) injectSnippet(cfg.socialBar, container);
  if (cfg.popunder?.trim()) injectSnippet(cfg.popunder, container);
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
  removeTrackedNodes();
  clearContainer();
  try { window.__adsterraContainer?.remove(); } catch {}
  window.__adsterraContainer = null;
  if (window.__adsterraConfigUnsub) {
    try { window.__adsterraConfigUnsub(); } catch {}
    window.__adsterraConfigUnsub = null;
  }
  window.__adsterraLastConfigJson = undefined;
}

export async function loadAdsterraSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;

  const cfg = await getAdsterraConfig();
  await applyConfig(cfg);

  // Live subscription so admin edits + refresh-interval changes apply
  // immediately without closing the player.
  if (!window.__adsterraConfigUnsub) {
    window.__adsterraConfigUnsub = subscribeAdsterraConfig((nextCfg) => {
      const json = JSON.stringify(nextCfg);
      if (json === window.__adsterraLastConfigJson) return;
      window.__adsterraLastConfigJson = json;
      applyConfig(nextCfg);
    });
  }
}

async function applyConfig(cfg: AdsterraConfig) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;

  window.__adsterraLastConfigJson = JSON.stringify(cfg);
  await injectOnce(cfg);

  clearRefreshTimer();
  if (cfg.refreshIntervalSec > 0) {
    window.__adsterraRefreshTimer = window.setInterval(() => {
      if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;
      injectOnce(cfg);
    }, cfg.refreshIntervalSec * 1000) as unknown as number;
  }
}
