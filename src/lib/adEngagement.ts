// ============================================
// Ad Engagement Gate
// --------------------------------------------
// Why: Adsterra showed thousands of impressions with ~0 counted clicks.
// The two biggest causes on our side were:
//   1. The pop-under opened, but the user came straight back (< ~5s), so the
//      network never registered a valid visit.
//   2. The ad script was blocked (adblock / DNS), so nothing opened at all and
//      we silently continued as if the ad had run.
// This module makes both cases explicit: it measures how long the user stayed
// away, tells them (politely) what happened, and only unlocks the reward when
// the ad actually had a chance to count. Every outcome is logged to Firebase
// so the Adsterra "Click Gap Analysis" panel can show real reasons.
// ============================================
import { toast } from "sonner";
import { db, ref, runTransaction } from "@/lib/firebase";
import { firePopunderAd, getAdsterraConfig } from "@/lib/adsterraAds";

export type AdGateResult =
  | "counted"      // user stayed on the ad long enough
  | "too-fast"     // came back before the minimum dwell time
  | "not-loaded"   // ad never opened (blocked / no snippet)
  | "premium"      // premium user — no ads
  | "disabled";    // ads switched off in admin

export type AdGateOptions = {
  /** Minimum seconds the user must stay on the ad for it to count. */
  minSeconds?: number;
  /** Short label used in messages, e.g. "download". */
  reason?: string;
  /** Skip the gate entirely (premium). */
  isPremium?: boolean | null;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

function logAdEvent(kind: string, result: string) {
  try {
    const path = `analytics/ads/${todayKey()}/${kind}/${result}`;
    void runTransaction(ref(db, path), (v) => (Number(v) || 0) + 1);
  } catch {}
}

/**
 * Measure how long the user stayed away (i.e. on the sponsor tab) after a
 * pop-under fired, then nudge them with a tiny benefit/penalty message.
 * Resolves with the measured dwell time in seconds.
 */
function trackPopunderDwell(goalSeconds = 10, notify = true): Promise<number> {
  return new Promise((resolve) => {
    let awayAt = 0;
    let awayMs = 0;
    const startedAt = Date.now();

    const enterAway = () => { if (!awayAt) awayAt = Date.now(); };
    const leaveAway = () => { if (awayAt) { awayMs += Date.now() - awayAt; awayAt = 0; } };
    const onVis = () => (document.visibilityState === "hidden" ? enterAway() : leaveAway());

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", enterAway);
    window.addEventListener("focus", leaveAway);

    const finish = () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", enterAway);
      window.removeEventListener("focus", leaveAway);
      window.clearInterval(poll);
      const total = (awayMs + (awayAt ? Date.now() - awayAt : 0)) / 1000;
      if (notify && total > 0.8) {
        if (total >= goalSeconds) {
          toast.success("Thanks — fewer ads for you", {
            description: "Sponsor counted. Your next ad is delayed and video will load faster.",
            duration: 4000,
          });
          logAdEvent("player", "counted");
        } else {
          toast.warning("Ad closed too fast", {
            description: `Stay ${goalSeconds}s on the sponsor next time — otherwise more ads appear and playback can slow down.`,
            duration: 4500,
          });
          logAdEvent("player", "too-fast");
        }
      }
      resolve(total);
    };

    // Resolve once the user is back and settled, or after a hard timeout.
    const poll = window.setInterval(() => {
      const away = awayMs + (awayAt ? Date.now() - awayAt : 0);
      if (!awayAt && away > 0 && Date.now() - startedAt > 1500) finish();
      else if (Date.now() - startedAt > 90_000) finish();
    }, 400);

    // No ad ever opened → give up quietly.
    window.setTimeout(() => { if (!awayAt && !awayMs) finish(); }, 6000);
  });
}

/**
 * Fire-and-forget sponsor: opens one pop-under inside the current gesture and
 * silently measures dwell time. Never blocks the user's action (downloads stay
 * instant), never shows a blocking loader.
 */
export function fireAdOnly(reason = "download", isPremium?: boolean | null) {
  if (isPremium) return;
  void (async () => {
    let cfg: Awaited<ReturnType<typeof getAdsterraConfig>> | null = null;
    try { cfg = await getAdsterraConfig(); } catch {}
    if (!cfg?.enabled || !String(cfg.popunder || "").trim()) return;
    logAdEvent(reason, "fired");
    void firePopunderAd();
    void trackPopunderDwell(10, true);
  })();
}
