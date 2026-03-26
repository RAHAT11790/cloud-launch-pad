import { db, ref, set, runTransaction } from "@/lib/firebase";
import { supabase } from "@/integrations/supabase/client";

const UNLOCK_TOKEN_TTL_MS = 15 * 60 * 1000;
const FREE_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;

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

  const callbackUrl = `${window.location.origin}/unlock?t=${encodeURIComponent(token)}`;
  const { data, error } = await supabase.functions.invoke("shorten-link", {
    body: { url: callbackUrl },
  });

  if (error) return { ok: false, error: "shortener_failed" };
  const shortUrl = data?.shortenedUrl || data?.short;
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

    if (Number(current.expiresAt || 0) < now) {
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