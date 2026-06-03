// ============================================
// Adsterra Ads — player-scoped loader.
// Two slots: Popunder (head-style) + Social Bar (body-style).
// Premium users → no scripts injected. All scripts are torn down on player exit.
// ============================================
import { db, ref, get, onValue } from "@/lib/firebase";

declare global {
  interface Window {
    __adsterraPlayerScopeActive?: boolean;
    __adsterraPremium?: boolean;
    __adsterraInjected?: { popunder?: boolean; socialBar?: boolean };
    __adsterraNodes?: HTMLElement[];
  }
}

export type AdsterraConfig = {
  enabled: boolean;
  popunder: string;   // raw <script> snippet from Adsterra (Popunder)
  socialBar: string;  // raw <script> snippet from Adsterra (Social Bar)
};

const DEFAULT: AdsterraConfig = { enabled: true, popunder: "", socialBar: "" };

let cached: AdsterraConfig | null = null;
let cachedPromise: Promise<AdsterraConfig> | null = null;

function normalize(v: any): AdsterraConfig {
  return {
    enabled: v?.enabled !== false,
    popunder: typeof v?.popunder === "string" ? v.popunder : "",
    socialBar: typeof v?.socialBar === "string" ? v.socialBar : "",
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

function trackNode(n: HTMLElement) {
  if (typeof window === "undefined") return;
  if (!window.__adsterraNodes) window.__adsterraNodes = [];
  window.__adsterraNodes.push(n);
}

function injectSnippet(html: string, marker: string): boolean {
  if (typeof document === "undefined" || !html) return false;
  try {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-adsterra", marker);
    wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    wrapper.innerHTML = html;
    // Re-create scripts so the browser actually executes them.
    const scripts = Array.from(wrapper.querySelectorAll("script"));
    for (const old of scripts) {
      const ns = document.createElement("script");
      for (const a of Array.from(old.attributes)) ns.setAttribute(a.name, a.value);
      if (old.text) ns.text = old.text;
      old.replaceWith(ns);
    }
    trackNode(wrapper);
    document.body.appendChild(wrapper);
    return true;
  } catch {
    return false;
  }
}

export function enterAdsterraPlayerScope() {
  if (typeof window === "undefined") return;
  window.__adsterraPlayerScopeActive = true;
  window.__adsterraInjected = {};
}

export function exitAdsterraPlayerScope() {
  if (typeof window === "undefined") return;
  window.__adsterraPlayerScopeActive = false;
  const nodes = window.__adsterraNodes || [];
  for (const n of nodes.splice(0).reverse()) {
    try { if (n.isConnected) n.remove(); } catch {}
  }
  window.__adsterraNodes = [];
  window.__adsterraInjected = {};
}

export async function loadAdsterraSlots(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!window.__adsterraPlayerScopeActive) return;
  if (window.__adsterraPremium) return;

  const cfg = await getAdsterraConfig();
  if (!cfg.enabled) return;

  const inj = window.__adsterraInjected || (window.__adsterraInjected = {});

  if (!inj.socialBar && cfg.socialBar) {
    if (injectSnippet(cfg.socialBar, "social-bar")) inj.socialBar = true;
  }
  if (!inj.popunder && cfg.popunder) {
    if (injectSnippet(cfg.popunder, "popunder")) inj.popunder = true;
  }
}
