import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, Volume2, VolumeX, Maximize, Languages, RotateCcw, RotateCw } from "lucide-react";

import type { DownloadedVideo } from "@/lib/downloadStore";
import { getAudioTrackBlobs, getVideoBlob } from "@/lib/downloadStore";
import { cn } from "@/lib/utils";

interface OfflinePlayerProps {
  item: DownloadedVideo;
  playlist: DownloadedVideo[];
  onSelect: (item: DownloadedVideo) => void;
  onBack: () => void;
}

const fmt = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Offline player — identical controls to the online player, minus the server
 * switcher (a downloaded file has no server). Downloaded AN/HLS files keep
 * their audio tracks, so language switching works offline too.
 */
const OfflinePlayer = ({ item, playlist, onSelect, onBack }: OfflinePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const [src, setSrc] = useState("");
  const [audioTracks, setAudioTracks] = useState<{ label: string; lang?: string; url: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState(-1);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controls, setControls] = useState(true);

  useEffect(() => {
    let revoked: string[] = [];
    let cancelled = false;
    (async () => {
      const blob = await getVideoBlob(item.id);
      if (cancelled || !blob) return;
      const url = URL.createObjectURL(blob);
      revoked.push(url);
      setSrc(url);
      const tracks = await getAudioTrackBlobs(item.id);
      const mapped = tracks.map((track) => {
        const audioUrl = URL.createObjectURL(track.blob);
        revoked.push(audioUrl);
        return { label: track.label, lang: track.lang, url: audioUrl };
      });
      if (!cancelled) {
        setAudioTracks(mapped);
        setActiveAudio(-1);
      }
    })();
    return () => {
      cancelled = true;
      revoked.forEach((url) => { try { URL.revokeObjectURL(url); } catch {} });
    };
  }, [item.id]);

  // Keep the external audio track locked to the video clock.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    if (!audio || activeAudio < 0) { video.muted = muted; return; }
    video.muted = true;
    audio.muted = muted;
    const sync = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > 0.25) audio.currentTime = video.currentTime;
    };
    const onPlay = () => { sync(); void audio.play().catch(() => {}); };
    const onPause = () => audio.pause();
    video.addEventListener("timeupdate", sync);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", sync);
    };
  }, [activeAudio, muted, src]);

  const upNext = useMemo(() => {
    const index = playlist.findIndex((entry) => entry.id === item.id);
    return index < 0 ? playlist : playlist.slice(index + 1).concat(playlist.slice(0, index));
  }, [playlist, item.id]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {}); else video.pause();
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  };

  return (
    <div className="fixed inset-0 z-[120] bg-background flex flex-col overflow-y-auto">
      <div ref={shellRef} className="relative w-full aspect-video bg-black shrink-0" onClick={() => setControls((v) => !v)}>
        <video
          ref={videoRef}
          src={src}
          poster={item.poster}
          className="w-full h-full object-contain"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />
        {activeAudio >= 0 && audioTracks[activeAudio] && (
          <audio ref={audioRef} src={audioTracks[activeAudio].url} preload="auto" />
        )}

        <div className={cn(
          "absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/85 transition-opacity duration-200",
          controls ? "opacity-100" : "opacity-0 pointer-events-none",
        )}>
          <div className="flex items-center gap-3 px-3 pt-3">
            <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="w-9 h-9 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-primary-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate text-primary-foreground">{item.title}</p>
              <p className="text-[11px] text-primary-foreground/70 truncate">
                {item.episodeLabel || item.subtitle} · Offline{item.quality ? ` · ${item.quality}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-7" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => seekBy(-10)} className="w-11 h-11 rounded-full bg-black/40 flex items-center justify-center text-primary-foreground">
              <RotateCcw className="w-5 h-5" />
            </button>
            <button onClick={toggle} className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center text-primary-foreground shadow-lg">
              {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
            </button>
            <button onClick={() => seekBy(10)} className="w-11 h-11 rounded-full bg-black/40 flex items-center justify-center text-primary-foreground">
              <RotateCw className="w-5 h-5" />
            </button>
          </div>

          <div className="px-3 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }}
              className="w-full h-1 accent-primary"
            />
            <div className="flex items-center justify-between text-[11px] text-primary-foreground/85">
              <span>{fmt(time)} / {fmt(duration)}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setMuted((v) => !v)}>{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
                {audioTracks.length > 0 && (
                  <div className="relative">
                    <button onClick={() => setShowAudioMenu((v) => !v)} className="flex items-center gap-1">
                      <Languages className="w-4 h-4" />
                      <span>{activeAudio < 0 ? "Original" : audioTracks[activeAudio]?.label}</span>
                    </button>
                    {showAudioMenu && (
                      <div className="absolute bottom-7 right-0 min-w-[140px] rounded-xl bg-card/95 border border-border shadow-xl overflow-hidden">
                        {[{ label: "Original", lang: "" }, ...audioTracks].map((track, idx) => {
                          const value = idx - 1;
                          return (
                            <button
                              key={`${track.label}-${idx}`}
                              onClick={() => { setActiveAudio(value); setShowAudioMenu(false); }}
                              className={cn(
                                "w-full px-3 py-2 text-left text-xs",
                                value === activeAudio ? "bg-primary/15 text-primary font-semibold" : "text-foreground hover:bg-muted/50",
                              )}
                            >
                              {track.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => { void shellRef.current?.requestFullscreen?.().catch(() => {}); }}>
                  <Maximize className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {upNext.length > 0 && (
        <div className="px-4 py-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next · offline</p>
          {upNext.map((entry) => (
            <button
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="w-full flex items-center gap-3 p-2 rounded-xl bg-card border border-border/60 hover:border-primary/50 transition-colors text-left"
            >
              <div className="w-24 aspect-video rounded-lg overflow-hidden bg-muted shrink-0">
                {entry.poster && <img src={entry.poster} alt={entry.title} className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{entry.episodeLabel || entry.subtitle || entry.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {(entry.size / (1024 * 1024)).toFixed(1)} MB{entry.quality ? ` · ${entry.quality}` : ""}
                </p>
              </div>
              <Play className="w-4 h-4 text-primary shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default OfflinePlayer;
