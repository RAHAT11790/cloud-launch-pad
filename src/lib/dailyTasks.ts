// Daily Tasks — permanent 5-task coin economy
// Rewards & rules are HARD-CODED here on purpose (no admin config needed).
import { db, ref, get, set, onValue, runTransaction, update } from "@/lib/firebase";
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

/* ================== Admin-editable reward overrides ==================
   Path: settings/dailyTaskOverrides/{taskId} = { reward?, title?, disabled? }
   Lets admin change built-in task reward / title / visibility without redeploy.
*/
const OVERRIDES_PATH = "settings/dailyTaskOverrides";
export type DailyTaskOverride = { reward?: number; title?: string; disabled?: boolean };
export type DailyTaskOverrides = Partial<Record<TaskId, DailyTaskOverride>>;

export const subscribeDailyTaskOverrides = (
  cb: (o: DailyTaskOverrides) => void,
): (() => void) => {
  return onValue(ref(db, OVERRIDES_PATH), (snap) => {
    cb((snap.val() as DailyTaskOverrides) || {});
  });
};

export const setDailyTaskReward = async (id: TaskId, reward: number) => {
  await update(ref(db, `${OVERRIDES_PATH}/${id}`), { reward: Math.max(0, Number(reward) || 0) });
};

export const setDailyTaskTitle = async (id: TaskId, title: string) => {
  await update(ref(db, `${OVERRIDES_PATH}/${id}`), { title: String(title || "").trim() });
};

export const setDailyTaskEnabled = async (id: TaskId, enabled: boolean) => {
  await update(ref(db, `${OVERRIDES_PATH}/${id}`), { disabled: !enabled });
};

/** Resolve built-in tasks with overrides applied. Disabled tasks are excluded. */
export const resolveDailyTasks = (overrides: DailyTaskOverrides): TaskDef[] =>
  DAILY_TASKS
    .filter((t) => !overrides[t.id]?.disabled)
    .map((t) => {
      const o = overrides[t.id] || {};
      return {
        ...t,
        reward: typeof o.reward === "number" ? o.reward : t.reward,
        title: o.title && o.title.length ? o.title : t.title,
      };
    });

const fetchOverrideReward = async (id: TaskId): Promise<number | null> => {
  try {
    const snap = await get(ref(db, `${OVERRIDES_PATH}/${id}/reward`));
    const v = snap.val();
    return typeof v === "number" ? v : null;
  } catch { return null; }
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

/* ================== Referral system (IP-tracked, anti-fraud) ==================
   Rules:
   - Visitor arriving via ?ref=UID → referrer gets +1 coin instantly (entry bonus).
   - If the same visitor stays 30+ minutes on the site (measured by visit tracker),
     referrer earns an additional +9 coins (total 10 per real invite).
   - IP-based dedupe: same public IP against the same referrer counts only once.
     Multiple accounts/devices on the same Wi-Fi = still 1 credit only.
   - Self-referrals blocked. Localstorage guard prevents same-browser replays.
*/

const REFERRED_BY_KEY = "rs_referred_by";
const REFERRAL_UPGRADED_KEY = "rs_referral_upgraded";
const REFERRAL_ENTRY_AWARDED_KEY = "rs_referral_entry_awarded";

const fetchPublicIp = async (): Promise<string | null> => {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch("https://api.ipify.org?format=json", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.ip === "string" ? j.ip : null;
  } catch { return null; }
};

const hashIp = (ip: string): string => {
  // Small stable hash — used only as a firebase key, not for security.
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) + h + ip.charCodeAt(i)) | 0;
  return "ip_" + (h >>> 0).toString(36);
};

const awardCoins = async (uid: string, amount: number, note: string) => {
  if (!uid || amount <= 0) return;
  await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
    const wallet = cur || { coins: 0, adWatchLog: {} };
    return { ...wallet, coins: (wallet.coins || 0) + amount };
  });
  try {
    await set(ref(db, `users/${uid}/referralEarnings/${Date.now()}`), { amount, note });
  } catch {}
};

/** Capture ?ref=UID once per visitor. Awards +1 coin now, IP-dedupe enforced. */
export const captureReferralFromUrl = () => {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const url = new URL(window.location.href);
      const refUid = url.searchParams.get("ref");
      if (!refUid) return;

      const me = getLocalUserId() || ensureGuestUser();
      if (!me || me === refUid) return;

      // Persist referrer for future 30-min upgrade check.
      try {
        if (!localStorage.getItem(REFERRED_BY_KEY)) {
          localStorage.setItem(REFERRED_BY_KEY, refUid);
        }
      } catch {}

      // Already entry-awarded on this browser?
      if (localStorage.getItem(REFERRAL_ENTRY_AWARDED_KEY) === refUid) return;

      const ip = await fetchPublicIp();
      const ipKey = ip ? hashIp(ip) : `noip_${me}`;

      // IP-dedupe: if this IP already credited this referrer with a DIFFERENT visitor, block.
      const ipRef = ref(db, `referrals/${refUid}/ipMap/${ipKey}`);
      const snap = await get(ipRef);
      const owner = snap.val();
      if (owner && owner !== me) {
        // Same network already claimed by another visitor — fraud guard.
        localStorage.setItem(REFERRAL_ENTRY_AWARDED_KEY, refUid); // don't retry
        return;
      }
      if (!owner) await set(ipRef, me);

      // Record visitor + award +1 entry coin.
      await set(ref(db, `referrals/${refUid}/visitors/${me}`), {
        ip: ipKey,
        startedAt: Date.now(),
        upgraded: false,
      });
      // Also feed the daily "share" task progress (visible progress bar).
      await runTransaction(ref(db, `users/${refUid}/dailyTasks/${todayKey()}/share`), (cur: any) => {
        const c = cur || {};
        return { ...c, progress: (c.progress || 0) + 1 };
      });
      await awardCoins(refUid, 1, "referral_entry");
      localStorage.setItem(REFERRAL_ENTRY_AWARDED_KEY, refUid);
    } catch {}
  })();
};

/** Called periodically; when visitor has 30+ min today, credits referrer +9. */
export const checkReferralUpgrade = async () => {
  if (typeof window === "undefined") return;
  try {
    const refUid = localStorage.getItem(REFERRED_BY_KEY);
    if (!refUid) return;
    if (localStorage.getItem(REFERRAL_UPGRADED_KEY) === refUid) return;
    const minutes = Math.floor(getVisitSecondsToday() / 60);
    if (minutes < 30) return;
    const me = getLocalUserId() || ensureGuestUser();
    if (!me) return;
    // Server-side guard so double-upgrade can't happen from two devices.
    const vRef = ref(db, `referrals/${refUid}/visitors/${me}`);
    let didUpgrade = false;
    await runTransaction(vRef, (cur: any) => {
      const c = cur || { startedAt: Date.now() };
      if (c.upgraded) return c;
      didUpgrade = true;
      return { ...c, upgraded: true, upgradedAt: Date.now() };
    });
    if (didUpgrade) await awardCoins(refUid, 9, "referral_30min");
    localStorage.setItem(REFERRAL_UPGRADED_KEY, refUid);
  } catch {}
};

/** Kept for backward compatibility; new callers should use captureReferralFromUrl. */
export const recordShareReferral = async (refUid: string) => {
  if (!refUid) return;
  await runTransaction(ref(db, `users/${refUid}/dailyTasks/${todayKey()}/share`), (cur: any) => {
    const c = cur || {};
    return { ...c, progress: (c.progress || 0) + 1 };
  });
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

  const baseTask = DAILY_TASKS.find((t) => t.id === taskId);
  if (!baseTask) return { ok: false, reason: "unknown" };

  // Respect admin's disable flag.
  try {
    const dSnap = await get(ref(db, `${OVERRIDES_PATH}/${taskId}/disabled`));
    if (dSnap.val() === true) return { ok: false, reason: "unknown" };
  } catch {}

  const override = await fetchOverrideReward(taskId);
  const task: TaskDef = override !== null ? { ...baseTask, reward: override } : baseTask;


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
