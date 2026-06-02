/**
 * Guest session helpers.
 *
 * Behavior contract:
 *  - Every visitor automatically gets a "guest" user identity stored in
 *    localStorage["rsanime_user"] with the SAME shared id+email for everyone.
 *  - Real signup/login replaces this guest user with a real user (id + email
 *    + isGuest flag absent / false). On logout we drop back to guest.
 *  - Guests are never written to Firebase: their watch history / watchlist
 *    live entirely in localStorage. Logged-in users use Firebase as before.
 *  - Reset rules (run on each boot):
 *      • watch history → keep last 10 if older than 7 days
 *      • watchlist (favorites) → keep last 100 if older than 30 days
 *    Applied to whichever store the current user uses (local for guest,
 *    Firebase for logged-in).
 */

import { db, ref, get, set, remove } from "@/lib/firebase";

export const GUEST_ID = "guest";
export const GUEST_EMAIL = "ICFanimeguest@gmail.com";
export const GUEST_NAME = "Guest";

const USER_KEY = "rsanime_user";

// localStorage keys for guest data
export const LS_GUEST_HISTORY = "rs_guest_watch_history";
export const LS_GUEST_WATCHLIST = "rs_guest_watchlist";

const LS_HISTORY_LAST_RESET = "rs_history_last_reset";
const LS_FAV_LAST_RESET = "rs_fav_last_reset";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_KEEP = 10;
const FAV_KEEP = 100;

export interface StoredUser {
  id: string;
  email: string;
  name?: string;
  isGuest?: boolean;
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.email) return null;
    return parsed as StoredUser;
  } catch {
    return null;
  }
}

export function isGuestUser(u?: StoredUser | null): boolean {
  const user = u === undefined ? getStoredUser() : u;
  if (!user) return true;
  return !!user.isGuest || user.id === GUEST_ID || user.email === GUEST_EMAIL;
}

/** Ensures a guest record exists in localStorage if no real user is logged in. */
export function ensureGuestUser(): StoredUser {
  const existing = getStoredUser();
  if (existing && !isGuestUser(existing)) return existing;
  if (existing && existing.id === GUEST_ID) return existing;

  const guest: StoredUser = {
    id: GUEST_ID,
    email: GUEST_EMAIL,
    name: GUEST_NAME,
    isGuest: true,
  };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
  } catch {}
  return guest;
}

/* ------------------------------------------------------------------ */
/* Local guest store helpers                                          */
/* ------------------------------------------------------------------ */

function readLocalMap(key: string): Record<string, any> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeLocalMap(key: string, data: Record<string, any>) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

export function getGuestWatchHistory(): any[] {
  const data = readLocalMap(LS_GUEST_HISTORY);
  const items = Object.values(data) as any[];
  items.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
  return items;
}
export function setGuestHistoryItem(id: string, item: any) {
  const data = readLocalMap(LS_GUEST_HISTORY);
  data[id] = { ...(data[id] || {}), ...item };
  writeLocalMap(LS_GUEST_HISTORY, data);
}
export function updateGuestHistoryItem(id: string, partial: any) {
  const data = readLocalMap(LS_GUEST_HISTORY);
  if (!data[id]) data[id] = { id };
  data[id] = { ...data[id], ...partial };
  writeLocalMap(LS_GUEST_HISTORY, data);
}

export function getGuestWatchlist(): any[] {
  const data = readLocalMap(LS_GUEST_WATCHLIST);
  const items = Object.values(data) as any[];
  items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return items;
}
export function setGuestWatchlistItem(id: string, item: any) {
  const data = readLocalMap(LS_GUEST_WATCHLIST);
  data[id] = item;
  writeLocalMap(LS_GUEST_WATCHLIST, data);
}
export function removeGuestWatchlistItem(id: string) {
  const data = readLocalMap(LS_GUEST_WATCHLIST);
  delete data[id];
  writeLocalMap(LS_GUEST_WATCHLIST, data);
}
export function hasGuestWatchlistItem(id: string): boolean {
  const data = readLocalMap(LS_GUEST_WATCHLIST);
  return !!data[id];
}

/* ------------------------------------------------------------------ */
/* Subscriptions (replacement for Firebase onValue when guest)        */
/* ------------------------------------------------------------------ */

const STORAGE_PING_EVENT = "rs_guest_store_change";

function emitGuestChange(scope: "history" | "watchlist") {
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_PING_EVENT, { detail: scope }));
  } catch {}
}

// Wrap mutators to emit change events
const _origSetHist = setGuestHistoryItem;
const _origUpdHist = updateGuestHistoryItem;
const _origAddWl = setGuestWatchlistItem;
const _origRmWl = removeGuestWatchlistItem;
export function setGuestHistoryItemNotify(id: string, item: any) {
  _origSetHist(id, item);
  emitGuestChange("history");
}
export function updateGuestHistoryItemNotify(id: string, item: any) {
  _origUpdHist(id, item);
  emitGuestChange("history");
}
export function setGuestWatchlistItemNotify(id: string, item: any) {
  _origAddWl(id, item);
  emitGuestChange("watchlist");
}
export function removeGuestWatchlistItemNotify(id: string) {
  _origRmWl(id);
  emitGuestChange("watchlist");
}

export function subscribeGuestHistory(cb: (items: any[]) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail === "history") cb(getGuestWatchHistory());
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === LS_GUEST_HISTORY) cb(getGuestWatchHistory());
  };
  window.addEventListener(STORAGE_PING_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  cb(getGuestWatchHistory());
  return () => {
    window.removeEventListener(STORAGE_PING_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}
export function subscribeGuestWatchlist(cb: (items: any[]) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail === "watchlist") cb(getGuestWatchlist());
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === LS_GUEST_WATCHLIST) cb(getGuestWatchlist());
  };
  window.addEventListener(STORAGE_PING_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  cb(getGuestWatchlist());
  return () => {
    window.removeEventListener(STORAGE_PING_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

/* ------------------------------------------------------------------ */
/* Reset / trim rules                                                 */
/* ------------------------------------------------------------------ */

function trimMapKeepLatest(
  data: Record<string, any>,
  keep: number,
  tsKey: "watchedAt" | "addedAt"
): Record<string, any> {
  const entries = Object.entries(data);
  if (entries.length <= keep) return data;
  entries.sort((a, b) => ((b[1] as any)?.[tsKey] || 0) - ((a[1] as any)?.[tsKey] || 0));
  const kept: Record<string, any> = {};
  entries.slice(0, keep).forEach(([k, v]) => (kept[k] = v));
  return kept;
}

function trimGuestHistory() {
  const data = readLocalMap(LS_GUEST_HISTORY);
  const trimmed = trimMapKeepLatest(data, HISTORY_KEEP, "watchedAt");
  writeLocalMap(LS_GUEST_HISTORY, trimmed);
  emitGuestChange("history");
}
function trimGuestWatchlist() {
  const data = readLocalMap(LS_GUEST_WATCHLIST);
  const trimmed = trimMapKeepLatest(data, FAV_KEEP, "addedAt");
  writeLocalMap(LS_GUEST_WATCHLIST, trimmed);
  emitGuestChange("watchlist");
}

async function trimFirebaseHistory(userId: string) {
  try {
    // Per-device path matches existing schema users/{uid}/watchHistory/{deviceId}/{itemId}
    const snap = await get(ref(db, `users/${userId}/watchHistory`));
    const byDevice = snap.val() || {};
    for (const [deviceId, items] of Object.entries<any>(byDevice)) {
      if (!items || typeof items !== "object") continue;
      const trimmed = trimMapKeepLatest(items, HISTORY_KEEP, "watchedAt");
      const removedKeys = Object.keys(items).filter((k) => !(k in trimmed));
      await Promise.all(
        removedKeys.map((k) =>
          remove(ref(db, `users/${userId}/watchHistory/${deviceId}/${k}`)).catch(() => {})
        )
      );
    }
  } catch {}
}
async function trimFirebaseWatchlist(userId: string) {
  try {
    const snap = await get(ref(db, `users/${userId}/watchlist`));
    const items = snap.val() || {};
    const trimmed = trimMapKeepLatest(items, FAV_KEEP, "addedAt");
    const removedKeys = Object.keys(items).filter((k) => !(k in trimmed));
    await Promise.all(
      removedKeys.map((k) =>
        remove(ref(db, `users/${userId}/watchlist/${k}`)).catch(() => {})
      )
    );
  } catch {}
}

/**
 * Run reset rules. Safe to call on every boot — uses last-reset timestamps.
 * - History: trim weekly to last 10
 * - Watchlist: trim monthly to last 100
 */
export async function runResetRulesIfDue() {
  const now = Date.now();
  const lastHist = Number(localStorage.getItem(LS_HISTORY_LAST_RESET) || 0);
  const lastFav = Number(localStorage.getItem(LS_FAV_LAST_RESET) || 0);
  const user = getStoredUser();
  const guest = isGuestUser(user);

  if (now - lastHist >= WEEK_MS) {
    if (guest) trimGuestHistory();
    else if (user) await trimFirebaseHistory(user.id);
    try { localStorage.setItem(LS_HISTORY_LAST_RESET, String(now)); } catch {}
  }
  if (now - lastFav >= MONTH_MS) {
    if (guest) trimGuestWatchlist();
    else if (user) await trimFirebaseWatchlist(user.id);
    try { localStorage.setItem(LS_FAV_LAST_RESET, String(now)); } catch {}
  }
}
