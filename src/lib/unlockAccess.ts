import { db, ref, set, get, runTransaction } from "@/lib/firebase";
import { callEdgeFunction } from "@/lib/edgeFunctionRouter";
import { SITE_URL } from "@/lib/siteConfig";

const UNLOCK_TOKEN_TTL_MS = 15 * 60 * 1000;
const FREE_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;

// --- Random Prize Duration Logic ---
// Weighted: heavily favors 24-30h range, very rarely gives high hours
// Returns hours and minutes for more exciting display
export function getRandomPrizeDuration(): { hours: number; minutes: number; totalMs: number } {
  const roll = Math.random();
  let totalMinutes: number;

  if (roll < 0.005) {
    // 0.5% → 48h exactly (ultra jackpot!)
    totalMinutes = 48 * 60;
  } else if (roll < 0.02) {
    // 1.5% → 42-47h range
    totalMinutes = Math.floor((42 + Math.random() * 5) * 60 + Math.random() * 60);
  } else if (roll < 0.05) {
    // 3% → 36-41h range
    totalMinutes = Math.floor((36 + Math.random() * 5) * 60 + Math.random() * 60);
  } else if (roll < 0.12) {
    // 7% → 31-35h range
    totalMinutes = Math.floor((31 + Math.random() * 4) * 60 + Math.random() * 60);
  } else if (roll < 0.30) {
    // 18% → 27-30h range
    totalMinutes = Math.floor((27 + Math.random() * 3) * 60 + Math.random() * 60);
  } else {
    // 70% → 24h 0m to 26h 59m (most common)
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

export const createUnlockLinkForCurrentUser = async (): Promise<{ ok: boolean; shortUrl?: string; error?: string }> => {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, error: "login_required" };

  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + UNLOCK_TOKEN_TTL_MS;

  await set(ref(db, `unlockTokens/${token}`), {
    token,
    ownerUserId: userId,
    createdAt: now,
    expiresAt,
    status: "pending",
    consumed: false,
  });

  const callbackUrl = `${SITE_URL}/unlock?t=${encodeURIComponent(token)}`;
  let data: any;
  try {
    data = await callEdgeFunction("shorten", { url: callbackUrl });
  } catch {
    return { ok: false, error: "shortener_failed" };
  }

  const shortUrl = typeof data === "string" ? data : data?.shortenedUrl || data?.short || data?.url;
  if (!shortUrl) return { ok: false, error: "shortener_empty" };

  return { ok: true, shortUrl };
};

// --- Random Prize Link Creator ---
// Creates a single reusable prize link. Duration is determined at OPEN time, not here.
export const createRandomPrizeLink = async (): Promise<{
  ok: boolean; shortUrl?: string; error?: string;
}> => {
  const userId = getLocalUserId();
  if (!userId) return { ok: false, error: "login_required" };

  const token = randomToken();
  const now = Date.now();

  // Deactivate old prize link if exists
  try {
    const oldSnap = await get(ref(db, `activePrizeLink`));
    const old = oldSnap.val();
    if (old?.token) {
      await set(ref(db, `unlockTokens/${old.token}/status`), "deactivated");
    }
  } catch {}

  // Prize links: unlimited uses, no expiry until new link generated
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
  let data: any;
  try {
    data = await callEdgeFunction("shorten", { url: callbackUrl });
  } catch {
    return { ok: false, error: "shortener_failed" };
  }

  const shortUrl = typeof data === "string" ? data : data?.shortenedUrl || data?.short || data?.url;
  if (!shortUrl) return { ok: false, error: "shortener_empty" };

  return { ok: true, shortUrl };
};

export const consumeUnlockTokenForCurrentUser = async (
  token: string,
): Promise<{ ok: boolean; reason?: "login_required" | "invalid_token" | "expired" | "not_owner" | "already_used" | "claimed" }> => {
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

    // Prize tokens: skip expiry, owner, and consumed checks
    if (isPrizeToken) {
      // Check if deactivated
      if (current.status === "deactivated" || current.status === "expired") {
        decision = "expired";
        return current;
      }
      // Track usage count but don't block
      decision = "claimed";
      return {
        ...current,
        usageCount: (current.usageCount || 0) + 1,
        lastUsedAt: now,
        lastUsedBy: userId,
      };
    }

    // Normal token logic below
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
        token,
      });
    }
    return { ok: false, reason: decision as "invalid_token" | "expired" | "not_owner" | "already_used" };
  }

  const now = Date.now();
  const expiresAt = now + FREE_ACCESS_DURATION_MS;

  await set(ref(db, `users/${userId}/freeAccess`), {
    active: true,
    grantedAt: now,
    expiresAt,
    viaToken: token,
  });

  return { ok: true, reason: "claimed" };
};
