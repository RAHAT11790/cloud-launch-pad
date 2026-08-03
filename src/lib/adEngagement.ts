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

export function logAdEvent(kind: string, result: string) {
  try {
    const path = `analytics/ads/${todayKey()}/${kind}/${result}`;
    void runTransaction(ref(db, path), (v) => (Number(v) || 0) + 1);
  } catch {}
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fire a pop-under inside the current user gesture and measure engagement.
 * Resolves once we know whether the ad realistically counted.
 */
export async function runAdGate(opts: AdGateOptions = {}): Promise<AdGateResult> {
  const minSeconds = Math.max(3, Math.min(15, opts.minSeconds ?? 5));
  const reason = opts.reason || "continue";

  if (opts.isPremium) return "premium";

  let cfg: Awaited<ReturnType<typeof getAdsterraConfig>> | null = null;
  try { cfg = await getAdsterraConfig(); } catch {}
  if (!cfg?.enabled || !String(cfg.popunder || "").trim()) return "disabled";

  const startedAt = Date.now();
  let awayAt = 0;
  let awayMs = 0;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (!awayAt) awayAt = Date.now();
    } else if (awayAt) {
      awayMs += Date.now() - awayAt;
      awayAt = 0;
    }
  };
  const onBlur = () => { if (!awayAt) awayAt = Date.now(); };
  const onFocus = () => { if (awayAt) { awayMs += Date.now() - awayAt; awayAt = 0; } };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  // Must run inside the gesture — no awaits before this line beyond config.
  void firePopunderAd();

  const toastId = toast.loading(`Loading sponsor · please wait ${minSeconds}s`, {
    description: "Keep the sponsor tab open for a few seconds so it counts.",
    duration: (minSeconds + 2) * 1000,
  });

  // Give the pop-under a moment to actually take over the tab.
  await wait(1600);
  const opened = awayAt > 0 || awayMs > 0;

  if (!opened) {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    toast.dismiss(toastId);
    logAdEvent(reason, "not-loaded");
    return "not-loaded";
  }

  // Wait until the dwell budget is met (or the user has been back for a while).
  const deadline = startedAt + (minSeconds + 6) * 1000;
  while (Date.now() < deadline) {
    const away = awayMs + (awayAt ? Date.now() - awayAt : 0);
    if (away >= minSeconds * 1000) break;
    if (!awayAt && Date.now() - startedAt > 3500) break; // user already returned
    await wait(250);
  }

  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("focus", onFocus);
  toast.dismiss(toastId);

  const totalAway = awayMs + (awayAt ? Date.now() - awayAt : 0);
  if (totalAway >= minSeconds * 1000) {
    logAdEvent(reason, "counted");
    return "counted";
  }
  logAdEvent(reason, "too-fast");
  return "too-fast";
}

/** Friendly, on-brand messaging for each gate outcome. */
export function explainAdGate(result: AdGateResult, minSeconds = 5) {
  switch (result) {
    case "counted":
      toast.success("Thanks for supporting us", {
        description: "Sponsor verified — enjoy, it stays free because of you.",
      });
      return;
    case "too-fast":
      toast.warning("That was too quick", {
        description: `You came back before ${minSeconds}s, so the sponsor didn't count. Try once more and wait a moment — then it unlocks.`,
      });
      return;
    case "not-loaded":
      toast.error("Sponsor could not load", {
        description: "An ad blocker / VPN DNS is blocking it. Pause it for this site to keep downloads and HD unlocked.",
      });
      return;
    default:
      return;
  }
}
