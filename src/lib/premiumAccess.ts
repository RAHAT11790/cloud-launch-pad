// Premium access helpers — coin economy, series/episode/quality locks
import { db, ref, get, set, update, onValue, runTransaction } from "@/lib/firebase";
import { getLocalUserId } from "@/lib/unlockAccess";

export interface PremiumStatus {
  active: boolean;
  expiresAt: number;
  source?: "coin" | "bkash" | "redeem" | "admin";
}

export interface CoinPlan {
  id: string;
  name: string;
  coins: number;
  days: number;
  featured?: boolean;
}

export interface PremiumGlobalSettings {
  globalDownloadLock: boolean;
  globalQualityLocks: { [k: string]: boolean };
  coinPlan: CoinPlan;
  extraPlans: CoinPlan[];
  dailyAdCap: number;
  adWatchSeconds: number;
  premiumDeviceLimit: number;
}

export const DEFAULT_PREMIUM_SETTINGS: PremiumGlobalSettings = {
  globalDownloadLock: true,
  globalQualityLocks: { "4k": true, "1080p": false, "720p": false, "480p": false },
  coinPlan: { id: "default", name: "Starter", coins: 20, days: 5, featured: true },
  extraPlans: [],
  dailyAdCap: 5,
  adWatchSeconds: 15,
  premiumDeviceLimit: 1,
};

const todayKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** Check if user premium is active (Date.now() < expiresAt) */
export const isPremiumActive = (status?: PremiumStatus | null) =>
  !!(status && status.active && Number(status.expiresAt || 0) > Date.now());

/** Global premium settings — realtime subscribe */
export const subscribePremiumSettings = (
  cb: (s: PremiumGlobalSettings) => void,
): (() => void) => {
  const u = onValue(ref(db, "settings/premium"), (snap) => {
    const raw = snap.val() || {};
    cb({
      ...DEFAULT_PREMIUM_SETTINGS,
      ...raw,
      coinPlan: { ...DEFAULT_PREMIUM_SETTINGS.coinPlan, ...(raw.coinPlan || {}) },
      globalQualityLocks: {
        ...DEFAULT_PREMIUM_SETTINGS.globalQualityLocks,
        ...(raw.globalQualityLocks || {}),
      },
      extraPlans: Array.isArray(raw.extraPlans) ? raw.extraPlans : [],
    });
  });
  return () => u();
};

export const savePremiumSettings = async (patch: Partial<PremiumGlobalSettings>) => {
  await update(ref(db, "settings/premium"), patch as any);
};

/** Series-level premium check */
export type SeriesLike = {
  premium?: boolean;
  premiumEpisodes?: Record<string, boolean>;
  qualityLocks?: Record<string, boolean>;
  dubType?: "official" | "fan";
};

export const isSeriesLocked = (series?: SeriesLike | null): boolean => !!series?.premium;

export const isEpisodeLocked = (series: SeriesLike | undefined | null, seasonIdx: number, episodeIdx: number): boolean => {
  if (!series) return false;
  if (series.premium) return true;
  const key = `s${seasonIdx + 1}e${episodeIdx + 1}`;
  return !!series.premiumEpisodes?.[key];
};

export const isQualityLocked = (
  quality: string,
  series: SeriesLike | undefined | null,
  globalLocks: Record<string, boolean>,
): boolean => {
  const q = quality.toLowerCase();
  if (globalLocks?.[q]) return true;
  if (series?.qualityLocks?.[q]) return true;
  return false;
};

/** Check if the current user is allowed to download.
 *  Returns { allowed: true } if the global download lock is off OR the user has active premium.
 */
export const checkDownloadAllowed = async (): Promise<{ allowed: boolean; reason?: "premium_required" | "no_user" }> => {
  try {
    const sSnap = await get(ref(db, "settings/premium"));
    const s = (sSnap.val() || {}) as Partial<PremiumGlobalSettings>;
    if (s.globalDownloadLock === false) return { allowed: true };
    const uid = getLocalUserId();
    if (!uid) return { allowed: false, reason: "no_user" };
    const pSnap = await get(ref(db, `users/${uid}/premium`));
    const status = (pSnap.val() || null) as PremiumStatus | null;
    if (isPremiumActive(status)) return { allowed: true };
    return { allowed: false, reason: "premium_required" };
  } catch {
    return { allowed: true }; // fail-open on network hiccups
  }
};

/** Coin ad watch (returns reason for failure) */
export type AwardCoinResult = { ok: true; coins: number } | { ok: false; reason: "no_user" | "daily_cap" | "already_watched" | "unknown" };

const DEVICE_COIN_LOCAL_KEY = "rs_coin_device_daily_v1";
const readLocalDeviceCoinDay = () => {
  try {
    const day = todayKey();
    const raw = localStorage.getItem(DEVICE_COIN_LOCAL_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return { all, day, entry: all[day] || { count: 0, adIds: {} } };
  } catch {
    return { all: {}, day: todayKey(), entry: { count: 0, adIds: {} } };
  }
};

const recordLocalDeviceCoin = (adId: string) => {
  try {
    const { all, day, entry } = readLocalDeviceCoinDay();
    if (entry.adIds?.[adId]) return;
    const next = {
      count: (entry.count || 0) + 1,
      adIds: { ...(entry.adIds || {}), [adId]: Date.now() },
    };
    localStorage.setItem(DEVICE_COIN_LOCAL_KEY, JSON.stringify({ [day]: next }));
  } catch {}
};

export const awardCoin = async (adId: string, capPerDay = 5): Promise<AwardCoinResult> => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return { ok: false, reason: "no_user" };
  const localToday = readLocalDeviceCoinDay().entry;
  if (localToday?.adIds?.[adId]) return { ok: false, reason: "already_watched" };
  if ((localToday?.count || 0) >= capPerDay) return { ok: false, reason: "daily_cap" };
  const day = todayKey();
  const deviceId = getDeviceId();
  let outcome: AwardCoinResult = { ok: false, reason: "unknown" };

  // Hard daily cap is per-device, not per account. A user cannot switch from
  // guest → new login and farm extra coins on the same phone/browser.
  await runTransaction(ref(db, `coinDeviceDaily/${deviceId}/${day}`), (cur: any) => {
    const entry = cur || { count: 0, adIds: {} };
    if (entry.adIds?.[adId]) {
      outcome = { ok: false, reason: "already_watched" };
      return cur;
    }
    if ((entry.count || 0) >= capPerDay) {
      outcome = { ok: false, reason: "daily_cap" };
      return cur;
    }
    return {
      ...entry,
      count: (entry.count || 0) + 1,
      adIds: { ...(entry.adIds || {}), [adId]: Date.now() },
      updatedAt: Date.now(),
    };
  });
  if (!outcome.ok && outcome.reason !== "unknown") return outcome;

  await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
    const wallet = cur || { coins: 0, adWatchLog: {} };
    const today = wallet.adWatchLog?.[day] || { count: 0, adIds: {} };
    if (today.adIds?.[adId]) {
      outcome = { ok: false, reason: "already_watched" };
      return cur;
    }
    if ((today.count || 0) >= capPerDay) {
      outcome = { ok: false, reason: "daily_cap" };
      return cur;
    }
    const newCoins = (wallet.coins || 0) + 1;
    outcome = { ok: true, coins: newCoins };
    return {
      ...wallet,
      coins: newCoins,
      adWatchLog: {
        ...(wallet.adWatchLog || {}),
        [day]: {
          count: (today.count || 0) + 1,
          adIds: { ...(today.adIds || {}), [adId]: Date.now() },
        },
      },
    };
  });
  if (outcome.ok) recordLocalDeviceCoin(adId);
  return outcome;
};

export const clearStaleCoinSession = () => {
  try { localStorage.removeItem("rs_pending_coin_ad_v2"); } catch {}
};

/** Buy premium with coins — deducts coins, activates premium */
export type SpendResult = { ok: true; expiresAt: number } | { ok: false; reason: "no_user" | "insufficient" | "unknown" };

export const buyPremiumWithCoins = async (plan: CoinPlan): Promise<SpendResult> => {
  const uid = getLocalUserId() || ensureGuestUser();
  if (!uid) return { ok: false, reason: "no_user" };
  let out: SpendResult = { ok: false, reason: "unknown" };
  await runTransaction(ref(db, `users/${uid}/coinWallet`), (cur: any) => {
    const wallet = cur || { coins: 0 };
    if ((wallet.coins || 0) < plan.coins) {
      out = { ok: false, reason: "insufficient" };
      return cur;
    }
    out = { ok: true, expiresAt: Date.now() + plan.days * 24 * 60 * 60 * 1000 };
    return { ...wallet, coins: wallet.coins - plan.coins };
  });
  if (!out.ok) return out;

  // extend existing premium if any
  const snap = await get(ref(db, `users/${uid}/premium`));
  const existing = snap.val() || {};
  const base = existing.active && existing.expiresAt > Date.now() ? existing.expiresAt : Date.now();
  const expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
  await set(ref(db, `users/${uid}/premium`), {
    active: true,
    expiresAt,
    source: "coin",
    grantedAt: Date.now(),
    planId: plan.id,
  });
  return { ok: true, expiresAt };
};

/** Get today's remaining ad watches */
export const getTodayRemaining = (wallet: any, cap = 5): number => {
  const day = todayKey();
  const today = wallet?.adWatchLog?.[day];
  const localToday = readLocalDeviceCoinDay().entry;
  return Math.max(0, cap - Math.max(today?.count || 0, localToday?.count || 0));
};

export const wasAdWatchedToday = (wallet: any, adId: string): boolean => {
  const day = todayKey();
  return !!wallet?.adWatchLog?.[day]?.adIds?.[adId] || !!readLocalDeviceCoinDay().entry?.adIds?.[adId];
};

// ============ Coin Ads (admin-managed direct links) ============
export interface CoinAd {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  kind?: "direct" | "sdk" | "smartlink";
}

export const DEFAULT_COIN_ADS: CoinAd[] = [
  { id: "adsterra_social_bar", name: "Social Bar / In-Page Push SDK", url: "https://pl29545319.effectivecpmnetwork.com/76/17/9d/76179d54c872b5d668d5a5hd3c60cc20.js", enabled: true, kind: "sdk" },
  { id: "adsterra_popunder", name: "Adsterra Popunder SDK", url: "https://pl29545318.effectivecpmnetwork.com/b5/74/7e/b5747e03c73558e2e6a43cab1723472ce.js", enabled: true, kind: "sdk" },
  { id: "adsterra_banner_160", name: "Adsterra 160x300 Banner", url: `<script type="text/javascript">\n\tatOptions = {\n\t\t'key' : 'a50e44c4616d20c2030541729493757',\n\t\t'format' : 'iframe',\n\t\t'height' : 300,\n\t\t'width' : 160,\n\t\t'params' : {}\n\t};\n</script>\n<script type="text/javascript" src="//www.highperformanceformat.com/a50e44c4616d20c2030541729493757/invoke.js"></script>`, enabled: true, kind: "sdk" },
  { id: "adsterra_native_banner", name: "Adsterra Native Banner SDK", url: "https://pl29872715.effectivecpmnetwork.com/91638987f5610218ba77ea1c44c9fd71/invoke.js", enabled: true, kind: "sdk" },
  { id: "adsterra_smartlink", name: "Adsterra Smartlink", url: "https://www.effectivecpmnetwork.com/zmcs077s5n?key=ada6384dcdd9d2e879977bc3f6637e47", enabled: true, kind: "smartlink" },
];

export const ensureGuestUser = (): string => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    const existing = raw ? JSON.parse(raw) : null;
    if (existing?.id) return existing.id;
    const uid = `guest_${getDeviceId()}_${Date.now().toString(36)}`;
    localStorage.setItem("rsanime_user", JSON.stringify({
      id: uid,
      name: "Guest User",
      email: "guest@rsanime.com",
      guest: true,
    }));
    try { window.dispatchEvent(new Event("rs_auth_changed")); } catch {}
    return uid;
  } catch {
    return getDeviceId();
  }
};

export const subscribeCoinAds = (cb: (ads: CoinAd[]) => void): (() => void) => {
  const u = onValue(ref(db, "settings/premiumCoinAds"), (snap) => {
    const raw = snap.val() || {};
    const saved = Object.entries(raw)
      .map(([id, v]: any) => ({ id, ...(v || {}) }))
      .filter((a: any) => a.url) as CoinAd[];
    const byId = new Map(DEFAULT_COIN_ADS.map((ad) => [ad.id, ad]));
    saved.forEach((ad) => byId.set(ad.id, { ...byId.get(ad.id), ...ad }));
    const list = Array.from(byId.values()).filter((a: any) => a.url) as CoinAd[];
    cb(list);
  });
  return () => u();
};

export const saveCoinAd = async (ad: CoinAd) => {
  await set(ref(db, `settings/premiumCoinAds/${ad.id}`), {
    name: ad.name,
    url: ad.url,
    enabled: ad.enabled !== false,
    kind: ad.kind || (ad.url.endsWith(".js") ? "sdk" : "direct"),
  });
};

export const deleteCoinAd = async (id: string) => {
  await set(ref(db, `settings/premiumCoinAds/${id}`), null);
};

// ============ Device fingerprint (stable per browser) ============
const DEVICE_ID_KEY = "rs_device_id_v1";
export const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "dev_unknown";
  }
};

// ============ Guest → Real user coin transfer ============
// Runs on login. Same device can only transfer ONCE (prevents farming).
export const transferGuestCoinsToUser = async (guestId: string, targetUid: string): Promise<{ transferred: number }> => {
  if (!guestId || !targetUid || guestId === targetUid) return { transferred: 0 };
  const deviceId = getDeviceId();
  try {
    // Guard: only one transfer per device — ever.
    const claimSnap = await get(ref(db, `deviceTransferClaims/${deviceId}`));
    if (claimSnap.exists()) return { transferred: 0 };

    const gSnap = await get(ref(db, `users/${guestId}/coinWallet`));
    const guestWallet = gSnap.val() || {};
    const coins = Number(guestWallet.coins || 0);
    if (coins <= 0) {
      await set(ref(db, `deviceTransferClaims/${deviceId}`), { at: Date.now(), guestId, targetUid, coins: 0 });
      return { transferred: 0 };
    }

    // Add to real user atomically
    await runTransaction(ref(db, `users/${targetUid}/coinWallet`), (cur: any) => {
      const w = cur || { coins: 0, adWatchLog: {} };
      return { ...w, coins: (w.coins || 0) + coins };
    });
    // Zero out guest wallet & lock it
    await set(ref(db, `users/${guestId}/coinWallet`), {
      coins: 0,
      adWatchLog: guestWallet.adWatchLog || {},
      transferredTo: targetUid,
      transferredAt: Date.now(),
    });
    await set(ref(db, `deviceTransferClaims/${deviceId}`), { at: Date.now(), guestId, targetUid, coins });
    return { transferred: coins };
  } catch {
    return { transferred: 0 };
  }
};

// ============ Premium device limit ============
// When a user activates premium (or logs in with active premium), claim a device slot.
// Returns false if another device already holds the slot.
export type DeviceClaimResult = { ok: true } | { ok: false; reason: "device_limit"; activeDevice: string };
export const claimPremiumDevice = async (uid: string): Promise<DeviceClaimResult> => {
  const deviceId = getDeviceId();
  const path = `users/${uid}/premiumDevices`;
  const snap = await get(ref(db, path));
  const devices = (snap.val() || {}) as Record<string, { at: number }>;
  const sSnap = await get(ref(db, "settings/premium"));
  const limit = Math.max(1, Number((sSnap.val() || {}).premiumDeviceLimit) || 1);

  if (devices[deviceId]) {
    await update(ref(db, `${path}/${deviceId}`), { at: Date.now() });
    return { ok: true };
  }
  const count = Object.keys(devices).length;
  if (count >= limit) {
    return { ok: false, reason: "device_limit", activeDevice: Object.keys(devices)[0] };
  }
  await set(ref(db, `${path}/${deviceId}`), { at: Date.now() });
  return { ok: true };
};

export const releasePremiumDevice = async (uid: string) => {
  try { await set(ref(db, `users/${uid}/premiumDevices/${getDeviceId()}`), null); } catch {}
};

// ============ Guest user detection ============
export const isGuestUser = (): boolean => {
  try {
    const u = JSON.parse(localStorage.getItem("rsanime_user") || "{}");
    return !!u.id && (!u.email || u.email.endsWith("@guest.local") || u.email === "guest@rsanime.com");
  } catch { return true; }
};

