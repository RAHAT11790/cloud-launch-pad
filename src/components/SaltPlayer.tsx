import { useState, useCallback, useRef, useEffect } from "react";
import { X, Crop, Monitor, Search, Maximize, Minimize, ChevronDown, Play } from "lucide-react";
import { toast } from "sonner";
import type { AnimeItem } from "@/data/animeData";
import AdsterraAdManager from "@/components/AdsterraAdManager";
import AnNativeView from "@/components/AnNativeView";
import type { AnNativeResolvedData } from "@/components/AnNativeView";
import { db, ref, onValue } from "@/lib/firebase"; // user-account reads only (premium, watch-history) — never for AN media



interface SaltPlayerState {
  embedUrl: string;
  cleanEmbedUrl?: string;
  title: string;
  subtitle: string;
  anime?: AnimeItem;
  seasonIdx?: number;
  epIdx?: number;
  allEmbeds?: string[];
  currentEmbedIdx?: number;
  cropMode?: 'contain' | 'cover' | 'fill';
  cropW?: number;
  cropH?: number;
  loading?: boolean;
  /** Seconds to resume playback from (continue-watching). */
  resumeTime?: number;
  /** Pre-extracted AN HLS data so player opens with Hindi already selected. */
  anNativeData?: AnNativeResolvedData | null;
}

interface SaltPlayerProps {
  saltPlayerState: SaltPlayerState;
  setSaltPlayerState: (state: SaltPlayerState | null) => void;
  getCleanEmbedUrl: (url: string) => string;
  addToWatchHistory: (anime: AnimeItem, seasonIdx?: number, epIdx?: number, preserveProgress?: boolean) => void;
  onRequireUnlock?: (anime: AnimeItem, seasonIdx?: number, epIdx?: number) => Promise<boolean>;
  suggestedAnime?: AnimeItem[];
  onSuggestedClick?: (anime: AnimeItem) => void;
}

const getShortSeasonLabel = (seasonName: string | undefined, index: number) => {
  const normalized = String(seasonName || "").trim();
  const explicitSeasonNumber = normalized.match(/season\s*(\d+)/i)?.[1];
  if (explicitSeasonNumber) return `Season ${explicitSeasonNumber}`;
  return `Season ${index + 1}`;
};

const CROP_PRESETS = [
  { label: "16:9", w: 16, h: 9 },
  { label: "4:3", w: 4, h: 3 },
  { label: "20:8", w: 20, h: 8 },
  { label: "21:9", w: 21, h: 9 },
];

export default function SaltPlayer({ saltPlayerState, setSaltPlayerState, getCleanEmbedUrl, addToWatchHistory, onRequireUnlock, suggestedAnime, onSuggestedClick }: SaltPlayerProps) {
  const [epSearch, setEpSearch] = useState("");
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState<number>(saltPlayerState.seasonIdx ?? 0);
  const [showCropPanel, setShowCropPanel] = useState(false);
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isTvMode = useCallback(() => document.documentElement.classList.contains("tv-mode"), []);
  const [showControls, setShowControls] = useState(true);
  // Native HLS playback (no iframe). Auto-cycles servers on failure.
  const [nativeFailed, setNativeFailed] = useState(false);
  // Servers we've already exhausted in this play SESSION (per anime/episode).
  const triedEmbedsRef = useRef<Set<string>>(new Set());
  const sessionKey = `${saltPlayerState.anime?.id || ""}:${saltPlayerState.seasonIdx ?? -1}:${saltPlayerState.epIdx ?? -1}`;
  const lastSessionKeyRef = useRef<string>(sessionKey);
  useEffect(() => {
    // Only wipe the tried-set when the user switches to a different episode/movie,
    // NOT on every internal server-swap.
    if (lastSessionKeyRef.current !== sessionKey) {
      triedEmbedsRef.current = new Set();
      lastSessionKeyRef.current = sessionKey;
    }
    setNativeFailed(false);
  }, [sessionKey, saltPlayerState.embedUrl]);
  const containerRef = useRef<HTMLDivElement>(null);
  const cropPanelRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track latest playback position so server-switch resumes from the same point.
  const lastPosRef = useRef<number>(0);

  useEffect(() => {
    if (!saltPlayerState.embedUrl) return;
    try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
  }, [saltPlayerState.embedUrl]);

  const notifyDetailsLoaded = useCallback(() => {
    try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
  }, []);

  const handleNativeFail = useCallback((reason: string) => {
    console.warn('[AnNative] all qualities exhausted for current server:', reason);
    notifyDetailsLoaded();
    if (saltPlayerState.embedUrl) triedEmbedsRef.current.add(saltPlayerState.embedUrl);
    const embeds = saltPlayerState.allEmbeds || [];
    const nextIdx = embeds.findIndex((u) => !triedEmbedsRef.current.has(u));
    if (embeds.length > 1 && nextIdx >= 0) {
      const nextUrl = embeds[nextIdx];
      toast.info(`Trying server ${nextIdx + 1}…`);
      setSaltPlayerState({
        ...saltPlayerState,
        embedUrl: nextUrl,
        currentEmbedIdx: nextIdx,
        loading: false,
        cleanEmbedUrl: getCleanEmbedUrl(nextUrl),
        resumeTime: lastPosRef.current || saltPlayerState.resumeTime || 0,
      });
      return;
    }
    // All servers × all qualities exhausted → real expiration.
    setNativeFailed(true);
  }, [notifyDetailsLoaded, saltPlayerState, setSaltPlayerState, getCleanEmbedUrl]);




  // Premium status — disables ads for paid users.
  const [isPremium, setIsPremium] = useState<boolean | null>(null);
  useEffect(() => {
    let uid: string | null = null;
    try { const u = localStorage.getItem("rsanime_user"); if (u) uid = JSON.parse(u).id; } catch {}
    if (!uid) { setIsPremium(false); return; }
    const unsub = onValue(ref(db, `users/${uid}/premium`), (snap) => {
      const d = snap.val();
      setIsPremium(!!(d && d.active === true && d.expiresAt > Date.now()));
    });
    return () => unsub();
  }, []);


  // Auto-hide controls timer
  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!showCropPanel) setShowControls(false);
    }, 3000);
  }, [showCropPanel]);

  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (isFullscreen) {
      startHideTimer();
    }
  }, [isFullscreen, startHideTimer]);

  // Listen fullscreen changes
  useEffect(() => {
    const onFs = () => {
      const fullscreenElement = document.fullscreenElement;
      const nativeVideoFullscreen = isTvMode()
        && fullscreenElement instanceof HTMLVideoElement;
      if (nativeVideoFullscreen) {
        // Some Android TV WebViews force the media element into their native
        // player. Exit that surface so the app's episodes and suggestions stay
        // available in the theater workspace.
        try { document.exitFullscreen?.().catch(() => {}); } catch {}
        setIsFullscreen(false);
        return;
      }
      const fs = !!fullscreenElement;
      setIsFullscreen(fs);
      if (fs) {
        setShowControls(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
      } else {
        // Unlock orientation when exiting fullscreen
        try { (screen.orientation as any).unlock?.(); } catch {}
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setShowControls(true);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isTvMode]);

  // Keep crop panel open = keep controls visible
  useEffect(() => {
    if (showCropPanel && isFullscreen) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setShowControls(true);
    }
  }, [showCropPanel, isFullscreen]);

  // Close crop panel when clicking outside
  useEffect(() => {
    if (!showCropPanel) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (cropPanelRef.current && !cropPanelRef.current.contains(e.target as Node)) {
        setShowCropPanel(false);
      }
    };
    const t = setTimeout(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("touchstart", handler);
    }, 100);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [showCropPanel]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        // Unlock orientation before exiting fullscreen
        try { (screen.orientation as any).unlock?.(); } catch {}
        await document.exitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
        // Lock to landscape after entering fullscreen
        try { await (screen.orientation as any).lock?.('landscape'); } catch {}
      }
    } catch {}
  }, []);

  const applyCrop = useCallback((w: number, h: number) => {
    setSaltPlayerState({ ...saltPlayerState, cropW: w, cropH: h, cropMode: undefined });
    setShowCropPanel(false);
    toast.info(`Crop: ${w}:${h}`);
  }, [saltPlayerState, setSaltPlayerState]);

  const applyCustomCrop = useCallback(() => {
    const w = parseInt(customW);
    const h = parseInt(customH);
    if (w > 0 && h > 0) {
      applyCrop(w, h);
      setCustomW("");
      setCustomH("");
    } else {
      toast.error("Enter valid Width and Height");
    }
  }, [customW, customH, applyCrop]);

  const resetCrop = useCallback(() => {
    setSaltPlayerState({ ...saltPlayerState, cropW: 0, cropH: 0, cropMode: 'contain' });
    setShowCropPanel(false);
    toast.info("Crop Reset: Fit");
  }, [saltPlayerState, setSaltPlayerState]);

  const getAspectPadding = () => {
    const w = saltPlayerState.cropW || 0;
    const h = saltPlayerState.cropH || 0;
    if (w > 0 && h > 0) return `${(h / w) * 100}%`;
    const mode = saltPlayerState.cropMode || 'contain';
    if (mode === 'cover') return '45%';
    if (mode === 'fill') return '50%';
    return '56.25%';
  };

  const getIframeStyle = (): React.CSSProperties => {
    const w = saltPlayerState.cropW || 0;
    const h = saltPlayerState.cropH || 0;

    if (isFullscreen) {
      if (w > 0 && h > 0) {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const screenRatio = screenW / screenH;
        const targetRatio = w / h;
        if (targetRatio > screenRatio) {
          const scale = targetRatio / screenRatio;
          return { transform: `scaleX(${scale.toFixed(3)})`, transformOrigin: 'center center' };
        } else {
          const scale = screenRatio / targetRatio;
          return { transform: `scaleY(${scale.toFixed(3)})`, transformOrigin: 'center center' };
        }
      }
      const mode = saltPlayerState.cropMode || 'contain';
      if (mode === 'cover') return { transform: 'scale(1.3)', transformOrigin: 'center center' };
      if (mode === 'fill') return { transform: 'scale(1.15)', transformOrigin: 'center center' };
      return {};
    }

    if (w > 0 && h > 0) {
      const nativeRatio = 16 / 9;
      const targetRatio = w / h;
      if (targetRatio > nativeRatio) {
        const scale = targetRatio / nativeRatio;
        return { transform: `scaleX(${scale.toFixed(3)})`, transformOrigin: 'center center' };
      } else if (targetRatio < nativeRatio) {
        const scale = nativeRatio / targetRatio;
        return { transform: `scaleY(${scale.toFixed(3)})`, transformOrigin: 'center center' };
      }
      return {};
    }
    const mode = saltPlayerState.cropMode || 'contain';
    if (mode === 'cover') return { transform: 'scale(1.3)', transformOrigin: 'center center' };
    if (mode === 'fill') return { transform: 'scale(1.15)', transformOrigin: 'center center' };
    return {};
  };

  const handleEpisodeClick = async (_ep: any, _season: any, _sIdx: number, _eIdx: number) => {
    // AN episode switching is driven by the parent (Index.tsx) which calls the
    // live API to resolve a fresh HLS link. No Firebase lookup here.
  };

  // Filter episodes
  const filteredSeasons = saltPlayerState.anime?.seasons?.map(season => ({
    ...season,
    episodes: season.episodes.filter(ep => {
      if (!epSearch.trim()) return true;
      const q = epSearch.trim().toLowerCase();
      return String(ep.episodeNumber).includes(q) || (ep.title || '').toLowerCase().includes(q);
    }),
  })).filter(s => s.episodes.length > 0);

  // Current crop label
  const cropLabel = (() => {
    const w = saltPlayerState.cropW || 0;
    const h = saltPlayerState.cropH || 0;
    if (w > 0 && h > 0) return `${w}:${h}`;
    return null;
  })();

  // Handle tap on video area to toggle controls
  const handleVideoAreaClick = () => {
    if (showControls) {
      setShowControls(false);
      setShowCropPanel(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      setShowControls(true);
      if (isFullscreen) {
        startHideTimer();
      }
    }
  };

  // Close player — unmount IMMEDIATELY so home screen reappears with zero
  // perceived latency. Fullscreen exit + orientation unlock are kicked off
  // in parallel (fire-and-forget) instead of awaited.
  const handleClose = useCallback(() => {
    // Stage 1: if we're fullscreen / landscape, just exit fullscreen first
    // so the user lands back on the half-screen portrait view instantly.
    // Stage 2 (second press): actually close the player and go home.
    if (isFullscreen || document.fullscreenElement) {
      try { (screen.orientation as any).unlock?.(); } catch {}
      try { document.exitFullscreen?.().catch(() => {}); } catch {}
      return;
    }
    // Clear timers first so nothing fires post-unmount.
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    // Unmount synchronously — React swaps to home in the same frame.
    setSaltPlayerState(null);
    // Release orientation lock in the background.
    queueMicrotask(() => {
      try { (screen.orientation as any).unlock?.(); } catch {}
    });
  }, [isFullscreen, setSaltPlayerState]);

  return (
    <div
      ref={containerRef}
      data-player-fs={isFullscreen ? "on" : "off"}
      className="rs-salt-player-root fixed inset-0 z-[9999] bg-background flex flex-col overflow-hidden"
    >
      {/* Close button - auto-hides with controls in fullscreen */}
      <button
        onPointerDown={(e) => { e.preventDefault(); handleClose(); }}
        aria-label="Close player"
        className={`absolute top-3 right-3 z-[60] w-9 h-9 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 flex items-center justify-center hover:bg-destructive/80 active:scale-90 transition-all duration-200 shadow-lg ${
          isFullscreen && !showControls ? 'opacity-0 pointer-events-none -translate-y-2' : 'opacity-100 translate-y-0'
        }`}
        style={{ pointerEvents: isFullscreen && !showControls ? 'none' : 'auto', touchAction: 'manipulation' }}
      >
        <X className="w-[18px] h-[18px] text-white" strokeWidth={2.4} />
      </button>

      {/* Top bar - toggles on tap */}
      <div
        className={`flex items-center justify-between px-3 py-2 bg-background/95 backdrop-blur-sm border-b border-border/30 transition-all duration-300 ${
          isFullscreen
            ? `absolute top-0 left-0 right-0 z-50 bg-black/70 ${showControls ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'}`
            : 'flex-shrink-0 z-20'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-sm font-semibold text-foreground truncate">{saltPlayerState.title}</p>
          <p className="text-xs text-muted-foreground truncate">{saltPlayerState.subtitle}</p>
        </div>
        {/* Unified control cluster — every pill is the same size/shape so
            nothing looks crooked next to the close button on the right. */}
        <div className="flex items-center gap-1.5 mr-12">
          {!nativeFailed && (
            <span className="h-9 px-2.5 inline-flex items-center rounded-xl bg-primary/15 text-primary text-[10px] font-bold tracking-wider border border-primary/30">
              HLS
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setShowCropPanel(!showCropPanel); resetHideTimer(); }}
            aria-label="Crop"
            className={`relative w-9 h-9 rounded-xl flex items-center justify-center border transition-all active:scale-90 ${
              showCropPanel || cropLabel
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'bg-secondary border-border/40 hover:bg-primary/15 hover:border-primary/30'
            }`}
          >
            <Crop className="w-[18px] h-[18px]" />
            {cropLabel && (
              <span className="absolute -bottom-1 -right-1 text-[8px] bg-primary text-primary-foreground rounded px-0.5 font-bold leading-none py-0.5">
                {cropLabel}
              </span>
            )}
          </button>
          {(saltPlayerState.allEmbeds?.length ?? 0) > 1 && (
            <button
              onClick={() => {
                const nextIdx = ((saltPlayerState.currentEmbedIdx || 0) + 1) % saltPlayerState.allEmbeds!.length;
                const nextUrl = saltPlayerState.allEmbeds![nextIdx];
                setSaltPlayerState({
                  ...saltPlayerState,
                  embedUrl: nextUrl,
                  currentEmbedIdx: nextIdx,
                  loading: false,
                  cleanEmbedUrl: getCleanEmbedUrl(nextUrl),
                  resumeTime: lastPosRef.current || saltPlayerState.resumeTime || 0,
                });
                toast.info(`Server ${nextIdx + 1}`);
                resetHideTimer();
              }}
              aria-label="Switch server"
              className="w-9 h-9 rounded-xl bg-secondary border border-border/40 flex items-center justify-center hover:bg-primary/15 hover:border-primary/30 active:scale-90 transition-all"
            >
              <Monitor className="w-[18px] h-[18px] text-foreground" />
            </button>
          )}
          <button
            onClick={() => { toggleFullscreen(); resetHideTimer(); }}
            aria-label="Fullscreen"
            className="w-9 h-9 rounded-xl bg-secondary border border-border/40 flex items-center justify-center hover:bg-primary/15 hover:border-primary/30 active:scale-90 transition-all"
          >
            {isFullscreen ? <Minimize className="w-[18px] h-[18px] text-foreground" /> : <Maximize className="w-[18px] h-[18px] text-foreground" />}
          </button>
        </div>
      </div>


      {/* Crop panel */}
      {showCropPanel && (
        <div
          ref={cropPanelRef}
          className={`absolute z-50 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl p-3 shadow-xl transition-all duration-300 ${
            isFullscreen ? (showControls ? 'top-14 right-3 opacity-100' : 'top-14 right-3 opacity-0 pointer-events-none') : 'top-14 right-3'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-bold text-foreground mb-2">🎬 Video Crop</p>
          <div className="flex gap-1.5 mb-2">
            {CROP_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => { applyCrop(p.w, p.h); resetHideTimer(); }}
                className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-semibold hover:bg-primary/20 hover:text-primary transition-all border border-border/30"
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => { resetCrop(); resetHideTimer(); }}
              className="px-3 py-1.5 rounded-lg bg-secondary text-xs font-semibold hover:bg-accent/20 hover:text-accent transition-all border border-border/30"
            >
              Reset
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="W"
              value={customW}
              onChange={e => setCustomW(e.target.value)}
              className="w-16 bg-secondary border border-border/30 rounded-lg px-2 py-1.5 text-xs text-center outline-none focus:border-primary"
            />
            <span className="text-xs text-muted-foreground font-bold">×</span>
            <input
              type="number"
              placeholder="H"
              value={customH}
              onChange={e => setCustomH(e.target.value)}
              className="w-16 bg-secondary border border-border/30 rounded-lg px-2 py-1.5 text-xs text-center outline-none focus:border-primary"
            />
            <button
              onClick={() => { applyCustomCrop(); resetHideTimer(); }}
              className="px-3 py-1.5 rounded-lg gradient-primary text-xs font-bold btn-glow"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Video container - tap to toggle controls */}
      <div
        className={`rs-salt-player-shell relative bg-black overflow-hidden ${isFullscreen ? 'flex-1' : 'flex-shrink-0 border-b-2 border-primary/20'}`}
        onClick={handleVideoAreaClick}
      >
        <div className={isFullscreen ? 'w-full h-full overflow-hidden' : 'overflow-hidden'} style={isFullscreen ? {} : { paddingBottom: getAspectPadding(), position: 'relative' }}>
          {saltPlayerState.loading && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-black">
              <div className="player-loader-shell" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
              </div>
            </div>
          )}
          {saltPlayerState.embedUrl && !nativeFailed && (
            <AnNativeView
              embedUrl={saltPlayerState.embedUrl}
              initialData={saltPlayerState.anNativeData}
              resumeTime={saltPlayerState.resumeTime}
              videoClassName={`${isFullscreen ? 'w-full h-full' : 'absolute inset-0 w-full h-full'} bg-black`}
              videoStyle={getIframeStyle()}
              onFail={handleNativeFail}
              onReady={notifyDetailsLoaded}
              onTimeUpdate={(currentTime, duration) => {
                lastPosRef.current = currentTime;
                if (saltPlayerState.anime) {
                  try {
                    const uid = JSON.parse(localStorage.getItem("rsanime_user") || "null")?.id;
                    if (uid) {
                      import("@/lib/firebase").then(({ db: fdb, ref: fref, update: fupdate }) => {
                        const animeId = saltPlayerState.anime!.id;
                        fupdate(fref(fdb, `users/${uid}/watchHistory/${animeId}`), {
                          currentTime, duration, watchedAt: Date.now(),
                        }).catch(() => {});
                      });
                    } else {
                      // Guest mode — localStorage only
                      import("@/lib/guestStore").then(({ guestStore }) => {
                        guestStore.continue.upsert({
                          animeId: saltPlayerState.anime!.id,
                          seasonIdx: saltPlayerState.seasonIdx,
                          epIdx: saltPlayerState.epIdx,
                          position: currentTime,
                          duration,
                          title: saltPlayerState.anime!.title,
                          poster: saltPlayerState.anime!.poster,
                          updatedAt: Date.now(),
                        });
                      });
                    }
                  } catch {}
                }
              }}
            />
          )}
          {nativeFailed && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black text-center px-6">
              <p className="text-white text-sm font-semibold mb-1">⚠ Link Expired</p>
              <p className="text-white/60 text-[11px] mb-3">All qualities and servers were tried. This source has expired — please try later or pick another episode.</p>
              <button
                onClick={() => {
                  // Full retry — wipe blacklist and restart from first server.
                  triedEmbedsRef.current = new Set();
                  const embeds = saltPlayerState.allEmbeds || [];
                  const firstUrl = embeds[0] || saltPlayerState.embedUrl;
                  setSaltPlayerState({
                    ...saltPlayerState,
                    embedUrl: firstUrl,
                    currentEmbedIdx: 0,
                    loading: false,
                    cleanEmbedUrl: getCleanEmbedUrl(firstUrl),
                    resumeTime: lastPosRef.current || saltPlayerState.resumeTime || 0,
                  });
                  setNativeFailed(false);
                }}
                className="px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold"
              >
                Retry from Server 1
              </button>
            </div>
          )}



          {/* Adsterra ads — never mount for Live TV (SaltPlayer is only series/movies). */}
          <AdsterraAdManager isPremium={isPremium} videoEl={null} />
        </div>
      </div>


      {/* Season selector + Episode list + Suggested (only when not fullscreen) */}
      {!isFullscreen && (
        <div className="rs-salt-player-content flex-1 overflow-y-auto px-3 py-3 scroll-smooth">
          {/* Season selector + episodes (only for series) */}
          {saltPlayerState.anime?.seasons && (
            <>
              {/* Season selector */}
              {saltPlayerState.anime.seasons.length > 1 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                    {saltPlayerState.anime.seasons.length} Seasons
                  </p>
                  <div
                    className="flex gap-2 overflow-x-auto scrollbar-hide pb-1"
                    style={{ touchAction: "pan-x" }}
                  >
                    {saltPlayerState.anime.seasons.map((s, idx) => {
                      const active = idx === selectedSeasonIdx;
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedSeasonIdx(idx)}
                          className={`flex-shrink-0 min-w-[110px] px-4 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap transition-all ${
                            active
                              ? 'gradient-primary text-primary-foreground border-primary/40 shadow-[0_2px_12px_hsla(170,75%,45%,0.3)]'
                              : 'bg-secondary border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                          }`}
                        >
                          {getShortSeasonLabel(s.name, idx)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Horizontal episode scroll for selected season */}
              {(() => {
                const season = saltPlayerState.anime!.seasons![selectedSeasonIdx];
                if (!season) return null;
                const actualSIdx = selectedSeasonIdx;
                const episodes = epSearch.trim()
                  ? season.episodes.filter(ep => String(ep.episodeNumber).includes(epSearch.trim()))
                  : season.episodes;

                return (
                  <>
                    {/* Episode search (only if many episodes) */}
                    {season.episodes.length > 15 && (
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          value={epSearch}
                          onChange={e => setEpSearch(e.target.value)}
                          placeholder="Search episode..."
                          className="w-full bg-secondary border border-border/30 rounded-xl pl-9 pr-3 py-1.5 text-xs outline-none focus:border-primary transition-colors"
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-5 gap-2 pb-2">
                      {episodes.map((ep, eIdx) => {
                        const actualEIdx = season.episodes.findIndex(e => e.episodeNumber === ep.episodeNumber);
                        const isActive = actualSIdx === saltPlayerState.seasonIdx && actualEIdx === saltPlayerState.epIdx;
                        return (
                          <button
                            key={eIdx}
                            onClick={() => handleEpisodeClick(ep, season, actualSIdx, actualEIdx)}
                            className={`w-full h-12 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                              isActive
                                ? 'gradient-primary border-primary text-primary-foreground shadow-[0_0_12px_hsla(170,75%,45%,0.3)]'
                                : 'bg-secondary border-foreground/10 hover:bg-primary/10 hover:border-primary/50'
                            }`}
                          >
                            <span className="text-sm font-bold">{ep.episodeNumber}</span>
                          </button>
                        );
                      })}
                    </div>
                    {episodes.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No episodes found</p>
                    )}
                  </>
                );
              })()}
            </>
          )}

          {/* Suggested Videos - always show for both movies and series */}
          {suggestedAnime && suggestedAnime.length > 0 && onSuggestedClick && (
            <div className={`${saltPlayerState.anime?.seasons ? 'mt-4 pt-3 border-t border-border/20' : ''}`}>
              <h3 className="text-sm font-bold mb-2.5 flex items-center gap-1.5 text-foreground">
                <Play className="w-3.5 h-3.5 text-primary" /> Suggested for you
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {suggestedAnime.map((anime) => (
                  <button
                    type="button"
                    key={anime.id}
                    onClick={() => onSuggestedClick(anime)}
                    className="w-full cursor-pointer group text-left"
                  >
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card mb-1">
                      <img src={anime.poster} alt={anime.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)" }} />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-7 h-7 rounded-full bg-primary/80 flex items-center justify-center">
                          <Play className="w-3.5 h-3.5 text-primary-foreground" fill="currentColor" />
                        </div>
                      </div>
                      <div className="absolute top-1 right-1 z-10">
                        <span className={`px-1 py-0.5 rounded text-[7px] font-black tracking-wider ${anime.source === "animesalt" ? "bg-accent/85 text-accent-foreground" : "bg-primary/85 text-primary-foreground"}`}>{anime.source === "animesalt" ? "AN" : "RS"}</span>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-1.5">
                        <p className="text-[9px] font-semibold leading-tight line-clamp-2 text-white">{anime.title}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
