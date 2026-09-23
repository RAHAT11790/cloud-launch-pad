import { Crown, Lock, Sparkles, X } from "lucide-react";
import premiumFrame from "@/assets/premium-lock-frame.png";

/**
 * Golden premium treatment used on every card whose content is inside an
 * active premium lock window (per-episode lock or whole-series lock).
 * Free content keeps the normal card look — this frame only appears on locked
 * titles, so users can tell a premium card from a free one at a glance.
 */
export const PremiumCardFrame = ({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) => (
  <>
    <div
      className="pointer-events-none absolute inset-0 z-[12]"
      style={{ background: "linear-gradient(to top, rgba(69,26,3,0.55) 0%, rgba(250,204,21,0.10) 52%, rgba(255,255,255,0.05) 100%)" }}
    />
    <img
      src={premiumFrame}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={1024}
      height={1536}
      className="pointer-events-none absolute inset-0 z-[13] h-full w-full select-none object-fill rs-premium-frame-img"
    />
    {label ? (
      <div className="pointer-events-none absolute left-0 right-0 top-[38%] z-[14] flex justify-center px-2">
        <span
          className={`rs-premium-lock-badge inline-flex max-w-full items-center gap-1 rounded-full px-2 py-[3px] font-black uppercase tracking-tight ${size === "sm" ? "text-[7.5px]" : "text-[8.5px]"}`}
          style={{
            background: "linear-gradient(90deg,#b45309 0%,#fbbf24 38%,#fef08a 52%,#fbbf24 66%,#b45309 100%)",
            color: "#2b1a00",
            boxShadow: "0 3px 12px rgba(250,204,21,0.45), inset 0 0 0 1px rgba(255,255,255,0.35)",
          }}
        >
          <Crown className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </div>
    ) : null}
  </>
);

/**
 * In-player premium wall. Shown when a user hits a locked episode from inside
 * the video player (next button, episode list, season switch) so playback is
 * stopped without throwing the user out of the player.
 */
export const PlayerPremiumLock = ({
  title,
  episodeLabel,
  remainingText,
  onUpgrade,
  onDismiss,
}: {
  title?: string;
  episodeLabel?: string;
  remainingText?: string;
  onUpgrade: () => void;
  onDismiss: () => void;
}) => (
  <div
    className="absolute inset-0 z-[250] flex items-center justify-center px-5"
    style={{ background: "radial-gradient(circle at 50% 30%, rgba(69,26,3,0.85) 0%, rgba(0,0,0,0.94) 70%)", backdropFilter: "blur(6px)" }}
    role="dialog"
    aria-modal="true"
    aria-label="Premium episode locked"
  >
    <div
      className="relative w-full max-w-[380px] overflow-hidden rounded-2xl p-[1.5px]"
      style={{ background: "linear-gradient(135deg,#f59e0b,#fde047,#b45309)" }}
    >
      <div className="relative rounded-[15px] bg-[#0b0b12]/95 px-5 pb-5 pt-6 text-center">
        <button
          onClick={onDismiss}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
        <div
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl rs-premium-lock-badge"
          style={{ background: "linear-gradient(135deg,#f59e0b,#fde047)", boxShadow: "0 8px 26px rgba(250,204,21,0.35)" }}
        >
          <Lock className="h-6 w-6 text-[#3b2400]" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300/90">Premium only</p>
        <h3 className="mt-1.5 text-[17px] font-extrabold leading-tight text-white">
          {episodeLabel ? `${episodeLabel} is locked` : "This episode is locked"}
        </h3>
        {title ? <p className="mt-1 line-clamp-1 text-[12px] text-white/60">{title}</p> : null}
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/70">
          Only premium members can watch this right now.
          {remainingText && remainingText !== "unlocked"
            ? remainingText === "Permanent"
              ? " It stays premium-only."
              : ` It unlocks free in ${remainingText}.`
            : ""}
        </p>
        <button
          onClick={onUpgrade}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-3 text-[13.5px] font-black text-[#2b1a00] transition-transform active:scale-[0.98]"
          style={{ background: "linear-gradient(90deg,#f59e0b,#fde047,#f59e0b)", boxShadow: "0 8px 24px rgba(250,204,21,0.32)" }}
        >
          <Sparkles className="h-4 w-4" /> Get Premium
        </button>
        <button onClick={onDismiss} className="mt-2 w-full rounded-xl py-2.5 text-[12.5px] font-semibold text-white/60 hover:text-white">
          Keep watching this episode
        </button>
      </div>
    </div>
  </div>
);

export default PremiumCardFrame;
