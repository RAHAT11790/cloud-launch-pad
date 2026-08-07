// ============================================
// Guest store — localStorage-only data for non-logged-in visitors.
// No Firebase writes happen for guests; all preferences/history/watchlist
// live here until they log in (then you can optionally migrate).
// ============================================

type AnyJson = unknown;

const PREFIX = "guest:";

function k(name: string) { return `${PREFIX}${name}`; }

export function isGuest(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return true;
    const u = JSON.parse(raw);
    return !(u?.id && u?.email);
  } catch { return true; }
}

export function gGet<T = AnyJson>(name: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(k(name));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function gSet<T = AnyJson>(name: string, value: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(k(name), JSON.stringify(value)); } catch {}
}

export function gDel(name: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(k(name)); } catch {}
}

// ---------- Typed helpers ----------

export interface GuestContinueItem {
  animeId: string;
  seasonIdx?: number;
  epIdx?: number;
  position: number;     // seconds
  duration?: number;
  title?: string;
  poster?: string;
  updatedAt: number;
}

export const guestStore = {
  /** Continue-watching list (most recent first, capped 50). */
  continue: {
    list(): GuestContinueItem[] { return gGet<GuestContinueItem[]>("continueWatching", []); },
    upsert(item: GuestContinueItem) {
      const list = guestStore.continue.list().filter(x => x.animeId !== item.animeId);
      list.unshift(item);
      gSet("continueWatching", list.slice(0, 50));
    },
    remove(animeId: string) {
      gSet("continueWatching", guestStore.continue.list().filter(x => x.animeId !== animeId));
    },
    clear() { gDel("continueWatching"); },
  },

  /** Watchlist / library. */
  watchlist: {
    list(): any[] { return gGet<any[]>("watchlist", []); },
    has(id: string) { return guestStore.watchlist.list().some(x => x.id === id); },
    toggle(item: any) {
      const list = guestStore.watchlist.list();
      const next = list.some(x => x.id === item.id)
        ? list.filter(x => x.id !== item.id)
        : [{ ...item, addedAt: Date.now() }, ...list];
      gSet("watchlist", next.slice(0, 200));
      return next.some(x => x.id === item.id);
    },
  },

  /** Recently viewed. */
  recent: {
    list(): any[] { return gGet<any[]>("recent", []); },
    push(item: any) {
      const list = guestStore.recent.list().filter(x => x.id !== item.id);
      list.unshift({ ...item, viewedAt: Date.now() });
      gSet("recent", list.slice(0, 50));
    },
  },

  /** Lightweight prefs (audio language, quality, etc). */
  prefs: {
    get<T = AnyJson>(key: string, fallback: T): T { return gGet<T>(`pref:${key}`, fallback); },
    set<T = AnyJson>(key: string, value: T) { gSet(`pref:${key}`, value); },
  },

  /** Clear all guest data (use after successful login migration). */
  clearAll() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) localStorage.removeItem(key);
      }
    } catch {}
  },
};
