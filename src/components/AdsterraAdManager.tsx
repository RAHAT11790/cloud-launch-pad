import { useEffect, useRef, useState } from "react";
import {
  AdsterraConfig,
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  getAdsterraConfig,
  setAdsterraPremium,
  subscribeAdsterraConfig,
} from "@/lib/adsterraAds";
import { startAdGuard, stopAdGuard } from "@/lib/adGuard";
import { supabase } from "@/integrations/supabase/client";
import { getLocalAuthUser } from "@/lib/localUser";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null }

/**
 * NEW logic (no iframe):
 *  - When player mounts (non-premium + ads enabled), inject each ad
 *    network <script src="..."> straight into <body>.
 *  - Globally wrap window.open. Every time an ad script calls
 *    window.open(...) we POST to the Supabase `ad-capture` edge function.
 *    On { ok: true } we:
 *       1. start the cooldown timer (admin-configurable seconds)
 *       2. remove the ad <script> from the DOM
 *    Once the cooldown elapses we re-inject the script. If the capture
 *    request fails (no ok) we do NOT enter cooldown — the script stays
 *    armed so the next user interaction can try again.
 *  - When the player unmounts: scripts removed, window.open restored.
 */

type AdKind = "popunder" | "social";
const SCRIPT_MARK = "data-rs-ad";
const LOAD_MARK = "data-rs-ad-loaded";

function extractSrc(snippet: string): string | null {
  if (!snippet) return null;
  const m = snippet.match(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function injectAdScript(kind: AdKind, src: string): HTMLScriptElement | null {
  if (!src) return null;
  // Remove any previous instance of the same kind first.
  document.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_MARK}="${kind}"]`).forEach((s) => s.remove());
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.setAttribute(SCRIPT_MARK, kind);
  s.setAttribute(LOAD_MARK, String(Date.now()));
  document.body.appendChild(s);
  return s;
}

function removeAdScript(kind: AdKind) {
  document.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_MARK}="${kind}"]`).forEach((s) => s.remove());
}

const AdsterraAdManager = ({ isPremium, videoEl }: Props) => {
  const [cfg, setCfg] = useState<AdsterraConfig | null>(null);
  const cooldownTimersRef = useRef<Record<AdKind, number | null>>({ popunder: null, social: null });
  const cooldownActiveRef = useRef<Record<AdKind, boolean>>({ popunder: false, social: false });
  const popSrcRef = useRef<string | null>(null);
  const socSrcRef = useRef<string | null>(null);
  const originalOpenRef = useRef<typeof window.open | null>(null);
  const currentKindRef = useRef<AdKind>("popunder");
  const userIdRef = useRef<string>("anon");
  const lastPopupAtRef = useRef<Record<AdKind, number>>({ popunder: 0, social: 0 });
  const [stats, setStats] = useState<any>(null);

  // Scope flag — adGuard / other systems gate on this.
  useEffect(() => {
    enterAdsterraPlayerScope();
    return () => { exitAdsterraPlayerScope(); stopAdGuard(); };
  }, []);

  // Premium flag mirror.
  useEffect(() => {
    if (isPremium === null || isPremium === undefined) return;
    setAdsterraPremium(!!isPremium);
    if (isPremium) stopAdGuard();
  }, [isPremium]);

  useEffect(() => {
    userIdRef.current = getLocalAuthUser()?.id || "anon";
  }, []);

  // Load + subscribe to admin config.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let alive = true;
    getAdsterraConfig().then((c) => { if (alive) setCfg(c); });
    unsub = subscribeAdsterraConfig((c) => setCfg(c));
    return () => { alive = false; if (unsub) try { unsub(); } catch {} };
  }, []);

  // Start adblock/DNS guard.
  useEffect(() => {
    if (!cfg) return;
    if (isPremium) { stopAdGuard(); return; }
    if (!cfg.enabled) { stopAdGuard(); return; }
    const t = window.setTimeout(() => startAdGuard(videoEl ?? null), 1500);
    return () => window.clearTimeout(t);
  }, [cfg, isPremium, videoEl]);

  // Cool-down + re-arm helper.
  const enterCooldown = (kind: AdKind) => {
    const ms = Math.max(0, (cfg?.refreshIntervalSec ?? 60) * 1000);
    cooldownActiveRef.current[kind] = true;
    removeAdScript(kind);
    if (cooldownTimersRef.current[kind]) window.clearTimeout(cooldownTimersRef.current[kind]!);
    if (ms === 0) {
      cooldownActiveRef.current[kind] = false;
      const src = kind === "popunder" ? popSrcRef.current : socSrcRef.current;
      if (src) injectAdScript(kind, src);
      return;
    }
    cooldownTimersRef.current[kind] = window.setTimeout(() => {
      cooldownActiveRef.current[kind] = false;
      const src = kind === "popunder" ? popSrcRef.current : socSrcRef.current;
      if (src) injectAdScript(kind, src);
    }, ms) as unknown as number;
  };

  // Capture → Supabase → cooldown.
  const captureAndCooldown = async (kind: AdKind, url: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("ad-capture", {
        body: {
          kind,
          url,
          cycle: Date.now(),
          userId: userIdRef.current,
          result: "ok",
          phase: "click",
          cooldownMs: Math.max(0, (cfg?.refreshIntervalSec ?? 60) * 1000),
        },
      });
      const ok = !error && (data?.ok === true);
      if (ok) {
        lastPopupAtRef.current[kind] = Date.now();
        enterCooldown(kind);
        void readStats();
      }
      // if not ok → leave script armed so next fire can retry
    } catch {
      // network failed → don't cooldown
    }
  };

  const readStats = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("ad-capture", { method: "GET" });
      if (!error) setStats(data?.stats || null);
    } catch {}
  };

  const reportLoad = async (kind: AdKind, src: string) => {
    try {
      await supabase.functions.invoke("ad-capture", {
        body: {
          kind,
          url: src,
          cycle: Date.now(),
          userId: userIdRef.current,
          result: "pending",
          phase: "load",
          cooldownMs: 0,
        },
      });
      void readStats();
    } catch {}
  };

  // Inject scripts + wrap window.open whenever cfg changes.
  useEffect(() => {
    if (!cfg || isPremium || !cfg.enabled) return;

    const popSrc = extractSrc(cfg.popunder);
    const socSrc = extractSrc(cfg.socialBar);
    popSrcRef.current = popSrc;
    socSrcRef.current = socSrc;

    // wrap window.open exactly once
    if (!originalOpenRef.current) {
      originalOpenRef.current = window.open.bind(window);
      const orig = originalOpenRef.current;
      (window as any).open = function (url?: any, target?: any, features?: any) {
        const kind: AdKind = currentKindRef.current;
        if (cooldownActiveRef.current[kind]) {
          // suppressed — already cooling down
          return null;
        }
        // fire async capture; do NOT block the popup
        captureAndCooldown(kind, String(url || ""));
        try { return orig(url, target || "_blank", features); }
        catch { try { window.location.href = String(url || ""); } catch {} return null; }
      } as typeof window.open;
    }

    // initial inject (only if not currently cooling down)
    if (popSrc && !cooldownActiveRef.current.popunder) {
      currentKindRef.current = "popunder";
      injectAdScript("popunder", popSrc);
      void reportLoad("popunder", popSrc);
    }
    if (socSrc && !cooldownActiveRef.current.social) {
      currentKindRef.current = "social";
      injectAdScript("social", socSrc);
      void reportLoad("social", socSrc);
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const isInsideVideo = !!target?.closest("video, .video-player-root, [data-video-player-root='true']");
      if (!isInsideVideo) return;
      if (!cooldownActiveRef.current.popunder && popSrcRef.current) {
        currentKindRef.current = "popunder";
        return;
      }
      if (!cooldownActiveRef.current.social && socSrcRef.current) {
        currentKindRef.current = "social";
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);

    void readStats();

    return () => {
      removeAdScript("popunder");
      removeAdScript("social");
      window.removeEventListener("pointerdown", onPointerDown, true);
      if (cooldownTimersRef.current.popunder) window.clearTimeout(cooldownTimersRef.current.popunder!);
      if (cooldownTimersRef.current.social) window.clearTimeout(cooldownTimersRef.current.social!);
      cooldownTimersRef.current = { popunder: null, social: null };
      cooldownActiveRef.current = { popunder: false, social: false };
      if (originalOpenRef.current) {
        (window as any).open = originalOpenRef.current;
        originalOpenRef.current = null;
      }
    };
  }, [cfg?.popunder, cfg?.socialBar, cfg?.enabled, cfg?.refreshIntervalSec, isPremium]);

  return null;
};

export default AdsterraAdManager;
