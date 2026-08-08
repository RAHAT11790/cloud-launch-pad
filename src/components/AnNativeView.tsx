// ============================================================
// AnNativeView — native HLS player for AN content (no iframe).
//
// Given AN HLS data freshly resolved from the live AnimeSalt API
// (Index.tsx -> animeSaltApi), this component:
//   1. Builds a synthesized HLS master playlist (data: URL) that combines
//      ONE video variant + ALL provided audio renditions.
//   2. Plays the API-returned URLs in a native <video> via hls.js.
//      No Firebase reads — playback is 100% API-driven so links never go stale.
//   3. Quality switching rebuilds the master (preserves currentTime + audio
//      track) — fixed-quality model, no ABR. Audio switching uses the
//      hls.js audioTrack API (instant).
//
// Falls back via onFail() if extraction returns no streams or hls errors.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Layers, Pause, Play, RotateCcw, RotateCw, Volume2 } from "lucide-react";
import { wrapAnHlsPlaybackUrl } from "@/lib/anPlaybackProxy";

type Stream = { url: string; label: string; height: number; resolution: string; bandwidth: number; codecs?: string };
type Audio  = { language: string; name: string; uri: string };

export type AnNativeResolvedData = {
  streams: Stream[];
  audio: Audio[];
  preferredQualityIdx?: number;
  defaultAudioIdx?: number;
};

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
  /** Already-extracted HLS data from the card-click/loading-details phase. */
  initialData?: AnNativeResolvedData | null;
}

const hlsUrl = (u: string) => {
  const raw = String(u || "").trim();
  if (!raw || raw.startsWith("data:")) return raw;
  return wrapAnHlsPlaybackUrl(raw);
};
// AN subtitle extraction/proxy was removed from the API for stability.

function buildMaster(stream: Stream, audios: Audio[], defaultAudioIdx: number): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  audios.forEach((a, i) => {
    const isDefault = i === defaultAudioIdx;
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${a.name.replace(/"/g, "")}",` +
      `LANGUAGE="${a.language || a.name.slice(0, 2).toLowerCase()}",` +
      `DEFAULT=${isDefault ? "YES" : "NO"},AUTOSELECT=YES,URI="${hlsUrl(a.uri)}"`
    );
  });
  const audioRef = audios.length > 0 ? ',AUDIO="aud"' : "";
  const height = Number(stream.height || 720);
  const resolution = stream.resolution || `${Math.round((height * 16) / 9)}x${height}`;
  // CODECS attribute is REQUIRED when the master declares a separate AUDIO
  // group. Without it, MSE can't decide which SourceBuffers to open and
  // hls.js parses the manifest + level but never starts fragment loading —
  // playback hangs at readyState 0 forever. If the upstream master exposed
  // CODECS we pass it through; otherwise fall back to H.264 High + AAC-LC
  // which covers every AnimeSalt stream we've seen.
  const codecs = stream.codecs && stream.codecs.trim() ? stream.codecs.trim() : "avc1.4d401f,mp4a.40.2";
  lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${stream.bandwidth || Math.max(height * 5000, 2560000)},RESOLUTION=${resolution},CODECS="${codecs}"${audioRef}`);
  lines.push(hlsUrl(stream.url));
  const text = lines.join("\n");
  // data URL avoids needing yet another endpoint; hls.js handles it natively
  return `data:application/vnd.apple.mpegurl;base64,${btoa(unescape(encodeURIComponent(text)))}`;
}

const isHindiAudio = (track?: Pick<Audio, "language" | "name"> | null) => {
  const blob = `${track?.language || ""} ${track?.name || ""}`.toLowerCase();
  return /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob);
};

const pickHindiAudioIdx = (audio: Audio[]) => {
  const hindiIdx = audio.findIndex(isHindiAudio);
  return hindiIdx >= 0 ? hindiIdx : 0;
};

const pickQualityIdx = (streams: Stream[]) => {
  const preferred = streams.findIndex((x) => x.height === 720);
  const fallback = streams.findIndex((x) => x.height === 1080 || x.height >= 480);
  return preferred >= 0 ? preferred : (fallback >= 0 ? fallback : 0);
};

export default function AnNativeView({ videoStyle, videoClassName, resumeTime, onFail, onReady, onTimeUpdate, initialData }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streams, setStreams] = useState<Stream[]>(() => initialData?.streams || []);
  const [audios, setAudios]   = useState<Audio[]>(() => initialData?.audio || []);
  const [qIdx, setQIdx]       = useState(() => initialData?.preferredQualityIdx ?? pickQualityIdx(initialData?.streams || []));
  const [aIdx, setAIdx]       = useState(() => initialData?.defaultAudioIdx ?? pickHindiAudioIdx(initialData?.audio || []));
  const [loading, setLoading] = useState(true);
  const [showQ, setShowQ]     = useState(false);
  const [showA, setShowA]     = useState(false);
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
  // Sequential quality probe state — when a quality fails, we try the next one
  // (one at a time, ~5s probe each) before ever telling the parent to switch server.
  const badQualitiesRef = useRef<Set<number>>(new Set());
  const probeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeStartRef = useRef(0);
  // Track whether we've already applied the initial resume — so quality
  // switching mid-playback keeps current position, not the original resume.
  const resumedRef = useRef(false);


  // 1. Load streams + audio strictly from initialData (live AnimeSalt API).
  useEffect(() => {
    let cancelled = false;
    failedRef.current = false;
    resumedRef.current = false;
    badQualitiesRef.current = new Set();
    if (probeTimerRef.current) { clearTimeout(probeTimerRef.current); probeTimerRef.current = null; }
    setLoading(true);
    setStreams([]); setAudios([]);
    (async () => {
      try {
        if (initialData?.streams?.length) {
          setStreams(initialData.streams);
          setAudios(initialData.audio || []);
          setQIdx(initialData.preferredQualityIdx ?? pickQualityIdx(initialData.streams));
          setAIdx(initialData.defaultAudioIdx ?? pickHindiAudioIdx(initialData.audio || []));
          onReady?.();
          try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
          return;
        }
        onFail?.("an-api-no-streams");
      } catch (e) {
        if (cancelled) return;
        onFail?.((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [initialData, onFail, onReady]);

  // Sequential quality fallback — mark current quality bad, try next healthy
  // one. Only calls onFail when EVERY quality has been tried and none work.
  const advanceToNextQuality = useCallback((reason: string) => {
    console.warn('[AnNative] quality failed:', qIdx, reason);
    badQualitiesRef.current.add(qIdx);
    const nextIdx = streams.findIndex((_, i) => !badQualitiesRef.current.has(i));
    if (nextIdx < 0) {
      if (failedRef.current) return;
      failedRef.current = true;
      onFail?.(`all-qualities-failed:${reason}`);
      return;
    }
    setLoading(true);
    setQIdx(nextIdx);
  }, [qIdx, streams, onFail]);


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
        try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      return () => video.removeEventListener("loadedmetadata", onLoaded);
    }

    // hls.js path — tuned for FAST first-frame + slow-network resilience.
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Let hls.js measure the real connection. A forced high estimate starts
      // too aggressively on mobile and can stall before the buffer grows.
      testBandwidth: true,
      abrEwmaDefaultEstimate: 5_500_000,
      abrBandWidthFactor: 0.92,
      abrBandWidthUpFactor: 0.82,
      // Bigger buffer lets the browser absorb more network instead of sipping
      // one small segment at a time.
      maxBufferLength: 120,
      maxMaxBufferLength: 300,
      maxBufferSize: 240 * 1000 * 1000,
      backBufferLength: 30,
      // Aggressive retries for flaky connections — instead of giving up,
      // retry quickly so playback recovers without user action.
      manifestLoadingTimeOut: 9000,
      manifestLoadingMaxRetry: 8,
      manifestLoadingRetryDelay: 180,
      levelLoadingTimeOut: 9000,
      levelLoadingMaxRetry: 8,
      levelLoadingRetryDelay: 180,
      fragLoadingTimeOut: 18000,
      fragLoadingMaxRetry: 10,
      fragLoadingRetryDelay: 180,
      nudgeMaxRetry: 10,
      progressive: true,
      highBufferWatchdogPeriod: 1,
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
    const applyPreferredAudio = () => {
      const tracks = hls.audioTracks || [];
      if (tracks.length === 0) return;
      const manifestDefault = tracks.findIndex((track: any) => track?.default);
      const hindiTrack = tracks.findIndex((track: any) => {
        const blob = `${track?.lang || ""} ${track?.name || ""}`.toLowerCase();
        return /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob);
      });
      const wanted = hindiTrack >= 0 ? hindiTrack : (manifestDefault >= 0 ? manifestDefault : Math.min(aIdx, tracks.length - 1));
      try { hls.audioTrack = wanted; } catch {}
    };

    // Arm a probe timer — if this quality hasn't reached canplay within 6s,
    // treat it as failed and move on. Cleared on first playable frame below.
    probeStartRef.current = Date.now();
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
    probeTimerRef.current = setTimeout(() => {
      // Only fire if we're still stuck buffering — never interrupt playing video.
      const vid = videoRef.current;
      if (!vid) return;
      const playable = vid.readyState >= 3 || (vid.currentTime > 0 && !vid.paused);
      if (playable) return;
      advanceToNextQuality("probe-timeout");
    }, 6000);

    const clearProbe = () => {
      if (probeTimerRef.current) { clearTimeout(probeTimerRef.current); probeTimerRef.current = null; }
    };

    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(master));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      applyPreferredAudio();
      if (initialStart > 0 && Math.abs(video.currentTime - initialStart) > 2) {
        try { video.currentTime = initialStart; } catch {}
      }
      resumedRef.current = true;
      if (!wasPaused) video.play().catch(() => {});
      setLoading(false);
      try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      applyPreferredAudio();
    });
    // Once we actually get playable video, cancel the probe — this quality works.
    const onCanPlayOnce = () => { clearProbe(); video.removeEventListener("canplay", onCanPlayOnce); video.removeEventListener("playing", onCanPlayOnce); };
    video.addEventListener("canplay", onCanPlayOnce);
    video.addEventListener("playing", onCanPlayOnce);

    let recoveryAttempted = false;
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      // Try ONE non-destructive recovery per session — network stalls sometimes
      // clear themselves. If that too fails, walk to the next quality one by
      // one; we never spam-jump servers here.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveryAttempted) {
        recoveryAttempted = true;
        try { hls.startLoad(); return; } catch {}
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveryAttempted) {
        recoveryAttempted = true;
        try { hls.recoverMediaError(); return; } catch {}
      }
      // Non-recoverable → give this quality's slot to the next candidate.
      clearProbe();
      advanceToNextQuality(`hls-${data.type}-${data.details}`);
    });
    return () => {
      clearProbe();
      video.removeEventListener("canplay", onCanPlayOnce);
      video.removeEventListener("playing", onCanPlayOnce);
      hls.destroy();
      hlsRef.current = null;
    };
    // resumeTime intentionally NOT in deps — re-running on resume change
    // would tear down hls mid-playback. Only embed/quality/audio rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, qIdx, audios, aIdx, onFail, advanceToNextQuality]);


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
    // User picked a quality manually — clear the auto-blacklist so they can
    // freely try any of them without our fallback logic hijacking.
    badQualitiesRef.current = new Set();
    failedRef.current = false;
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
    const onReadyData = () => {
      setLoading(false);
      try { window.dispatchEvent(new Event("rs:force-close-details-loader")); } catch {}
    };
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
    if (probeTimerRef.current) clearTimeout(probeTimerRef.current);
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
        <div className="absolute bottom-20 left-2 z-[90] flex gap-2 pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
                onPointerDown={(e) => e.stopPropagation()}
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
                onPointerDown={(e) => e.stopPropagation()}
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
