// Admin-controlled dynamic tasks. Live in Firebase under `settings/customTasks`.
// Per-user claim state lives under `users/{uid}/customTaskClaims/{taskId}`.
import { db, ref, get, set, remove, onValue, push, runTransaction, update } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";
import { ensureGuestUser } from "@/lib/premiumAccess";
import { todayKey } from "@/lib/dailyTasks";

export type CustomTaskKind = "link_visit" | "telegram_join" | "promotion" | "custom";

export interface CustomTask {
  id: string;
  kind: CustomTaskKind;
  title: string;
  description: string;
  url?: string;          // where to send the user (link visit / telegram / promo)
  reward: number;        // coins per claim
  icon?: string;         // emoji or lucide name (rendered as emoji fallback)
  color?: string;        // accent color (hex, optional)
  active: boolean;
  order: number;         // sort order
  dailyReset: boolean;   // true = claimable every day; false = one-time
  minSeconds?: number;   // must wait this long after visit before claim (0 = instant)
  createdAt: number;
  updatedAt: number;
}

const TASKS_PATH = "settings/customTasks";
const claimPath = (uid: string, taskId: string) => `users/${uid}/customTaskClaims/${taskId}`;

/* -------- Admin CRUD -------- */

export const listCustomTasks = async (): Promise<CustomTask[]> => {
  const snap = await get(ref(db, TASKS_PATH));
  const data = snap.val() || {};
  return Object.entries(data)
    .map(([id, item]: [string, any]) => ({ id, ...item }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

export const subscribeCustomTasks = (cb: (tasks: CustomTask[]) => void): (() => void) => {
  return onValue(ref(db, TASKS_PATH), (snap) => {
    const data = snap.val() || {};
    const tasks: CustomTask[] = Object.entries(data)
      .map(([id, item]: [string, any]) => ({ id, ...item }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    cb(tasks);
  });
};

export const saveCustomTask = async (task: Omit<CustomTask, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> => {
  const now = Date.now();
  if (task.id) {
    await update(ref(db, `${TASKS_PATH}/${task.id}`), { ...task, updatedAt: now });
    return task.id;
  }
  const key = push(ref(db, TASKS_PATH)).key!;
  await set(ref(db, `${TASKS_PATH}/${key}`), {
    ...task,
    createdAt: now,
    updatedAt: now,
  });
  return key;
};

export const deleteCustomTask = async (id: string) => {
  await remove(ref(db, `${TASKS_PATH}/${id}`));
};

/* -------- User-side claim state -------- */

export interface CustomTaskClaim {
  claimedAt?: number;
  claimedDay?: string;         // e.g. "2026-07-03" for daily-reset
  visitedAt?: number;          // last click through timestamp
  totalClaimed?: number;       // lifetime claim count
}

export const subscribeMyCustomClaims = (cb: (map: Record<string, CustomTaskClaim>) => void): (() => void) => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) { cb({}); return () => {}; }
  return onValue(ref(db, `users/${uid}/customTaskClaims`), (snap) => {
    cb((snap.val() as Record<string, CustomTaskClaim>) || {});
  });
};

/** Marks the moment the user opened the task URL. Required before claim. */
export const markCustomTaskVisited = async (taskId: string) => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return;
  await update(ref(db, claimPath(uid, taskId)), { visitedAt: Date.now() });
};

export const canClaimCustomTask = (task: CustomTask, claim: CustomTaskClaim | undefined): { ok: boolean; reason?: string } => {
  if (!task.active) return { ok: false, reason: "Task not active" };
  const min = task.minSeconds || 0;
  if (min > 0) {
    if (!claim?.visitedAt) return { ok: false, reason: "Open the link first" };
    if (Date.now() - claim.visitedAt < min * 1000) return { ok: false, reason: `Wait ${min}s after opening` };
  }
  if (task.dailyReset) {
    if (claim?.claimedDay === todayKey()) return { ok: false, reason: "Already claimed today" };
  } else {
    if (claim?.claimedAt) return { ok: false, reason: "Already claimed" };
  }
  return { ok: true };
};

export type CustomClaimResult =
  | { ok: true; coins: number; total: number }
  | { ok: false; reason: string };

export const claimCustomTask = async (task: CustomTask): Promise<CustomClaimResult> => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return { ok: false, reason: "no_user" };

  const snap = await get(ref(db, claimPath(uid, task.id)));
  const claim = (snap.val() as CustomTaskClaim) || {};
  const chk = canClaimCustomTask(task, claim);
  if (!chk.ok) return { ok: false, reason: chk.reason || "not_ready" };

  let total = 0;
  await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
    const wallet = cur || { coins: 0, adWatchLog: {} };
    const next = { ...wallet, coins: (wallet.coins || 0) + task.reward };
    total = next.coins;
    return next;
  });

  await update(ref(db, claimPath(uid, task.id)), {
    ...claim,
    claimedAt: Date.now(),
    claimedDay: todayKey(),
    totalClaimed: (claim.totalClaimed || 0) + 1,
  });

  return { ok: true, coins: task.reward, total };
};
