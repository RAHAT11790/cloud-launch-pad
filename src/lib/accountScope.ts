/**
 * Account-scoped helpers.
 *
 * Goal: every per-user piece of state (24h unlock token grant, continue watching,
 * etc) must be tied to a SPECIFIC account/identity, never browser-wide.
 *
 *  - Logged-in real user: identity = user.id (Firebase uid). Same across browsers.
 *  - Guest user: identity = a per-browser random id stored as `rsanime_guest_local_id`.
 *    This means: the same guest account in two different Chrome browsers will
 *    have DIFFERENT guest-local-ids → unlock tokens / continue watching from
 *    Browser A do NOT carry over to Browser B.
 *
 * Storage convention for per-account values:
 *   `<base-key>::<accountId>`
 *
 * Example:  rsanime_ad_access::guest_local_xxxxx
 *           rsanime_ad_access::firebase_uid_yyyyy
 *
 * Helpers also hook the `storage` event so subscribers can react when the
 * active account changes (e.g. user logs out → guest, or logs into a
 * different account in another tab).
 */

const USER_KEY = "rsanime_user";
const GUEST_LOCAL_ID_KEY = "rsanime_guest_local_id";
export const ACCOUNT_CHANGE_EVENT = "rsanime_account_change";

/** Returns a stable random id for THIS browser's guest session. */
export function getGuestLocalId(): string {
  try {
    let id = localStorage.getItem(GUEST_LOCAL_ID_KEY);
    if (!id) {
      id =
        "guest_" +
        Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6);
      localStorage.setItem(GUEST_LOCAL_ID_KEY, id);
    }
    return id;
  } catch {
    // Fallback (private mode etc.) — derive a session-only id.
    return "guest_session_" + Math.random().toString(36).slice(2, 12);
  }
}

/** Returns the parsed `rsanime_user` object or null. */
function readStoredUser(): any | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Returns the current account id used to scope per-user data.
 *  - Real logged-in users → user.id
 *  - Guests (or no record) → per-browser guest-local id
 */
export function getAccountId(): string {
  const u = readStoredUser();
  const isGuest = !u || !!u.isGuest || u.id === "guest";
  if (!isGuest && u?.id) return String(u.id);
  return getGuestLocalId();
}

/** True if the active account is a guest (browser-local). */
export function isGuestAccount(): boolean {
  const u = readStoredUser();
  return !u || !!u.isGuest || u.id === "guest";
}

/** Build a localStorage key namespaced by the current account. */
export function scopedKey(baseKey: string, accountId?: string): string {
  return `${baseKey}::${accountId ?? getAccountId()}`;
}

/* ------------------------------------------------------------------ */
/* Account-change notifier                                             */
/* ------------------------------------------------------------------ */

let lastKnownAccountId: string | null = null;

/** Call after login / logout / signup so subscribers can refresh state. */
export function notifyAccountChanged() {
  try {
    const id = getAccountId();
    lastKnownAccountId = id;
    window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGE_EVENT, { detail: id }));
  } catch {}
}

/**
 * Subscribe to account changes (login/logout/switch). The callback receives
 * the new accountId. Also fires when another tab updates `rsanime_user`.
 * Returns an unsubscribe function.
 */
export function subscribeAccountChange(cb: (accountId: string) => void): () => void {
  const onCustom = (e: Event) => {
    const id = (e as CustomEvent).detail || getAccountId();
    cb(id);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === USER_KEY || e.key === GUEST_LOCAL_ID_KEY) {
      cb(getAccountId());
    }
  };
  window.addEventListener(ACCOUNT_CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  // Prime
  if (lastKnownAccountId === null) lastKnownAccountId = getAccountId();
  return () => {
    window.removeEventListener(ACCOUNT_CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

/* ------------------------------------------------------------------ */
/* Migration helper                                                    */
/* ------------------------------------------------------------------ */

/**
 * Older builds wrote browser-wide values like `rsanime_ad_access`.
 * We DO NOT migrate them to a scoped key — that would silently grant
 * the unlock to every account on this browser, which is exactly the
 * bug we are fixing. Instead, drop the legacy key the first time we
 * boot this version so nobody starts with an unintended grant.
 */
export function purgeLegacyBrowserWideKeys(keys: string[]) {
  try {
    keys.forEach((k) => {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
      }
    });
  } catch {}
}
