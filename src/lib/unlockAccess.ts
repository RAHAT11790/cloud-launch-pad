import { db, ref, set, get, runTransaction } from "@/lib/firebase";
import { SITE_URL } from "@/lib/siteConfig";
import { getUnlockBlockExpiry } from "@/lib/unlockBlock";

const UNLOCK_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FREE_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;

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
  functionUrl: string;
  enabled: boolean;
  icon?: string;
  color?: string;
  durationHours?: number; // per-service unlock duration
}

// --- Get ad services from Firebase ---
export async function getAdServices(): Promise<AdService[]> {
  try {
    const snap = await get(ref(db, "settings/adServices"));
    const val = snap.val();
    if (!val) return [];
    return Object.values(val).filter((s: any) => s.enabled !== false) as AdService[];
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

/** Shorten a URL using a specific ad service function URL */
async function shortenWithService(functionUrl: string, callbackUrl: string): Promise<string | null> {
  try {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: callbackUrl }),
    });
    const data = await res.json();
    return data?.shortenedUrl || data?.short || data?.url || null;
  } catch {
    return null;
  }
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
  await Promise.all(services.map(async (svc) => {
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
    const shortUrl = await shortenWithService(svc.functionUrl, callbackUrl);
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
  const shortUrl = await shortenWithService(service.functionUrl, callbackUrl);
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
  // Get service-specific duration from token
  const tokenSnap = await get(ref(db, `unlockTokens/${token}/serviceId`));
  const serviceId = tokenSnap.val();
  const durationMs = await getServiceDurationMs(serviceId);
  const expiresAt = now + durationMs;

  await set(ref(db, `users/${userId}/freeAccess`), {
    active: true,
    grantedAt: now,
    expiresAt,
    viaToken: token,
    serviceId: serviceId || null,
  });

  return { ok: true, reason: "claimed", serviceId, durationMs };
};
