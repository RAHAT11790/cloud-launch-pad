import { db, ref, set, get, runTransaction, update, onValue } from "@/lib/firebase";
import { SITE_URL } from "@/lib/siteConfig";
import { getUnlockBlockExpiry } from "@/lib/unlockBlock";
import { getDeviceFingerprint, getDeviceId, getDeviceInfo } from "@/lib/premiumDevice";

const UNLOCK_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FREE_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;
const AD_GATE_LAST_SHOWN_KEY = "rs_ad_gate_last_shown_at";
const AD_LINK_FETCH_TIMEOUT_MS = 12_000;

// Admin-configurable cooldown (minutes). 0 = no cooldown (every play shows ad gate).
let _adGateCooldownMs = 0;
try {
  onValue(ref(db, "settings/adGateCooldownMinutes"), (snap) => {
    const mins = Number(snap.val());
    _adGateCooldownMs = Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : 0;
  });
} catch {}

// Get configurable unlock duration from Firebase (cached)
let _cachedDurationMs: number | null = null;
let _cacheTs = 0;
const CACHE_DURATION = 60_000; // 1 min cache

export async function getUnlockDurationMs(): Promise<number> {
  if (_cachedDurationMs !== null && Date.now() - _cacheTs < CACHE_DURATION) return _cachedDurationMs;
  try {
    const snap = await get(ref(db, "settings/unlockDurationHours"));
    const hours = snap.val();
    if (hours && typeof hours === "number" && hours > 0) {
      _cachedDurationMs = hours * 60 * 60 * 1000;
    } else {
      _cachedDurationMs = DEFAULT_FREE_ACCESS_DURATION_MS;
    }
  } catch {
    _cachedDurationMs = DEFAULT_FREE_ACCESS_DURATION_MS;
  }
  _cacheTs = Date.now();
  return _cachedDurationMs;
}

// --- Ad Service Types ---
export interface AdService {
  id: string;
  name: string;
  functionUrl: string;                  // legacy (kept for backward compat)
  shortenerFunctionUrl?: string;        // new: dedicated shortener edge URL
  telegramBotFunctionUrl?: string;      // new: dedicated telegram bot edge URL
  enabled: boolean;
  icon?: string;
  color?: string;
  durationHours?: number;
  mode?: "shortener" | "miniapp";
  // Legacy generic shortener (deprecated, no longer added by UI)
  siteBase?: string;
  apiKey?: string;
}

// --- Get ad services from Firebase ---
export async function getAdServices(): Promise<AdService[]> {
  try {
    const snap = await get(ref(db, "settings/adServices"));
    const val = snap.val();
    if (!val) return [];
    return (Object.values(val) as AdService[])
      .filter((s: any) => s.enabled !== false)
      .sort((a, b) => {
        const aTelegram = a.mode === "miniapp" || /telegram/i.test(`${a.id} ${a.name}`);
        const bTelegram = b.mode === "miniapp" || /telegram/i.test(`${b.id} ${b.name}`);
        if (aTelegram === bTelegram) return 0;
        return aTelegram ? -1 : 1;
      });
  } catch {
    return [];
  }
}

// --- Random Prize Duration Logic ---
export function getRandomPrizeDuration(): { hours: number; minutes: number; totalMs: number } {
  const roll = Math.random();
  let totalMinutes: number;

  if (roll < 0.005) {
    totalMinutes = 48 * 60;
  } else if (roll < 0.02) {
    totalMinutes = Math.floor((42 + Math.random() * 5) * 60 + Math.random() * 60);
  } else if (roll < 0.05) {
    totalMinutes = Math.floor((36 + Math.random() * 5) * 60 + Math.random() * 60);
  } else if (roll < 0.12) {
    totalMinutes = Math.floor((31 + Math.random() * 4) * 60 + Math.random() * 60);
  } else if (roll < 0.30) {
    totalMinutes = Math.floor((27 + Math.random() * 3) * 60 + Math.random() * 60);
  } else {
    totalMinutes = Math.floor(24 * 60 + Math.random() * 3 * 60);
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes, totalMs: totalMinutes * 60 * 1000 };
}

const randomToken = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const getLocalUserId = (): string | null => {
  try {
    const raw = localStorage.getItem("rsanime_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id || null;
  } catch {
    return null;
  }
};

type FreeAccessDeviceEntry = {
  name?: string;
  type?: string;
  fingerprint?: string;
  registeredAt?: number;
  lastSeen?: number;
  grantedAt?: number;
  expiresAt?: number;
  viaToken?: string;
  serviceId?: string | null;
};

type FreeAccessRecord = {
  active?: boolean;
  grantedAt?: number;
  expiresAt?: number;
  viaToken?: string;
  serviceId?: string | null;
  devices?: Record<string, FreeAccessDeviceEntry>;
};

export const getCurrentDeviceFreeAccessExpiry = (snap: FreeAccessRecord | null | undefined): number => {
  const now = Date.now();
  if (!snap?.active) return 0;

  const devices = snap.devices || {};
  const deviceId = getDeviceId();
  const fingerprint = getDeviceFingerprint();
  const matched = devices[deviceId] || Object.values(devices).find((d) => d?.fingerprint && d.fingerprint === fingerprint);

  if (matched?.expiresAt && Number(matched.expiresAt) > now) {
    return Number(matched.expiresAt);
  }

  if (Object.keys(devices).length === 0 && Number(snap.expiresAt) > now) {
    return Number(snap.expiresAt);
  }

  return 0;
};

export const markAdGateShownNow = (): void => {
  try {
    localStorage.setItem(AD_GATE_LAST_SHOWN_KEY, String(Date.now()));
  } catch {}
};

export const getRemainingAdGateCooldownMs = (): number => {
  if (_adGateCooldownMs <= 0) return 0;
  try {
    const lastShownAt = Number(localStorage.getItem(AD_GATE_LAST_SHOWN_KEY) || 0);
    if (!lastShownAt) return 0;
    return Math.max(0, lastShownAt + _adGateCooldownMs - Date.now());
  } catch {
    return 0;
  }
};

export const isAdGateCooldownActive = (): boolean => getRemainingAdGateCooldownMs() > 0;

/** Shorten via dedicated shortener URL, legacy functionUrl, or generic site+apiKey */
async function shortenWithService(svc: AdService, callbackUrl: string): Promise<string | null> {
  const fetchJsonWithTimeout = async (input: RequestInfo | URL, init?: RequestInit): Promise<any> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), AD_LINK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(input, { ...init, signal: controller.signal });
      return await res.json().catch(() => ({}));
    } finally {
      window.clearTimeout(timer);
    }
  };

  const shortenerUrl = svc.shortenerFunctionUrl || (svc.functionUrl && !svc.functionUrl.startsWith("telegram://") && !svc.functionUrl.startsWith("generic://") ? svc.functionUrl : "");
  if (shortenerUrl) {
    try {
      const data = await fetchJsonWithTimeout(shortenerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: callbackUrl }),
      });
      const out = data?.shortenedUrl || data?.short || data?.url || null;
      if (out) return out;
    } catch {}
  }
  if (svc.siteBase && svc.apiKey) {
    try {
      const base = svc.siteBase.replace(/\/+$/, "");
      const apiUrl = `${base}/api?api=${encodeURIComponent(svc.apiKey)}&url=${encodeURIComponent(callbackUrl)}`;
      const d = await fetchJsonWithTimeout(apiUrl);
      const out = d?.shortenedUrl || d?.short || (typeof d?.url === "string" ? d.url : null);
      if (out) return out;
    } catch {}
  }
  return null;
}

/** Get duration for a specific service */
export async function getServiceDurationMs(serviceId?: string): Promise<number> {
  if (serviceId) {
    try {
      const snap = await get(ref(db, `settings/adServices/${serviceId}/durationHours`));
      const hours = snap.val();
      if (hours && typeof hours === "number" && hours > 0) {
        return hours * 60 * 60 * 1000;
      }
    } catch {}
  }
  // fallback to global
  return getUnlockDurationMs();
}

/** Create unlock links for ALL enabled ad services (separate token per service) */
export const createUnlockLinksForAllServices = async (): Promise<{ ok: boolean; links: { service: AdService; shortUrl: string }[]; error?: string }> => {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, links: [], error: "login_required" };

  const services = await getAdServices();
  if (services.length === 0) return { ok: false, links: [], error: "no_services" };

  const now = Date.now();
  const expiresAt = now + UNLOCK_TOKEN_TTL_MS;

  const results: { service: AdService; shortUrl: string }[] = [];
  await Promise.allSettled(services.map(async (svc) => {
    // Mini App mode: no shortener — VideoPlayer will redirect to Telegram instead
    if (svc.mode === "miniapp") {
      results.push({ service: svc, shortUrl: "miniapp://telegram" });
      return;
    }
    const token = randomToken();
    await set(ref(db, `unlockTokens/${token}`), {
      token,
      ownerUserId: userId,
      createdAt: now,
      expiresAt,
      status: "pending",
      consumed: false,
      serviceId: svc.id,
    });
    const callbackUrl = `${SITE_URL}/unlock?t=${encodeURIComponent(token)}&svc=${encodeURIComponent(svc.id)}`;
    const shortUrl = await shortenWithService(svc, callbackUrl);
    if (shortUrl) results.push({ service: svc, shortUrl });
  }));

  if (results.length === 0) return { ok: false, links: [], error: "all_shorteners_failed" };
  return { ok: true, links: results };
};

// Keep backward compat
export const createUnlockLinkForCurrentUser = async (): Promise<{ ok: boolean; shortUrl?: string; error?: string }> => {
  const result = await createUnlockLinksForAllServices();
  if (!result.ok || result.links.length === 0) return { ok: false, error: result.error };
  return { ok: true, shortUrl: result.links[0].shortUrl };
};

// --- Random Prize Link Creator ---
export const createRandomPrizeLink = async (): Promise<{
  ok: boolean; shortUrl?: string; error?: string;
}> => {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, error: "login_required" };

  const services = await getAdServices();
  const service = services[0];
  if (!service) return { ok: false, error: "no_services" };

  const token = randomToken();
  const now = Date.now();

  try {
    const oldSnap = await get(ref(db, `activePrizeLink`));
    const old = oldSnap.val();
    if (old?.token) {
      await set(ref(db, `unlockTokens/${old.token}/status`), "deactivated");
    }
  } catch {}

  await set(ref(db, `unlockTokens/${token}`), {
    token,
    ownerUserId: userId,
    createdAt: now,
    expiresAt: 0,
    status: "active",
    consumed: false,
    mode: "prize",
    unlimited: true,
  });

  await set(ref(db, `activePrizeLink`), {
    token,
    createdAt: now,
    createdBy: userId,
  });

  const callbackUrl = `${SITE_URL}/unlock?t=${encodeURIComponent(token)}&mode=prize`;
  const shortUrl = await shortenWithService(service, callbackUrl);
  if (!shortUrl) return { ok: false, error: "shortener_failed" };

  return { ok: true, shortUrl };
};

export const consumeUnlockTokenForCurrentUser = async (
  token: string,
): Promise<{ ok: boolean; reason?: "login_required" | "invalid_token" | "expired" | "not_owner" | "already_used" | "claimed"; serviceId?: string; durationMs?: number }> => {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, reason: "login_required" };
  if (!token) return { ok: false, reason: "invalid_token" };

  const tokenRef = ref(db, `unlockTokens/${token}`);
  let decision: string = "invalid_token";

  await runTransaction(tokenRef, (current: any) => {
    if (!current) {
      decision = "invalid_token";
      return current;
    }

    const now = Date.now();
    const isPrizeToken = current.mode === "prize" && current.unlimited;

    if (isPrizeToken) {
      if (current.status === "deactivated" || current.status === "expired") {
        decision = "expired";
        return current;
      }
      decision = "claimed";
      return {
        ...current,
        usageCount: (current.usageCount || 0) + 1,
        lastUsedAt: now,
        lastUsedBy: userId,
      };
    }

    if (Number(current.expiresAt || 0) < now && current.expiresAt !== 0) {
      decision = "expired";
      return {
        ...current,
        status: "expired",
      };
    }

    if (current.ownerUserId && current.ownerUserId !== userId) {
      decision = "not_owner";
      return {
        ...current,
        misuseAttempts: {
          ...(current.misuseAttempts || {}),
          [userId]: now,
        },
      };
    }

    if (current.consumed && current.claimedByUserId && current.claimedByUserId !== userId) {
      decision = "already_used";
      return {
        ...current,
        misuseAttempts: {
          ...(current.misuseAttempts || {}),
          [userId]: now,
        },
      };
    }

    if (current.consumed && current.claimedByUserId === userId) {
      decision = "claimed";
      return current;
    }

    decision = "claimed";
    return {
      ...current,
      consumed: true,
      status: "claimed",
      claimedByUserId: userId,
      claimedAt: now,
      expiresAt: now,
    };
  });

  if (decision !== "claimed") {
    if (decision === "not_owner" || decision === "already_used") {
      await set(ref(db, `users/${userId}/security/unlockBlocked`), {
        blocked: true,
        reason: "reused_unlock_token",
        blockedAt: Date.now(),
        expiresAt: getUnlockBlockExpiry(),
        token,
      });
    }
    return { ok: false, reason: decision as "invalid_token" | "expired" | "not_owner" | "already_used" };
  }

  const now = Date.now();
  // Get service-specific duration from token (or grantMs override from telegram bot)
  const tokenSnap = await get(ref(db, `unlockTokens/${token}`));
  const tokenData = tokenSnap.val() || {};
  const serviceId = tokenData.serviceId;
  const grantMsOverride = Number(tokenData.grantMs);
  const durationMs = grantMsOverride > 0 ? grantMsOverride : await getServiceDurationMs(serviceId);
  const expiresAt = now + durationMs;

  const deviceId = getDeviceId();
  const fingerprint = getDeviceFingerprint();
  const deviceInfo = getDeviceInfo();

  const freeAccessRef = ref(db, `users/${userId}/freeAccess`);
  const existingSnap = await get(freeAccessRef);
  const existing = (existingSnap.val() || {}) as FreeAccessRecord;
  const existingDevices = existing.devices || {};

  await set(freeAccessRef, {
    active: true,
    grantedAt: now,
    expiresAt: Math.max(Number(existing.expiresAt || 0), expiresAt),
    viaToken: token,
    serviceId: serviceId || null,
    devices: {
      ...existingDevices,
      [deviceId]: {
        ...(existingDevices[deviceId] || {}),
        name: deviceInfo.name,
        type: deviceInfo.type,
        fingerprint,
        registeredAt: existingDevices[deviceId]?.registeredAt || now,
        lastSeen: now,
        grantedAt: now,
        expiresAt,
        viaToken: token,
        serviceId: serviceId || null,
      },
    },
  });

  const matchedLegacyDeviceId = Object.entries(existingDevices).find(([, device]) => device?.fingerprint && device.fingerprint === fingerprint)?.[0];
  if (matchedLegacyDeviceId && matchedLegacyDeviceId !== deviceId) {
    await update(ref(db, `users/${userId}/freeAccess/devices/${matchedLegacyDeviceId}`), { lastSeen: now, expiresAt });
  }

  return { ok: true, reason: "claimed", serviceId, durationMs };
};

async function getAccessBotEndpoint(): Promise<string> {
  let endpoint = "";
  try {
    const customSnap = await get(ref(db, "settings/accessBotFunctionUrl"));
    const customEndpoint = String(customSnap.val() || "").trim();
    if (customEndpoint && /link-share-bot/i.test(customEndpoint)) {
      endpoint = customEndpoint;
    }
  } catch {}

  if (!endpoint) {
    try {
      const overrideSnap = await get(ref(db, "settings/functionOverrides/link-share-bot"));
      const override = overrideSnap.val() || {};
      const overrideUrl = override.enabled === true ? String(override.customUrl || "").trim() : "";
      if (overrideUrl && /link-share-bot/i.test(overrideUrl)) {
        endpoint = overrideUrl;
      }
    } catch {}
  }

  if (!endpoint) {
    try {
      const services = await getAdServices();
      const telegramService = services.find((svc) => {
        const botUrl = String(svc.telegramBotFunctionUrl || svc.functionUrl || "").trim();
        return Boolean(botUrl) && /link-share-bot/i.test(botUrl);
      });
      const botUrl = String(telegramService?.telegramBotFunctionUrl || telegramService?.functionUrl || "").trim();
      if (botUrl && /link-share-bot/i.test(botUrl)) {
        endpoint = botUrl;
      }
    } catch {}
  }

  return endpoint;
}

const withBotPath = (base: string, path: string) => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

/**
 * Build a Telegram-bot deep-link unlock URL for the current user.
 * This must always go through the dedicated access bot, not the Telegram post bot.
 */
export async function createTelegramBotUnlockLink(): Promise<{
  ok: boolean;
  url?: string;
  deepLink?: string;
  error?: string;
}> {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, error: "login_required" };

  try {
    const endpoint = await getAccessBotEndpoint();
    if (!endpoint) return { ok: false, error: "telegram_endpoint_not_configured" };

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-unlock-link", userId }),
    });
    const data = await r.json();
    const url = data?.url || data?.shortUrl || data?.deepLink || null;
    if (!r.ok || !url) {
      return { ok: false, error: data?.error || "bot_link_failed" };
    }
    return { ok: true, url, deepLink: data?.deepLink || url };
  } catch (e: any) {
    return { ok: false, error: e?.message || "unknown" };
  }
}

export async function consumeTelegramVerifyToken(token: string): Promise<{
  ok: boolean;
  deepLink?: string;
  hours?: number;
  error?: string;
}> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return { ok: false, error: "empty_token" };

  try {
    const endpoint = await getAccessBotEndpoint();
    if (!endpoint) return { ok: false, error: "telegram_endpoint_not_configured" };

    const r = await fetch(withBotPath(endpoint, "verify-consume"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: cleanToken }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) {
      return { ok: false, error: data?.error || "verify_consume_failed" };
    }
    return { ok: true, deepLink: data?.deepLink, hours: data?.hours };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network_error" };
  }
}


/**
 * Claim a Telegram-bot generated short access code (e.g., "AB23CDEF")
 * by calling the telegram-post edge function.
 */
export async function claimAccessCode(code: string): Promise<{
  ok: boolean; durationMs?: number; expiresAt?: number; error?: string;
}> {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, error: "login_required" };
  const cleanCode = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!cleanCode) return { ok: false, error: "empty_code" };

  const endpoint = await getAccessBotEndpoint();
  if (!endpoint) return { ok: false, error: "endpoint_not_configured" };

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim-access-code", code: cleanCode, userId }),
    });
    const data = await r.json();
    if (!r.ok || !data?.ok) return { ok: false, error: data?.error || "claim_failed" };
    return { ok: true, durationMs: data.durationMs, expiresAt: data.expiresAt };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network_error" };
  }
}
