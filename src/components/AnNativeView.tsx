// ============================================================
// AnNativeView — native HLS player for AN content (no iframe).
//
// Given an AnimeSalt embed URL, this component:
//   1. Calls /an-api/embed to extract per-quality video URLs + per-language
//      audio URLs (all direct CDN m3u8 — no master, no referer block).
//   2. Builds a synthesized HLS master playlist (data: URL) that combines
//      ONE video variant + ALL audio renditions, all proxied through
//      /an-api/hls for CORS.
//   3. Plays in a native <video> via hls.js. Quality switching rebuilds the
//      master (preserves currentTime + audio track) — fixed-quality model,
//      no ABR. Audio switching uses the hls.js audioTrack API (instant).
//
// Falls back via onFail() if extraction returns no streams or hls errors.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Captions, Layers, Pause, Play, RotateCcw, RotateCw, Volume2 } from "lucide-react";

const SUPA = (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://kqxpzqegtvaiwgdusrin.supabase.co";
const AN_API = `${SUPA}/functions/v1/an-api`;
const HLS_PROXY = `${AN_API}/hls`;
const SUBS_PROXY = `${AN_API}/subs`;

type Sub = { language: string; name: string; uri: string };

type Stream = { url: string; label: string; height: number; resolution: string; bandwidth: number };
type Audio  = { language: string; name: string; uri: string };

interface Props {
  embedUrl: string;
  videoStyle?: React.CSSProperties;
  videoClassName?: string;
  /** Resume position in seconds — passed to hls.startLoad so we don't waste
   *  bandwidth fetching from 0 then seeking. Critical for slow networks. */
  resumeTime?: number;
  /** Called when extraction fails or hls fatally errors so parent can show iframe. */
  onFail?: (reason: string) => void;
  /** Called after streams successfully resolve so the parent can hide its own loader. */
  onReady?: () => void;
  /** Bubble currentTime/duration up so parent can persist progress. */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
}

const proxied = (u: string) => `${HLS_PROXY}?url=${encodeURIComponent(u)}`;

function buildMaster(stream: Stream, audios: Audio[], defaultAudioIdx: number): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  audios.forEach((a, i) => {
    const isDefault = i === defaultAudioIdx;
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${a.name.replace(/"/g, "")}",` +
      `LANGUAGE="${a.language || a.name.slice(0, 2).toLowerCase()}",` +
      `DEFAULT=${isDefault ? "YES" : "NO"},AUTOSELECT=YES,URI="${proxied(a.uri)}"`
    );
  });
  const audioRef = audios.length > 0 ? ',AUDIO="aud"' : "";
  lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${stream.bandwidth || stream.height * 5000},RESOLUTION=${stream.resolution || `${stream.height}p`}${audioRef}`);
  lines.push(proxied(stream.url));
  const text = lines.join("\n");
  // data URL avoids needing yet another endpoint; hls.js handles it natively
  return `data:application/vnd.apple.mpegurl;base64,${btoa(unescape(encodeURIComponent(text)))}`;
}

export default function AnNativeView({ embedUrl, videoStyle, videoClassName, resumeTime, onFail, onReady, onTimeUpdate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [audios, setAudios]   = useState<Audio[]>([]);
  const [subs, setSubs]       = useState<Sub[]>([]);
  const [qIdx, setQIdx]       = useState(0);
  const [aIdx, setAIdx]       = useState(0);
  const [sIdx, setSIdx]       = useState(-1); // -1 = off
  const [loading, setLoading] = useState(true);
  const [showQ, setShowQ]     = useState(false);
  const [showA, setShowA]     = useState(false);
  const [showS, setShowS]     = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [skipHint, setSkipHint] = useState<{ side: "left" | "right"; total: number } | null>(null);
  const [speedBoost, setSpeedBoost] = useState(false);
  const failedRef = useRef(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTotalsRef = useRef({ left: 0, right: 0 });
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ side: "left" | "right"; at: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);
  const prevRateRef = useRef(1);
  // Track whether we've already applied the initial resume — so quality
  // switching mid-playback keeps current position, not the original resume.
  const resumedRef = useRef(false);

  // 1. Fetch streams + audio from edge function
  useEffect(() => {
    let cancelled = false;
    failedRef.current = false;
    resumedRef.current = false;
    setLoading(true);
    setStreams([]); setAudios([]);
    (async () => {
      try {
        const r = await fetch(`${AN_API}/embed?url=${encodeURIComponent(embedUrl)}`);
        const d = await r.json();
        if (cancelled) return;
        const s: Stream[] = Array.isArray(d?.streams) ? d.streams : [];
        const a: Audio[]  = Array.isArray(d?.audio)   ? d.audio   : [];
        if (s.length === 0) { onFail?.("no-streams"); return; }
        setStreams(s);
        setAudios(a);
        // Pick a sensible default quality: prefer 720p if available,
        // otherwise the highest available. This avoids starting at 1080p
        // on weak networks (the user explicitly mentioned 5-6 MB pulls).
        const preferred = s.findIndex((x) => x.height === 720);
        const fallback  = s.findIndex((x) => x.height <= 720);
        setQIdx(preferred >= 0 ? preferred : (fallback >= 0 ? fallback : 0));
        setAIdx(0);
        onReady?.();
      } catch (e) {
        if (cancelled) return;
        onFail?.((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [embedUrl, onFail, onReady]);

  // 2. Build + attach hls whenever quality changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || streams.length === 0) return;
    const stream = streams[qIdx];
    if (!stream) return;
    const master = buildMaster(stream, audios, aIdx);
    // First mount → use the resumeTime prop (continue-watching). After that,
    // preserve the live currentTime across quality swaps.
    const initialStart = !resumedRef.current
      ? Math.max(0, Number(resumeTime || 0))
      : (video.currentTime || 0);
    const wasPaused = video.paused;

    // Native HLS (Safari / iOS)
    if (video.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) {
      video.src = master;
      const onLoaded = () => {
        if (initialStart) video.currentTime = initialStart;
        resumedRef.current = true;
        if (!wasPaused) video.play().catch(() => {});
        setLoading(false);
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      return () => video.removeEventListener("loadedmetadata", onLoaded);
    }

    // hls.js path — tuned for FAST first-frame + slow-network resilience.
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Start small so first segment arrives fast, then ramp up.
      maxBufferLength: 30,
      maxMaxBufferLength: 300,
      maxBufferSize: 60 * 1000 * 1000,
      backBufferLength: 30,
      // Aggressive retries for flaky connections — instead of giving up,
      // retry quickly so playback recovers without user action.
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 500,
      levelLoadingTimeOut: 15000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 500,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 500,
      nudgeMaxRetry: 10,
      // We feed exactly one variant, so ABR is irrelevant.
      capLevelToPlayerSize: false,
      // Start loading from the resume position — does NOT pull bytes from 0.
      startPosition: initialStart > 0 ? initialStart : -1,
      // Pre-fetch the first frag for instant playback start.
      startFragPrefetch: true,
      // Tolerate small gaps in fragments without stalling.
      maxBufferHole: 0.5,
    });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(master));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // startPosition handles the seek for hls.js automatically; only
      // touch currentTime as a safety net if it didn't land near target.
      if (initialStart > 0 && Math.abs(video.currentTime - initialStart) > 2) {
        try { video.currentTime = initialStart; } catch {}
      }
      resumedRef.current = true;
      if (!wasPaused) video.play().catch(() => {});
      setLoading(false);
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      // Default audio is already set inside the master via DEFAULT=YES.
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      // Try non-destructive recovery before giving up — many "fatal" media
      // errors on slow networks are actually recoverable buffer stalls.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        try { hls.startLoad(); return; } catch {}
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); return; } catch {}
      }
      if (failedRef.current) return;
      failedRef.current = true;
      onFail?.(`hls-${data.type}-${data.details}`);
    });
    return () => { hls.destroy(); hlsRef.current = null; };
    // resumeTime intentionally NOT in deps — re-running on resume change
    // would tear down hls mid-playback. Only embed/quality/audio rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, qIdx, audios, aIdx, onFail]);

  // Bubble timeupdate to parent for progress persistence (continue-watching).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onTimeUpdate) return;
    let last = 0;
    const handler = () => {
      const now = Date.now();
      if (now - last < 1500) return; // throttle to ~every 1.5s
      last = now;
      if (v.duration && isFinite(v.duration)) {
        onTimeUpdate(v.currentTime, v.duration);
      }
    };
    v.addEventListener("timeupdate", handler);
    return () => v.removeEventListener("timeupdate", handler);
  }, [onTimeUpdate]);

  // Audio switching — instant via hls.js API; no rebuild needed
  const changeAudio = useCallback((i: number) => {
    setAIdx(i);
    const hls = hlsRef.current;
    if (hls && hls.audioTracks.length > i) {
      try { hls.audioTrack = i; } catch {}
    }
    setShowA(false);
  }, []);

  const changeQuality = useCallback((i: number) => {
    setQIdx(i);
    setShowQ(false);
  }, []);

  const openControlsBriefly = useCallback(() => {
    setControlsOpen(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsOpen(false), 2600);
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    const next = Math.max(0, Math.min(max, video.currentTime + delta));
    try {
      if ("fastSeek" in video && typeof video.fastSeek === "function") video.fastSeek(next);
      else video.currentTime = next;
    } catch { video.currentTime = next; }
    openControlsBriefly();
  }, [openControlsBriefly]);

  const doubleTapSkip = useCallback((side: "left" | "right") => {
    seekBy(side === "right" ? 5 : -5);
    skipTotalsRef.current[side] += 5;
    setSkipHint({ side, total: skipTotalsRef.current[side] });
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => {
      skipTotalsRef.current = { left: 0, right: 0 };
      setSkipHint(null);
    }, 700);
  }, [seekBy]);

  const startLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressActiveRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      prevRateRef.current = v.playbackRate || 1;
      try { v.playbackRate = 2; } catch {}
      longPressActiveRef.current = true;
      setSpeedBoost(true);
    }, 380);
  }, []);

  const endLongPress = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    if (longPressActiveRef.current) {
      const v = videoRef.current;
      if (v) { try { v.playbackRate = prevRateRef.current || 1; } catch {} }
      longPressActiveRef.current = false;
      setSpeedBoost(false);
      return true;
    }
    return false;
  }, []);

  const handleTapZone = useCallback((side: "left" | "right") => {
    if (endLongPress()) return; // long-press release: skip tap logic
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.side === side && now - last.at < 330) {
      lastTapRef.current = null;
      doubleTapSkip(side);
      return;
    }
    lastTapRef.current = { side, at: now };
    openControlsBriefly();
  }, [doubleTapSkip, openControlsBriefly, endLongPress]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    openControlsBriefly();
  }, [openControlsBriefly]);

  const fmt = (n: number) => {
    if (!Number.isFinite(n) || n < 0) return "0:00";
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60).toString().padStart(2, "0");
    return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => {
      setCurrent(v.currentTime || 0);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setPaused(v.paused);
    };
    const onWaiting = () => setLoading(true);
    const onReadyData = () => setLoading(false);
    v.addEventListener("timeupdate", update);
    v.addEventListener("durationchange", update);
    v.addEventListener("play", update);
    v.addEventListener("pause", update);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("seeking", onWaiting);
    v.addEventListener("seeked", onReadyData);
    v.addEventListener("canplay", onReadyData);
    return () => {
      v.removeEventListener("timeupdate", update);
      v.removeEventListener("durationchange", update);
      v.removeEventListener("play", update);
      v.removeEventListener("pause", update);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("seeking", onWaiting);
      v.removeEventListener("seeked", onReadyData);
      v.removeEventListener("canplay", onReadyData);
    };
  }, []);

  useEffect(() => () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className={videoClassName}
        style={videoStyle}
        playsInline
        controls={false}
        autoPlay
        preload="auto"
        crossOrigin="anonymous"
        onClick={(e) => { e.stopPropagation(); openControlsBriefly(); }}
      />
      <div className="absolute inset-0 z-30 grid grid-cols-2" onClick={(e) => e.stopPropagation()}>
        <button
          aria-label="Back 5 seconds"
          className="h-full touch-manipulation"
          onPointerDown={startLongPress}
          onPointerUp={() => handleTapZone("left")}
          onPointerLeave={endLongPress}
          onPointerCancel={endLongPress}
        />
        <button
          aria-label="Forward 5 seconds"
          className="h-full touch-manipulation"
          onPointerDown={startLongPress}
          onPointerUp={() => handleTapZone("right")}
          onPointerLeave={endLongPress}
          onPointerCancel={endLongPress}
        />
      </div>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-40 bg-black/70 pointer-events-none">
          <div className="player-loader-shell" aria-hidden="true">
            {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
          </div>
        </div>
      )}

      {speedBoost && <div className="player-speed-hud">2× SPEED ▶▶</div>}

      {skipHint && (
        <div
          className={`youtube-skip-burst absolute top-1/2 -translate-y-1/2 z-50 ${skipHint.side === "left" ? "left-[18%]" : "right-[18%]"}`}
        >
          <div className="youtube-skip-ring">
            {skipHint.side === "left" ? <RotateCcw className="w-5 h-5" /> : <RotateCw className="w-5 h-5" />}
            <span>{skipHint.total}s</span>
          </div>
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-50 player-custom-controls transition-transform duration-150 ${controlsOpen || paused ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 pointer-events-none"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pb-3 pt-12 bg-gradient-to-t from-black/95 via-black/55 to-transparent">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || current)}
            onChange={(e) => {
              const v = videoRef.current;
              const next = Number(e.target.value);
              if (v) v.currentTime = next;
              setCurrent(next);
            }}
            className="player-seek w-full"
            aria-label="Seek video"
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-2">
              <button onClick={() => seekBy(-10)} className="player-control-round" aria-label="Back 10 seconds"><RotateCcw className="w-4 h-4" /></button>
              <button onClick={togglePlay} className="player-control-main" aria-label={paused ? "Play" : "Pause"}>
                {paused ? <Play className="w-5 h-5 ml-0.5" fill="currentColor" /> : <Pause className="w-5 h-5" fill="currentColor" />}
              </button>
              <button onClick={() => seekBy(10)} className="player-control-round" aria-label="Forward 10 seconds"><RotateCw className="w-4 h-4" /></button>
            </div>
            <div className="text-[11px] font-semibold tabular-nums text-white/90 whitespace-nowrap">
              {fmt(current)} / {fmt(duration)}
            </div>
          </div>
        </div>
      </div>

      {/* Quality + Audio HUD — anchored bottom-left, well above the native
          control bar so it never collides with play/seek/speed UI. Both pills
          share the exact same height/radius/border so the cluster looks
          aligned next to the top-bar buttons. */}
      {streams.length > 0 && (
        <div className="absolute bottom-20 left-2 z-50 flex gap-2 pointer-events-auto">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowQ((v) => !v); setShowA(false); }}
              className="h-7 inline-flex items-center gap-1 px-2.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/15 text-white text-[12px] font-semibold hover:bg-black/90 active:scale-95 transition-all shadow-lg"
            >
              <Layers className="w-3 h-3" /> {streams[qIdx]?.label || "Auto"}
            </button>
            {showQ && (
              <div onClick={(e) => e.stopPropagation()} className="absolute bottom-full mb-1.5 left-0 bg-black/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden min-w-[120px] shadow-2xl">
                {streams.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => changeQuality(i)}
                    className={`block w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 ${i === qIdx ? "text-primary font-semibold" : "text-white"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {audios.length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowA((v) => !v); setShowQ(false); }}
                className="h-7 inline-flex items-center gap-1 px-2.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/15 text-white text-[12px] font-semibold hover:bg-black/90 active:scale-95 transition-all shadow-lg"
              >
                <Volume2 className="w-3 h-3" /> {audios[aIdx]?.name || "Audio"}
              </button>
              {showA && (
                <div onClick={(e) => e.stopPropagation()} className="absolute bottom-full mb-1.5 left-0 bg-black/95 backdrop-blur-md rounded-xl border border-white/10 overflow-hidden min-w-[130px] shadow-2xl">
                  {audios.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => changeAudio(i)}
                      className={`block w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 ${i === aIdx ? "text-primary font-semibold" : "text-white"}`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
