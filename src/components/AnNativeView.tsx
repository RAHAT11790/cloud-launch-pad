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
import { Layers, Volume2 } from "lucide-react";

const SUPA = (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://kqxpzqegtvaiwgdusrin.supabase.co";
const AN_API = `${SUPA}/functions/v1/an-api`;
const HLS_PROXY = `${AN_API}/hls`;

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

export default function AnNativeView({ embedUrl, videoStyle, videoClassName, onFail, onReady }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [audios, setAudios]   = useState<Audio[]>([]);
  const [qIdx, setQIdx]       = useState(0);
  const [aIdx, setAIdx]       = useState(0);
  const [loading, setLoading] = useState(true);
  const [showQ, setShowQ]     = useState(false);
  const [showA, setShowA]     = useState(false);
  const failedRef = useRef(false);

  // 1. Fetch streams + audio from edge function
  useEffect(() => {
    let cancelled = false;
    failedRef.current = false;
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
        setQIdx(0);
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
    const resumeAt = video.currentTime || 0;
    const wasPaused = video.paused;

    // Native HLS (Safari / iOS)
    if (video.canPlayType("application/vnd.apple.mpegurl") && !Hls.isSupported()) {
      video.src = master;
      const onLoaded = () => { if (resumeAt) video.currentTime = resumeAt; if (!wasPaused) video.play().catch(() => {}); setLoading(false); };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      return () => video.removeEventListener("loadedmetadata", onLoaded);
    }

    // hls.js path
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30,
      maxBufferLength: 60,
      maxMaxBufferLength: 180,
      // Fixed quality — but we only ever feed one variant, so ABR is moot
      capLevelToPlayerSize: false,
    });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(master));
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (resumeAt) video.currentTime = resumeAt;
      if (!wasPaused) video.play().catch(() => {});
      setLoading(false);
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      // Default audio is already set inside the master via DEFAULT=YES.
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (failedRef.current) return;
      failedRef.current = true;
      onFail?.(`hls-${data.type}-${data.details}`);
    });
    return () => { hls.destroy(); hlsRef.current = null; };
  }, [streams, qIdx, audios, aIdx, onFail]);

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

  return (
    <>
      <video
        ref={videoRef}
        className={videoClassName}
        style={videoStyle}
        playsInline
        controls
        autoPlay
        crossOrigin="anonymous"
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black pointer-events-none">
          <div className="player-loader-shell" aria-hidden="true">
            {Array.from({ length: 12 }).map((_, i) => <span key={i} className="player-loader-petal" />)}
          </div>
        </div>
      )}

      {/* Quality + Audio HUD — sits on top of the video, above the iframe-overlay */}
      {streams.length > 0 && (
        <div className="absolute top-2 left-2 z-40 flex gap-1.5 pointer-events-auto">
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowQ((v) => !v); setShowA(false); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-semibold hover:bg-black/90"
            >
              <Layers className="w-3 h-3" /> {streams[qIdx]?.label || "Auto"}
            </button>
            {showQ && (
              <div onClick={(e) => e.stopPropagation()} className="absolute top-full mt-1 left-0 bg-black/95 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden min-w-[110px] shadow-2xl">
                {streams.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => changeQuality(i)}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/10 ${i === qIdx ? "text-primary font-semibold" : "text-white"}`}
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
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-semibold hover:bg-black/90"
              >
                <Volume2 className="w-3 h-3" /> {audios[aIdx]?.name || "Audio"}
              </button>
              {showA && (
                <div onClick={(e) => e.stopPropagation()} className="absolute top-full mt-1 left-0 bg-black/95 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden min-w-[120px] shadow-2xl">
                  {audios.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => changeAudio(i)}
                      className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/10 ${i === aIdx ? "text-primary font-semibold" : "text-white"}`}
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
