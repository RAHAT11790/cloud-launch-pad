import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Coins, LogIn, Clock, Timer, Share2, MessageSquare,
  CheckCircle2, Lock, Sparkles, Zap, Info, Gift, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useBranding } from "@/hooks/useBranding";
import { usePremium } from "@/hooks/usePremium";
import {
  DAILY_TASKS, TaskDef, DailyTaskState, subscribeDailyTasks,
  getTaskProgress, isTaskReady, isTaskClaimed, claimTask,
  markDailyLogin, getVisitSecondsToday, msUntilNextReset,
  subscribeDailyTaskOverrides, resolveDailyTasks, DailyTaskOverrides,
} from "@/lib/dailyTasks";
import {
  CustomTask, CustomTaskClaim, subscribeCustomTasks, subscribeMyCustomClaims,
  markCustomTaskVisited, claimCustomTask, canClaimCustomTask,
} from "@/lib/customTasks";
import { getLocalUserId } from "@/lib/unlockAccess";
import { ensureGuestUser } from "@/lib/premiumAccess";
import { firePopunderAd } from "@/lib/adsterraAds";
import InviteFriendCard from "@/components/InviteFriendCard";

const ICONS: Record<string, any> = {
  login: LogIn, visit30: Clock, visit120: Timer, share: Share2, comment: MessageSquare,
};

const fmtCountdown = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export default function DailyTasksPage() {
  const navigate = useNavigate();
  const branding = useBranding();
  const { wallet: coinWallet } = usePremium();

  const [state, setState] = useState<DailyTaskState>({});
  const [tick, setTick] = useState(0);
  const [countdown, setCountdown] = useState(msUntilNextReset());
  const [busy, setBusy] = useState<string | null>(null);
  const [customTasks, setCustomTasks] = useState<CustomTask[]>([]);
  const [customClaims, setCustomClaims] = useState<Record<string, CustomTaskClaim>>({});
  const [rewardOverrides, setRewardOverrides] = useState<DailyTaskOverrides>({});

  useEffect(() => subscribeCustomTasks(setCustomTasks), []);
  useEffect(() => subscribeMyCustomClaims(setCustomClaims), []);
  useEffect(() => subscribeDailyTaskOverrides(setRewardOverrides), []);

  const resolvedTasks = useMemo(() => resolveDailyTasks(rewardOverrides), [rewardOverrides]);

  // Ensure user + mark daily login progress
  useEffect(() => {
    void (async () => {
      ensureGuestUser();
      await markDailyLogin();
    })();
  }, []);

  // Live daily-task state
  useEffect(() => {
    const un = subscribeDailyTasks(setState);
    return () => un();
  }, []);

  // Refresh progress bars every 15s (visit-time comes from localStorage)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Countdown to next reset
  useEffect(() => {
    const id = window.setInterval(() => setCountdown(msUntilNextReset()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const shareUrl = useMemo(() => {
    const me = getLocalUserId() || ensureGuestUser() || "";
    const base =
      typeof window !== "undefined" ? window.location.origin : "https://rsanime03.lovable.app";
    return `${base}/?ref=${encodeURIComponent(me)}`;
  }, []);

  const openPopunderIfConfigured = () => {
    // Fires the admin-configured one-click pop-under Adsterra ad on this
    // user gesture. Never redirects to our own domain — the helper only
    // opens real http(s) URLs and otherwise injects the ad script.
    void firePopunderAd();
  };

  const handleClaim = async (task: TaskDef) => {
    if (busy) return;
    // Fire ad on the same user gesture — before the async DB call.
    openPopunderIfConfigured();
    setBusy(task.id);
    const res = await claimTask(task.id);
    setBusy(null);
    if (!res.ok) {
      const reason = (res as { reason: string }).reason;
      if (reason === "already_claimed") toast.info("You already claimed this task today.");
      else if (reason === "not_ready") toast.warning("Finish the task first to claim.");
      else toast.error("Could not claim right now.");
      return;
    }
    toast.success(`+${res.coins} coin${res.coins > 1 ? "s" : ""} claimed! Balance: ${res.total}`);
  };

  const handleShareClick = async () => {
    // Fire ad on the same click gesture.
    openPopunderIfConfigured();
    try {
      if (navigator.share) {
        await navigator.share({ title: branding.siteName || "Anime", url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Share link copied — paste it anywhere!");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Share link copied!");
      } catch {}
    }
  };

  const totalReward = resolvedTasks.reduce((s, t) => s + t.reward, 0);
  const claimedCount = resolvedTasks.filter((t) => isTaskClaimed(t, state)).length;
  const totalToday = resolvedTasks.filter((t) => isTaskClaimed(t, state))
    .reduce((s, t) => s + t.reward, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-5 pt-5 pb-24">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Hero — logo + intro */}
        <div className="mt-5 rounded-3xl overflow-hidden border border-amber-400/25 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-transparent p-5 sm:p-7">
          <div className="flex items-start gap-4">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt="logo"
                className="w-14 h-14 rounded-2xl object-cover ring-2 ring-amber-400/40 flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center flex-shrink-0">
                <Coins className="w-7 h-7 text-black" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold bg-gradient-to-r from-amber-200 to-yellow-300 bg-clip-text text-transparent leading-tight">
                Earn Free Coins Daily
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {branding.siteName || "Our platform"} rewards active users. Complete daily
                tasks, collect coins, and unlock <b className="text-amber-300">Premium</b> — no
                payment required.
              </p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-amber-300">
                <Coins className="w-4 h-4" />
                <span className="text-lg font-black leading-none">{coinWallet.coins || 0}</span>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Wallet
              </p>
            </div>
            <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-emerald-300">
                <Sparkles className="w-4 h-4" />
                <span className="text-lg font-black leading-none">
                  +{totalToday}/{totalReward}
                </span>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Today
              </p>
            </div>
            <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-primary">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-black leading-none tabular-nums">
                  {fmtCountdown(countdown)}
                </span>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Resets in
              </p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">How it works</h2>
          </div>
          <ul className="space-y-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
            <li>• Complete any task below to fill its progress bar.</li>
            <li>• When a task is ready, its card turns golden and shows a <b className="text-amber-300">Claim</b> button.</li>
            <li>
              • Redeem coins on the{" "}
              <button
                type="button"
                onClick={() => navigate("/premium-buy")}
                className="text-amber-300 hover:underline"
              >
                Premium
              </button>{" "}
              page to unlock premium days.
            </li>
            <li>• Daily tasks reset every 24 hours at UTC midnight.</li>
          </ul>
        </div>


        {/* Empty state (no built-in and no custom) */}
        {resolvedTasks.length === 0 && customTasks.filter((t) => t.active).length === 0 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <Sparkles className="w-8 h-8 mx-auto text-amber-300 mb-2" />
            <h3 className="text-sm font-bold">No tasks available right now</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              New tasks are added regularly — check back soon.
            </p>
          </div>
        )}

        {/* Task cards */}
        <div className="mt-5 space-y-3">

          {resolvedTasks.map((task) => {
            const Icon = ICONS[task.id] || Zap;
            const progress = getTaskProgress(task, state);
            const ready = isTaskReady(task, state);
            const claimed = isTaskClaimed(task, state);
            const pct = Math.min(100, Math.round((progress / task.goal) * 100));
            const isBusy = busy === task.id;

            const goalText =
              task.unit === "minutes" ? `${progress} / ${task.goal} min` :
              task.unit === "referrals" ? `${progress} / ${task.goal} invite` :
              task.unit === "comments" ? `${progress} / ${task.goal} comment` :
              claimed ? "Completed" : ready ? "Ready" : "Not yet";

            return (
              <div
                key={task.id}
                className={[
                  "rounded-2xl border p-4 transition-colors",
                  claimed
                    ? "border-emerald-400/30 bg-emerald-500/[0.06]"
                    : ready
                      ? "border-amber-400/40 bg-gradient-to-br from-amber-500/[0.12] to-yellow-500/[0.04]"
                      : "border-white/10 bg-white/[0.02]",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={[
                      "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",
                      claimed
                        ? "bg-emerald-500/15 text-emerald-300"
                        : ready
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/5 text-muted-foreground",
                    ].join(" ")}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold leading-tight">{task.title}</h3>
                      <span
                        className={[
                          "text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1",
                          claimed
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500/15 text-amber-300",
                        ].join(" ")}
                      >
                        <Coins className="w-3 h-3" /> +{task.reward}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {task.description}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground/80 italic">
                      {task.example}
                    </p>

                    {/* Progress */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10.5px] mb-1">
                        <span className="text-muted-foreground">Progress</span>
                        <span
                          className={
                            claimed ? "text-emerald-300" : ready ? "text-amber-300" : "text-muted-foreground"
                          }
                        >
                          {goalText}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={[
                            "h-full rounded-full transition-all",
                            claimed ? "bg-emerald-400" : ready ? "bg-amber-400" : "bg-primary/60",
                          ].join(" ")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-3 flex gap-2">
                      {task.id === "share" && !claimed && (
                        <button
                          type="button"
                          onClick={handleShareClick}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 inline-flex items-center gap-1.5"
                        >
                          <Share2 className="w-3.5 h-3.5" /> Share link
                        </button>
                      )}

                      {claimed ? (
                        <div className="text-[12px] font-semibold text-emerald-300 inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> Claimed today
                        </div>
                      ) : ready ? (
                        <button
                          type="button"
                          onClick={() => handleClaim(task)}
                          disabled={isBusy}
                          className="ml-auto text-[12px] font-black px-4 py-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-500 text-black shadow-lg shadow-amber-500/20 active:scale-[0.97] transition-transform disabled:opacity-60"
                        >
                          {isBusy ? "Claiming…" : `Claim +${task.reward}`}
                        </button>
                      ) : (
                        <div className="ml-auto text-[11px] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5" /> Keep going
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ==================== ADMIN-DEFINED BONUS TASKS ==================== */}
        {customTasks.filter((t) => t.active).length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3 px-1">
              <Sparkles className="w-4 h-4 text-fuchsia-300" />
              <h2 className="text-sm font-bold">Bonus Tasks & Promotions</h2>
            </div>
            <div className="space-y-3">
              {customTasks.filter((t) => t.active).map((t) => {
                const claim = customClaims[t.id];
                const check = canClaimCustomTask(t, claim);
                const claimed = t.dailyReset
                  ? claim?.claimedDay === new Date().toISOString().slice(0, 10)
                  : !!claim?.claimedAt;
                const isBusy = busy === `custom:${t.id}`;
                const needsVisit = (t.minSeconds || 0) > 0 && !claim?.visitedAt;
                const waiting = check.reason?.startsWith("Wait ");

                const openLink = async () => {
                  openPopunderIfConfigured();
                  await markCustomTaskVisited(t.id);
                  if (t.url) window.open(t.url, "_blank", "noopener,noreferrer");
                };

                const doClaim = async () => {
                  if (isBusy) return;
                  openPopunderIfConfigured();
                  setBusy(`custom:${t.id}`);
                  const r = await claimCustomTask(t);
                  setBusy(null);
                  if (!r.ok) { toast.warning((r as { reason: string }).reason); return; }
                  toast.success(`+${r.coins} coin${r.coins > 1 ? "s" : ""}! Balance: ${r.total}`);
                };

                return (
                  <div key={t.id} className={[
                    "rounded-2xl border p-4 transition-colors",
                    claimed
                      ? "border-emerald-400/30 bg-emerald-500/[0.06]"
                      : check.ok
                        ? "border-amber-400/40 bg-gradient-to-br from-amber-500/[0.12] to-yellow-500/[0.04]"
                        : "border-fuchsia-400/20 bg-fuchsia-500/[0.04]",
                  ].join(" ")}>
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-fuchsia-500/15 text-fuchsia-300 flex items-center justify-center flex-shrink-0 text-xl">
                        {t.icon || "🎯"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold leading-tight">{t.title}</h3>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 flex-shrink-0 inline-flex items-center gap-1">
                            <Coins className="w-3 h-3" /> +{t.reward}
                          </span>
                        </div>
                        {t.description && (
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{t.description}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {t.url && !claimed && (
                            <button onClick={openLink}
                              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/10 inline-flex items-center gap-1.5">
                              <ExternalLink className="w-3.5 h-3.5" />
                              {needsVisit ? "Open link" : "Open again"}
                            </button>
                          )}
                          {claimed ? (
                            <div className="text-[12px] font-semibold text-emerald-300 inline-flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" /> Claimed
                            </div>
                          ) : check.ok ? (
                            <button onClick={doClaim} disabled={isBusy}
                              className="ml-auto text-[12px] font-black px-4 py-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-500 text-black shadow-lg shadow-amber-500/20 active:scale-[0.97] disabled:opacity-60">
                              {isBusy ? "Claiming…" : `Claim +${t.reward}`}
                            </button>
                          ) : (
                            <div className="ml-auto text-[11px] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                              {waiting ? <><Clock className="w-3.5 h-3.5" /> {check.reason}</> : <><Lock className="w-3.5 h-3.5" /> {check.reason || "Not ready"}</>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        {/* Invite Friends — hero reward section */}
        <div className="mt-6">
          <InviteFriendCard variant="full" siteName={branding.siteName || "our platform"} />
        </div>

        {/* Redeem CTA */}
        <div className="mt-6 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Gift className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold">Ready to redeem?</h3>
              <p className="text-[11.5px] text-muted-foreground">
                Spend your coins for Premium access — see current plans on the redeem page.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/premium-buy")}
              className="text-[12px] font-bold px-3.5 py-2 rounded-lg bg-primary text-primary-foreground active:scale-[0.97]"
            >
              Redeem
            </button>
          </div>
        </div>


        {/* Progress summary */}
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          {claimedCount}/{resolvedTasks.length} tasks claimed today • Fresh set unlocks in{" "}
          <span className="tabular-nums text-foreground/80">{fmtCountdown(countdown)}</span>
        </p>

        {/* Visit-time hint (subtle) */}
        <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
          Watch-time counted: {Math.floor(getVisitSecondsToday() / 60)} min today • Keep the tab open.
        </p>
      </div>
    </div>
  );
}
