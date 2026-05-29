// ============================================
// Adsterra Ads — fully sandboxed player-scoped loader.
// Each ad slot lives inside its own iframe so any window-level listeners
// the ad scripts install (popunders, click hijackers, etc.) stay scoped to
// the iframe. When the player exits we remove the iframes, killing every
// listener instantly — ads can no longer leak onto the home screen.
//
// Slots:
//   • Popunder  → invisible iframe (0×0). Triggered when the user clicks
//                 inside the player container (we forward synthetic clicks
//                 into the iframe so the popunder script can fire its popup).
//   • Social Bar → visible iframe fixed to the bottom of the viewport.
//
// A configurable refresh interval recreates every iframe every N seconds so
// the publisher gets a fresh impression on the same long viewing session.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __adsterraPlayerScopeActive?: boolean;
    __adsterraPremium?: boolean;
    __adsterraIframes?: HTMLIFrameElement[];
    __adsterraClickForwarder?: (e: MouseEvent) => void;
    __adsterraRefreshTimer?: number;
  }
}

export type AdsterraConfig = {
  enabled: boolean;
  popunder: string;
  socialBar: string;
  refreshIntervalSec: number; // 0 = no refresh
};

const DEFAULT: AdsterraConfig = { enabled: true, popunder: "", socialBar: "", refreshIntervalSec: 60 };

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

function buildSandboxDoc(snippet: string): string {
  // The snippet runs inside this isolated doc. transparent body so the visible
  // social-bar slot blends with the host page.
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;color:#fff;font-family:system-ui,sans-serif;overflow:hidden}
  body{min-height:100%}
</style></head><body>${snippet}</body></html>`;
}

function makeIframe(snippet: string, kind: "popunder" | "social"): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.setAttribute("data-adsterra", kind);
  f.setAttribute("scrolling", "no");
  f.setAttribute("frameborder", "0");
  // Allow scripts; do NOT allow-same-origin so the iframe cannot reach into
  // the host page's window/document.
  f.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
  f.srcdoc = buildSandboxDoc(snippet);

  if (kind === "popunder") {
    Object.assign(f.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      border: "0",
      pointerEvents: "none",
      zIndex: "1",
    } as Partial<CSSStyleDeclaration>);
  } else {
    Object.assign(f.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: "0",
      width: "100%",
      height: "92px",
      border: "0",
      background: "transparent",
      zIndex: "2147483600",
      pointerEvents: "auto",
    } as Partial<CSSStyleDeclaration>);
  }
  return f;
}

function trackIframe(f: HTMLIFrameElement) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraIframes) window.__adsterraIframes = [];
  window.__adsterraIframes.push(f);
}

function removeAllIframes() {
  if (typeof window === "undefined") return;
  const list = window.__adsterraIframes || [];
  for (const f of list.splice(0).reverse()) {
    try { if (f.isConnected) f.remove(); } catch {}
  }
  window.__adsterraIframes = [];
}

function installClickForwarder() {
  if (typeof window === "undefined") return;
  if (window.__adsterraClickForwarder) return;
  const forward = (e: MouseEvent) => {
    if (!window.__adsterraPlayerScopeActive) return;
    if (window.__adsterraPremium) return;
    // Skip clicks that originate from inside an adsterra iframe (avoid loops).
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("[data-adsterra]")) return;

    const iframes = (window.__adsterraIframes || []).filter(
      (f) => f.getAttribute("data-adsterra") === "popunder"
    );
    for (const f of iframes) {
      try {
        const doc = f.contentDocument;
        if (!doc) continue;
        const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        doc.body?.dispatchEvent(evt);
      } catch {
        /* cross-origin / sandboxed — ignore */
      }
    }
  };
  window.__adsterraClickForwarder = forward;
  document.addEventListener("click", forward, true);
}

function uninstallClickForwarder() {
  if (typeof window === "undefined") return;
  const fn = window.__adsterraClickForwarder;
  if (fn) {
    document.removeEventListener("click", fn, true);
    window.__adsterraClickForwarder = undefined;
  }
}

function clearRefreshTimer() {
  if (typeof window === "undefined") return;
  if (window.__adsterraRefreshTimer) {
    window.clearInterval(window.__adsterraRefreshTimer);
    window.__adsterraRefreshTimer = undefined;
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
  uninstallClickForwarder();
  removeAllIframes();
}

async function injectOnce(cfg: AdsterraConfig) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;
  if (!cfg.enabled) return;

  removeAllIframes(); // refresh = always rebuild

  if (cfg.socialBar?.trim()) {
    const f = makeIframe(cfg.socialBar, "social");
    document.body.appendChild(f);
    trackIframe(f);
  }
  if (cfg.popunder?.trim()) {
    const f = makeIframe(cfg.popunder, "popunder");
    document.body.appendChild(f);
    trackIframe(f);
  }
  installClickForwarder();
}

export async function loadAdsterraSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;

  const cfg = await getAdsterraConfig();
  await injectOnce(cfg);

  clearRefreshTimer();
  if (cfg.refreshIntervalSec > 0) {
    window.__adsterraRefreshTimer = window.setInterval(() => {
      if (!window.__adsterraPlayerScopeActive || window.__adsterraPremium) return;
      injectOnce(cfg);
    }, cfg.refreshIntervalSec * 1000) as unknown as number;
  }
}
