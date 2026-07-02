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
  globalQualityLocks: { [k: string]: boolean }; // "480p" | "720p" | "1080p" | "4k"
  coinPlan: CoinPlan;
  extraPlans: CoinPlan[];
  dailyAdCap: number;
  adWatchSeconds: number;
}

export const DEFAULT_PREMIUM_SETTINGS: PremiumGlobalSettings = {
  globalDownloadLock: true,
  globalQualityLocks: { "4k": true, "1080p": false, "720p": false, "480p": false },
  coinPlan: { id: "default", name: "Starter", coins: 20, days: 5, featured: true },
  extraPlans: [],
  dailyAdCap: 5,
  adWatchSeconds: 15,
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

export const awardCoin = async (adId: string, capPerDay = 5): Promise<AwardCoinResult> => {
  const uid = getLocalUserId();
  if (!uid) return { ok: false, reason: "no_user" };
  const day = todayKey();
  let outcome: AwardCoinResult = { ok: false, reason: "unknown" };
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
  return outcome;
};

/** Buy premium with coins — deducts coins, activates premium */
export type SpendResult = { ok: true; expiresAt: number } | { ok: false; reason: "no_user" | "insufficient" | "unknown" };

export const buyPremiumWithCoins = async (plan: CoinPlan): Promise<SpendResult> => {
  const uid = getLocalUserId();
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
  return Math.max(0, cap - (today?.count || 0));
};

export const wasAdWatchedToday = (wallet: any, adId: string): boolean => {
  const day = todayKey();
  return !!wallet?.adWatchLog?.[day]?.adIds?.[adId];
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
  { id: "adsterra_social_bar", name: "Adsterra Social Bar SDK", url: "https://pl29545319.effectivecpmnetwork.com/76/17/9d/76179d54c872b5d668d5a5hd3c60cc20.js", enabled: true, kind: "sdk" },
  { id: "adsterra_popunder", name: "Adsterra Popunder SDK", url: "https://pl29545318.effectivecpmnetwork.com/b5/74/7e/b5747e03c73558e2e6a43cab1723472ce.js", enabled: true, kind: "sdk" },
  { id: "adsterra_native_banner", name: "Adsterra Native Banner SDK", url: "https://pl29872715.effectivecpmnetwork.com/91638987f5610218ba77ea1c44c9fd71/invoke.js", enabled: true, kind: "sdk" },
  { id: "adsterra_smartlink", name: "Adsterra Smartlink", url: "https://www.effectivecpmnetwork.com/zmcs077s5n?key=ada6384dcdd9d2e879977bc3f6637e47", enabled: true, kind: "smartlink" },
];

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
