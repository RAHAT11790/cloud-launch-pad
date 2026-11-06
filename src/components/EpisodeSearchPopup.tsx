import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, Lock, PlayCircle, X } from "@phosphor-icons/react";
import { matchesEpisode } from "@/lib/episodeSearch";

type Episode = { number: number; label?: string; combo?: boolean; title?: string; active: boolean; onClick: () => void; locked?: boolean; lockKind?: "premium" | "login" };

/** Small Telegram-like popup: type an episode number or title, tap a result to play it. */
export default function EpisodeSearchPopup({ episodes, onClose }: { episodes: Episode[]; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const results = useMemo(() => episodes.filter(ep => matchesEpisode(ep, term)), [episodes, term]);
  return createPortal(
    <div className="fixed inset-0 z-[600] flex items-start justify-center bg-foreground/40 px-4 pt-[max(72px,env(safe-area-inset-top))]" onClick={onClose} data-player-panel="true">
      <div role="dialog" aria-label="Search episodes" className="cc-sheet w-full max-w-sm overflow-hidden rounded-3xl bg-card text-foreground shadow-2xl border border-border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <div className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl bg-secondary border border-border px-3 h-11">
            <MagnifyingGlass size={19} weight="bold" className="text-primary shrink-0" />
            <input ref={input} aria-label="Episode number or title" placeholder="Episode number or title" inputMode="search" value={term} onChange={e => setTerm(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && results[0]) { results[0].onClick(); onClose(); } }}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none" />
            {term && <button type="button" aria-label="Clear search" onClick={() => { setTerm(""); input.current?.focus(); }} className="text-muted-foreground"><X size={16} weight="bold" /></button>}
          </div>
          <button type="button" aria-label="Close search" onClick={onClose} className="cc-3d h-11 w-11 shrink-0 rounded-full grid place-items-center text-foreground"><X size={18} weight="bold" /></button>
        </div>
        <div className="max-h-[52dvh] overflow-y-auto p-2">
          {results.length === 0 && <p role="status" className="py-8 text-center text-sm text-muted-foreground">No episodes found</p>}
          {results.slice(0, 200).map(ep => (
            <button key={`${ep.number}-${ep.label || ""}`} type="button" onClick={() => { ep.onClick(); onClose(); }}
              className={`w-full flex items-center gap-3 rounded-2xl px-2.5 py-2 text-left active:scale-[0.98] transition-transform ${ep.active ? "bg-primary/15" : "active:bg-secondary"}`}>
              <span className={`h-11 min-w-[44px] px-1.5 shrink-0 rounded-xl grid place-items-center text-[13px] font-extrabold ${ep.active ? "cc-3d-primary" : "cc-3d text-foreground"}`}>
                {ep.label || String(ep.number).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold truncate">{ep.combo ? `Episodes ${ep.label}` : `Episode ${ep.number}`}</span>
                {ep.title && ep.title.trim().toLowerCase() !== (ep.combo ? `episodes ${ep.label}` : `episode ${ep.number}`).toLowerCase() && <span className="block text-[12px] text-muted-foreground truncate">{ep.title}</span>}
              </span>
              {ep.locked ? <Lock size={18} weight="fill" className="text-primary shrink-0" /> : ep.active ? <span className="text-[11px] font-bold text-primary shrink-0">Playing</span> : <PlayCircle size={22} weight="duotone" className="text-primary shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
