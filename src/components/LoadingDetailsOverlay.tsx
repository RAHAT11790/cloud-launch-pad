import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  title?: string;
  poster?: string;
  /** 0-100 */
  progress?: number;
  /** Active step label (e.g. "Fetching episodes…") */
  step?: string;
  /** Completed steps shown with a check */
  completed?: string[];
}

/**
 * Full-screen "Loading Details" overlay shown BEFORE the video player opens.
 * Mirrors a premium streaming UX — progressive step text + animated progress bar.
 */
export default function LoadingDetailsOverlay({ open, title, poster, progress = 0, step, completed = [] }: Props) {
  const [dots, setDots] = useState("");
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 350);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
      {poster && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-20 blur-2xl bg-cover bg-center"
          style={{ backgroundImage: `url(${poster})` }}
        />
      )}
      <div className="relative w-[min(420px,92vw)] rounded-2xl border border-white/10 bg-[#0f0a1c]/90 p-5 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          {poster ? (
            <img src={poster} alt="" className="w-12 h-16 rounded object-cover border border-white/10" />
          ) : (
            <div className="w-12 h-16 rounded bg-white/10" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-purple-300/70 font-semibold">Loading details</div>
            <div className="text-sm font-bold truncate text-white">{title || "Preparing your video"}</div>
          </div>
        </div>

        <div className="space-y-1.5 mb-3 text-[11px]">
          {completed.map((c) => (
            <div key={c} className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 size={12} /> {c}
            </div>
          ))}
          {step && (
            <div className="flex items-center gap-2 text-white/90">
              <Loader2 size={12} className="animate-spin text-purple-400" />
              {step}{dots}
            </div>
          )}
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-400 transition-all duration-200"
            style={{ width: `${Math.max(8, Math.min(100, progress))}%` }}
          />
        </div>
        <div className="mt-2 text-[10px] text-white/50 text-center">
          Fetching episodes, audio tracks &amp; stream… please wait.
        </div>
      </div>
    </div>
  );
}
