// Daily Tasks — permanent 5-task coin economy
// Rewards & rules are HARD-CODED here on purpose (no admin config needed).
import { db, ref, get, set, onValue, runTransaction } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";
import { ensureGuestUser } from "@/lib/premiumAccess";

export type TaskId = "login" | "visit30" | "visit120" | "share" | "comment";

export interface TaskDef {
  id: TaskId;
  title: string;
  description: string;
  example: string;
  reward: number;
  goal: number;        // required progress to enable claim
  unit: "flag" | "minutes" | "referrals" | "comments";
}

export const DAILY_TASKS: TaskDef[] = [
  {
    id: "login",
    title: "Daily Login",
    description: "Open the app once a day and press Claim.",
    example: "Example: Open the site today → tap Claim → +1 coin. Comes back tomorrow.",
    reward: 1,
    goal: 1,
    unit: "flag",
  },
  {
    id: "visit30",
    title: "Watch for 30 Minutes",
    description: "Stay active on the site for 30 minutes today.",
    example: "Example: Watch 1 episode of any anime → progress fills → Claim +1 coin.",
    reward: 1,
    goal: 30,
    unit: "minutes",
  },
  {
    id: "visit120",
    title: "Watch for 120 Minutes",
    description: "Stay active on the site for 120 minutes today (bingewatch).",
    example: "Example: Finish 4-5 episodes today → Claim +1 coin.",
    reward: 1,
    goal: 120,
    unit: "minutes",
  },
  {
    id: "share",
    title: "Invite via Share",
    description: "Share any anime with friends. When someone opens your link — you earn.",
    example: "Example: Tap Share → send to WhatsApp → friend opens the link → +2 coins.",
    reward: 2,
    goal: 1,
    unit: "referrals",
  },
  {
    id: "comment",
    title: "Post a Comment",
    description: "Write a genuine comment on any anime video.",
    example: "Example: Open any anime → comment your thoughts → +1 coin.",
    reward: 1,
    goal: 1,
    unit: "comments",
  },
];

export const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

export const msUntilNextReset = () => {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(0, next.getTime() - now.getTime());
};

/* ================== Visit-time tracker (localStorage) ================== */
const visitKey = (day: string) => `rs_visit_secs_${day}`;

export const getVisitSecondsToday = (): number => {
  try {
    return Number(localStorage.getItem(visitKey(todayKey())) || 0);
  } catch {
    return 0;
  }
};

let visitTimerId: number | null = null;
export const startVisitTracker = () => {
  if (typeof window === "undefined") return;
  if (visitTimerId) return;
  const step = 10; // seconds per tick
  visitTimerId = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    try {
      const k = visitKey(todayKey());
      const cur = Number(localStorage.getItem(k) || 0);
      localStorage.setItem(k, String(cur + step));
    } catch {}
  }, step * 1000);
};

/* ================== Firebase state ================== */
export interface TaskState {
  progress?: number;      // for share/comment
  claimed?: boolean;
  claimedAt?: number;
}
export type DailyTaskState = Partial<Record<TaskId, TaskState>>;

export const subscribeDailyTasks = (
  cb: (s: DailyTaskState) => void,
): (() => void) => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) {
    cb({});
    return () => {};
  }
  return onValue(ref(db, `users/${uid}/dailyTasks/${todayKey()}`), (snap) => {
    cb((snap.val() as DailyTaskState) || {});
  });
};

/* ================== Recorders (call from other pages) ================== */
export const markDailyLogin = async () => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return;
  await runTransaction(ref(db, `users/${uid}/dailyTasks/${todayKey()}/login`), (cur: any) => {
    const c = cur || {};
    if (c.progress) return c;
    return { ...c, progress: 1 };
  });
};

export const recordDailyComment = async () => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return;
  await runTransaction(ref(db, `users/${uid}/dailyTasks/${todayKey()}/comment`), (cur: any) => {
    const c = cur || {};
    if ((c.progress || 0) >= 1) return c;
    return { ...c, progress: 1 };
  });
};

export const recordShareReferral = async (refUid: string) => {
  if (!refUid) return;
  await runTransaction(ref(db, `users/${refUid}/dailyTasks/${todayKey()}/share`), (cur: any) => {
    const c = cur || {};
    return { ...c, progress: (c.progress || 0) + 1 };
  });
};

/** Capture ?ref=UID once per visitor per referrer per day (client-side dedupe). */
export const captureReferralFromUrl = () => {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref) return;
    const me = getLocalUserId() || ensureGuestUser();
    if (me && me === ref) return; // no self-referrals
    const key = `rs_ref_seen_${ref}_${todayKey()}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    void recordShareReferral(ref);
  } catch {}
};

/* ================== Progress helpers ================== */
export const getTaskProgress = (task: TaskDef, state: DailyTaskState): number => {
  const s = state[task.id];
  if (task.unit === "minutes") return Math.min(task.goal, Math.floor(getVisitSecondsToday() / 60));
  if (task.unit === "flag") return s?.progress ? 1 : 0;
  return Math.min(task.goal, s?.progress || 0);
};

export const isTaskReady = (task: TaskDef, state: DailyTaskState): boolean => {
  return getTaskProgress(task, state) >= task.goal && !state[task.id]?.claimed;
};

export const isTaskClaimed = (task: TaskDef, state: DailyTaskState): boolean =>
  !!state[task.id]?.claimed;

/* ================== Claim (awards coins) ================== */
export type ClaimResult =
  | { ok: true; coins: number; total: number }
  | { ok: false; reason: "no_user" | "not_ready" | "already_claimed" | "unknown" };

export const claimTask = async (taskId: TaskId): Promise<ClaimResult> => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return { ok: false, reason: "no_user" };

  const task = DAILY_TASKS.find((t) => t.id === taskId);
  if (!task) return { ok: false, reason: "unknown" };

  // Latest server state (avoid double-claim races)
  const snap = await get(ref(db, `users/${uid}/dailyTasks/${todayKey()}`));
  const state: DailyTaskState = snap.val() || {};
  if (state[taskId]?.claimed) return { ok: false, reason: "already_claimed" };
  if (!isTaskReady(task, state)) return { ok: false, reason: "not_ready" };

  let total = 0;
  await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
    const wallet = cur || { coins: 0, adWatchLog: {} };
    const next = { ...wallet, coins: (wallet.coins || 0) + task.reward };
    total = next.coins;
    return next;
  });

  await set(ref(db, `users/${uid}/dailyTasks/${todayKey()}/${taskId}`), {
    ...(state[taskId] || {}),
    claimed: true,
    claimedAt: Date.now(),
  });

  return { ok: true, coins: task.reward, total };
};
