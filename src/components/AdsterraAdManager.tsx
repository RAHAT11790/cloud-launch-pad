import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  AdsterraConfig,
  enterAdsterraPlayerScope,
  exitAdsterraPlayerScope,
  getAdsterraConfig,
  setAdsterraPremium,
  subscribeAdsterraConfig,
} from "@/lib/adsterraAds";
import { startAdGuard, stopAdGuard } from "@/lib/adGuard";

interface Props { isPremium?: boolean | null; videoEl?: HTMLVideoElement | null }

/**
 * Two sandboxed iframes mounted INSIDE the video player:
 *   1. Direct Link (popunder) — invisible 1x1 iframe. Fires once when user
 *      taps the player. After firing, a cooldown gate blocks any further
 *      window.open until cooldown expires, then iframe is rebuilt.
 *   2. Push Notification (social bar) — visible bottom strip with an
 *      explicit × close button rendered by us. Cross click opens the
 *      ad (synthetic click inside the iframe), then closes + starts
 *      cooldown.
 *
 * Both ads stay confined to the player. When the player unmounts we tear
 * everything down — no ads survive outside the video player.
 *
 * The scripts run inside sandbox="allow-scripts allow-popups
 * allow-popups-to-escape-sandbox". window.open() is wrapped so the parent
 * is notified (postMessage) whenever an ad fires, and so the same gate
 * can suppress repeat fires during cooldown.
 */

type AdKind = "popunder" | "social";

const DIRECT_HITBOX_HEIGHT = 104;

function buildSrcdoc(snippet: string, kind: AdKind, cooldownMs: number, cycleId: number, bodyStyle: string) {
  // Escape closing </script> inside the user snippet so injection cannot
  // break out of our wrapper.
  const safe = (snippet || "").replace(/<\/script>/gi, "<\\/script>");
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<style>html,body{margin:0;padding:0;background:transparent;color:#fff;font:13px system-ui,-apple-system,sans-serif;${bodyStyle}}*{box-sizing:border-box}</style>
<script>
(function(){
  var COOLDOWN_MS = ${Math.max(0, Math.floor(cooldownMs))};
  var KIND = ${JSON.stringify(kind)};
  var CYCLE = ${JSON.stringify(cycleId)};
  var fired = false;
  var lastFiredAt = 0;
  function notify(type, extra){
    try { parent.postMessage(Object.assign({ __adsterra: true, type: type, kind: KIND, cycle: CYCLE }, extra || {}), '*'); } catch(e){}
  }
  var _open = window.open;
  window.open = function(url, target, features){
    var now = Date.now();
    if (COOLDOWN_MS > 0 && (now - lastFiredAt) < COOLDOWN_MS) {
      notify('suppressed', { url: String(url||'') });
      return null;
    }
    lastFiredAt = now;
    fired = true;
    notify('fired', { url: String(url||'') });
    try { return _open.call(window, url, target || '_blank', features); }
    catch(e){ try { window.location.href = String(url||''); } catch(_){} return null; }
  };
  // Ping ready
  notify('ready');
})();
</script>
</head><body>${safe}</body></html>`;
}

const AdsterraAdManager = ({ isPremium, videoEl }: Props) => {
  const [cfg, setCfg] = useState<AdsterraConfig | null>(null);
  const [popCycle, setPopCycle] = useState(0);
  const [socialCycle, setSocialCycle] = useState(0);
  const [popCooldownUntil, setPopCooldownUntil] = useState(0);
  const [socialCooldownUntil, setSocialCooldownUntil] = useState(0);
  const popFrameRef = useRef<HTMLIFrameElement | null>(null);
  const socialFrameRef = useRef<HTMLIFrameElement | null>(null);
  const popCooldownTimerRef = useRef<number | null>(null);
  const socialCooldownTimerRef = useRef<number | null>(null);

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

  // Load + subscribe to admin config.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let alive = true;
    getAdsterraConfig().then((c) => { if (alive) setCfg(c); });
    unsub = subscribeAdsterraConfig((c) => setCfg(c));
    return () => { alive = false; if (unsub) try { unsub(); } catch {} };
  }, []);

  // Start adblock/DNS guard once we have a non-premium user with ads enabled.
  useEffect(() => {
    if (!cfg) return;
    if (isPremium) { stopAdGuard(); return; }
    if (!cfg.enabled) { stopAdGuard(); return; }
    const t = window.setTimeout(() => startAdGuard(videoEl ?? null), 1500);
    return () => window.clearTimeout(t);
  }, [cfg, isPremium, videoEl]);

  // postMessage bus — listen for fire/suppressed events from the iframes
  // and apply cooldown gating on the parent side too.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e?.data;
      if (!d || typeof d !== "object" || (d as any).__adsterra !== true) return;
      const kind = (d as any).kind as AdKind;
      const type = (d as any).type as string;
      const cd = Math.max(0, (cfg?.refreshIntervalSec ?? 60) * 1000);
      if (type === "fired") {
        if (kind === "popunder") setPopCooldownUntil(Date.now() + cd);
        if (kind === "social") setSocialCooldownUntil(Date.now() + cd);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [cfg?.refreshIntervalSec]);

  useEffect(() => {
    return () => {
      if (popCooldownTimerRef.current) window.clearTimeout(popCooldownTimerRef.current);
      if (socialCooldownTimerRef.current) window.clearTimeout(socialCooldownTimerRef.current);
    };
  }, []);

  const popSrcdoc = useMemo(() => {
    if (!cfg?.popunder?.trim()) return "";
    return buildSrcdoc(cfg.popunder, "popunder", cfg.refreshIntervalSec * 1000, popCycle, "");
  }, [cfg?.popunder, cfg?.refreshIntervalSec, popCycle]);

  const socialSrcdoc = useMemo(() => {
    if (!cfg?.socialBar?.trim()) return "";
    return buildSrcdoc(cfg.socialBar, "social", cfg.refreshIntervalSec * 1000, socialCycle, "display:flex;align-items:center;justify-content:center;min-height:60px;");
  }, [cfg?.socialBar, cfg?.refreshIntervalSec, socialCycle]);

  // Manually close the social bar — same cooldown as a real fire.
  const handleCloseSocial = () => {
    // Try to synthesise a click inside the iframe so the user's intent
    // (close after seeing the ad) also lets the script fire its
    // window.open hook before we tear down. Sandbox without
    // allow-same-origin prevents direct DOM access, so we just fall
    // through to the close + cooldown path.
    const cd = Math.max(0, (cfg?.refreshIntervalSec ?? 60) * 1000);
    setSocialCooldownUntil(Date.now() + cd);
    if (socialCooldownTimerRef.current) window.clearTimeout(socialCooldownTimerRef.current);
    socialCooldownTimerRef.current = window.setTimeout(() => {
      setSocialCooldownUntil(0);
      setSocialCycle((n) => n + 1);
    }, cd);
  };

  if (isPremium || !cfg || !cfg.enabled) return null;

  const popActive = !!cfg.popunder.trim() && !popCooldownUntil;
  const socialActive = !!cfg.socialBar.trim() && !socialCooldownUntil;
  return (
    <>
      {/* Direct-link popunder zone — limited to the center body of the player
          so top/bottom controls remain tappable while a normal play-tap still
          triggers the ad network's click handler. */}
      {popActive && popSrcdoc && (
        <iframe
          ref={popFrameRef}
          key={`pop-${popCycle}`}
          title="ad-popunder"
          srcDoc={popSrcdoc}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          className="absolute left-0 right-0 border-0 bg-transparent z-[6]"
          style={{
            pointerEvents: "auto",
            top: DIRECT_HITBOX_HEIGHT,
            bottom: DIRECT_HITBOX_HEIGHT,
            width: "100%",
            height: `calc(100% - ${DIRECT_HITBOX_HEIGHT * 2}px)`,
          }}
        />
      )}

      {/* Push notification / social bar — visible strip at the bottom with
          our own × close button overlay. Iframe stops short of the
          progress bar area. */}
      {socialActive && socialSrcdoc && (
        <div className="absolute left-0 right-0 bottom-[72px] z-[7] pointer-events-none">
          <div className="relative mx-auto max-w-[640px] px-3">
            <div className="relative rounded-xl overflow-hidden bg-black/70 border border-white/15 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md pointer-events-auto">
              <iframe
                ref={socialFrameRef}
                key={`soc-${socialCycle}`}
                title="ad-push-notification"
                srcDoc={socialSrcdoc}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                className="block w-full border-0 bg-transparent"
                style={{ height: 76 }}
              />
              <button
                type="button"
                onClick={handleCloseSocial}
                aria-label="Close ad"
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white text-black flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.5)] ring-2 ring-primary"
              >
                <X className="w-4 h-4" strokeWidth={3} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdsterraAdManager;
