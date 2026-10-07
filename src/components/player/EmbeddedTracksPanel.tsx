import { Check, Image as ImageIcon, Languages, Loader2, Subtitles } from "lucide-react";
import type { EmbeddedTrackList } from "@/lib/mkv/trackProbe";

interface Props {
  tab: "audio" | "subtitle";
  onTab: (tab: "audio" | "subtitle") => void;
  tracks: EmbeddedTrackList;
  activeAudio: number;
  activeSubtitle: number;
  busy: boolean;
  onAudio: (number: number) => void;
  onSubtitle: (number: number) => void;
  captionFontScale: number;
  captionVerticalOffset: number;
  onCaptionFontScale: (v: number) => void;
  onCaptionVerticalOffset: (v: number) => void;
}

const row = (active: boolean, disabled = false) =>
  `w-full text-left px-2 py-1.5 rounded-lg text-[11px] transition-all flex items-center justify-between gap-1.5 ${
    disabled ? "opacity-45 cursor-not-allowed" : active ? "gradient-primary font-bold text-white" : "hover:bg-foreground/10"
  }`;

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded-md bg-foreground/10 px-1 py-[1px] text-[8.5px] font-semibold uppercase tracking-wide opacity-80">{children}</span>
);

/** CC panel body for audio languages + subtitles embedded inside an .mkv. */
export const EmbeddedTracksPanel = ({
  tab, onTab, tracks, activeAudio, activeSubtitle, busy, onAudio, onSubtitle,
  captionFontScale, captionVerticalOffset, onCaptionFontScale, onCaptionVerticalOffset,
}: Props) => (
  <>
    <div className="flex gap-1 mb-2">
      <button onClick={() => onTab("audio")} className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 ${tab === "audio" ? "gradient-primary text-white" : "bg-foreground/10"}`}>
        <Languages className="w-3 h-3" /> Audio <span className="opacity-70">{tracks.audio.length}</span>
      </button>
      <button onClick={() => onTab("subtitle")} className={`flex-1 text-[10px] px-2 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1 ${tab === "subtitle" ? "gradient-primary text-white" : "bg-foreground/10"}`}>
        <Subtitles className="w-3 h-3" /> Subtitle <span className="opacity-70">{tracks.subtitles.length}</span>
      </button>
    </div>
    {tab === "audio" ? (
      <div className="space-y-0.5">
        {tracks.audio.map((track) => {
          const active = activeAudio === track.number;
          const disabled = !track.playable && track.number !== tracks.nativeAudio;
          return (
            <button key={track.number} disabled={disabled || busy} onClick={() => onAudio(track.number)} className={row(active, disabled)}>
              <span className="truncate flex-1 min-w-0">{track.label}</span>
              <Badge>{track.codec}</Badge>
              {active && busy ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" /> : active ? <Check className="w-3 h-3 shrink-0" /> : null}
            </button>
          );
        })}
        {tracks.audio.some((t) => !t.playable && t.number !== tracks.nativeAudio) && (
          <p className="px-2 pt-1 text-[9.5px] leading-snug text-muted-foreground">Dimmed tracks use a format this browser can't decode.</p>
        )}
      </div>
    ) : (
      <div className="space-y-1">
        <button onClick={() => onSubtitle(-1)} className={row(activeSubtitle < 0)}>
          <span>Off</span>{activeSubtitle < 0 && <Check className="w-3 h-3" />}
        </button>
        {tracks.subtitles.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-2">No subtitles in this file</p>
        ) : tracks.subtitles.map((track) => {
          const active = activeSubtitle === track.number;
          return (
            <button key={track.number} disabled={busy} onClick={() => onSubtitle(track.number)} className={row(active)}>
              <span className="truncate flex-1 min-w-0">{track.label}</span>
              {track.bitmap ? <ImageIcon className="w-3 h-3 shrink-0 opacity-70" /> : <Badge>{track.codec}</Badge>}
              {active && busy ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" /> : active ? <Check className="w-3 h-3 shrink-0" /> : null}
            </button>
          );
        })}
        <div className="mt-2 space-y-2 rounded-lg bg-foreground/10 px-2 py-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>Caption size</span><span>{captionFontScale.toFixed(1)}x</span></div>
            <input type="range" min={0.8} max={1.8} step={0.1} value={captionFontScale} onChange={(e) => onCaptionFontScale(Number(e.target.value))} className="w-full accent-primary" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>Caption position</span><span>{captionVerticalOffset}%</span></div>
            <input type="range" min={4} max={28} step={1} value={captionVerticalOffset} onChange={(e) => onCaptionVerticalOffset(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        </div>
      </div>
    )}
  </>
);
