import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Copy, Share2, Coins, ShieldCheck, Clock, AlertTriangle, Sparkles, Check } from "lucide-react";
import { getLocalUserId } from "@/lib/unlockAccess";
import { ensureGuestUser } from "@/lib/premiumAccess";
import { firePopunderAd } from "@/lib/adsterraAds";

interface Props {
  variant?: "full" | "compact";
  siteName?: string;
}

/**
 * Attractive invite-friends block used on the Daily Tasks page and the
 * Profile page. Handles unique link generation, one-tap copy, native share,
 * and shows the anti-fraud / 30-minute reward guide.
 */
export default function InviteFriendCard({ variant = "full", siteName = "our platform" }: Props) {
  const [copied, setCopied] = useState(false);

  const inviteUrl = useMemo(() => {
    const me = getLocalUserId() || ensureGuestUser() || "";
    const base = typeof window !== "undefined" ? window.location.origin : "https://rsanime03.lovable.app";
    return `${base}/?ref=${encodeURIComponent(me)}`;
  }, []);

  const copyLink = async () => {
    // Fire configured pop-under on the same gesture (no site self-redirect).
    void firePopunderAd();
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Invite link copied — share it anywhere!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed — long-press the link to copy manually.");
    }
  };

  const shareLink = async () => {
    void firePopunderAd();
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Join ${siteName}`,
          text: `Watch premium anime free on ${siteName}. Use my invite link:`,
          url: inviteUrl,
        });
      } else {
        await copyLink();
      }
    } catch {}
  };

  return (
    <div className="rounded-3xl overflow-hidden border border-fuchsia-400/40 bg-gradient-to-br from-[#1a0d24] via-[#170a2a] to-[#0d0a24] relative">
      {/* Decorative glow */}
      <div className="absolute -top-16 -right-14 w-56 h-56 rounded-full bg-fuchsia-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-16 w-56 h-56 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />

      <div className="relative p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-fuchsia-500/30">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-black text-white leading-tight">
                Invite Friends — Earn up to 10 Coins
              </h3>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-500 text-white uppercase tracking-wider">
                Top reward
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-white/80 leading-snug">
              Share your personal link. When a friend joins and watches for 30 minutes,
              you earn <b className="text-amber-300">+10 coins</b>. Quick visits still
              give you <b className="text-emerald-300">+1 coin</b>.
            </p>
          </div>
        </div>

        {/* Link box */}
        <div className="mt-4 rounded-2xl bg-black/40 border border-white/10 p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0 font-mono text-[11.5px] sm:text-[12.5px] text-white/95 truncate">
            {inviteUrl}
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="flex-shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white active:scale-[0.97] transition-transform inline-flex items-center gap-1.5 shadow-lg shadow-fuchsia-500/25"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Actions */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={shareLink}
            className="text-[12px] font-bold py-2.5 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.09] inline-flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-3.5 h-3.5 text-fuchsia-300" /> Share link
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="text-[12px] font-bold py-2.5 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.09] inline-flex items-center justify-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5 text-fuchsia-300" /> Copy link
          </button>
        </div>

        {variant === "full" && (
          <>
            {/* How it works */}
            <div className="mt-4 rounded-2xl bg-black/40 border border-white/10 p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-fuchsia-300" />
                <h4 className="text-[12px] font-black uppercase tracking-wider text-white">How it works</h4>
              </div>
              <ol className="space-y-2 text-[12.5px] leading-relaxed">
                <li className="flex gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-black flex-shrink-0 mt-0.5">1</span>
                  <span className="text-white/85">Copy your unique invite link above and send it to friends on WhatsApp, Telegram, Messenger — anywhere.</span>
                </li>
                <li className="flex gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-black flex-shrink-0 mt-0.5">2</span>
                  <span className="text-white/85">When a friend opens your link, you instantly earn <b className="text-emerald-300">+1 coin</b> as an entry bonus.</span>
                </li>
                <li className="flex gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-black flex-shrink-0 mt-0.5">3</span>
                  <span className="text-white/85">If that friend stays and watches for <b className="text-amber-300">30 minutes</b>, you automatically earn <b className="text-amber-300">+9 extra coins</b> (10 coins total).</span>
                </li>
                <li className="flex gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-fuchsia-500 text-white text-[10px] font-black flex-shrink-0 mt-0.5">4</span>
                  <span className="text-white/85">Rewards land in your coin wallet in real-time — no waiting, no manual claim.</span>
                </li>
              </ol>
            </div>

            {/* Rewards strip */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/25 p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-emerald-300">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Quick visit</span>
                </div>
                <div className="mt-1 flex items-center justify-center gap-1 text-emerald-200">
                  <Coins className="w-4 h-4" />
                  <span className="text-lg font-black leading-none">+1</span>
                </div>
              </div>
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-amber-300">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Stays 30 min</span>
                </div>
                <div className="mt-1 flex items-center justify-center gap-1 text-amber-200">
                  <Coins className="w-4 h-4" />
                  <span className="text-lg font-black leading-none">+10</span>
                </div>
              </div>
            </div>

            {/* Anti-fraud warning */}
            <div className="mt-3 rounded-2xl bg-red-950/40 border border-red-400/40 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldCheck className="w-4 h-4 text-red-300" />
                <h4 className="text-[12px] font-black uppercase tracking-wider text-white">
                  Anti-Fraud • IP Tracking Active
                </h4>
              </div>
              <p className="text-[12px] text-white/85 leading-relaxed">
                Every invite is verified by <b className="text-red-300">network IP address</b> —
                the same system used by major ad networks. Only genuine, real invites are counted.
              </p>
              <ul className="mt-2 space-y-1.5 text-[12px] text-white/85">
                <li className="flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-300 flex-shrink-0 mt-0.5" />
                  <span>One Wi-Fi / mobile network = <b className="text-red-300">only one invite</b> counts, no matter how many devices or accounts you use.</span>
                </li>
                <li className="flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-300 flex-shrink-0 mt-0.5" />
                  <span>Creating multiple accounts on the same phone will <b className="text-red-300">NOT</b> earn extra coins — the system detects it instantly.</span>
                </li>
                <li className="flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-300 flex-shrink-0 mt-0.5" />
                  <span>Fake / self-referrals are <b className="text-red-300">blocked and logged</b>. Abuse may lead to a permanent coin-earning ban.</span>
                </li>
              </ul>
              <p className="mt-2 text-[12px] font-bold text-emerald-300">
                ✓ Share with real friends → real coins → real Premium.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
