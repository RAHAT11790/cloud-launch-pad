// ============================================================
// video-guard client — turn any real URL into a guarded stream URL
// ============================================================
// Requires the `video-guard` Cloudflare Worker to be added in
// EGD Router (with SIGNING_SECRET configured on the worker).
//
// Usage:
//   const safe = await guardVideoUrl(realUrl);
//   videoEl.src = safe; // browser sees only /play?t=..., never the real URL
//
// If the worker isn't configured, falls back to the original URL
// so nothing breaks in dev / before deploy.
// ============================================================

import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";

type GuardResponse = {
  guarded: string;
  resolveUrl: string;
  token: string;
  jti: string;
  expiresAt: number;
};

const cache = new Map<string, { guarded: string; expiresAt: number }>();
let cachedGuardBase = "";
let cachedGuardBaseAt = 0;

function builtinGuardBase(): string {
  const base = String((import.meta as any)?.env?.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/functions/v1/video-guard` : "";
}

async function isStreamGuardBase(base: string): Promise<boolean> {
  if (!base) return false;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/health`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.mode === "stream-proxy";
  } catch {
    return false;
  }
}

async function getGuardBase(): Promise<string> {
  const now = Date.now();
  if (cachedGuardBase && now - cachedGuardBaseAt < 120_000) return cachedGuardBase;

  const configured = String(await getEdgeFunctionUrl("video-guard").catch(() => "") || "").replace(/\/+$/, "");
  if (configured && await isStreamGuardBase(configured)) {
    cachedGuardBase = configured;
    cachedGuardBaseAt = now;
    return cachedGuardBase;
  }

  // If the admin still has an older Cloudflare guard saved (302 redirect mode),
  // fall back to the deployed stream-guard copy so raw MP4 URLs never leak.
  const fallback = builtinGuardBase();
  if (fallback && await isStreamGuardBase(fallback)) {
    cachedGuardBase = fallback;
    cachedGuardBaseAt = now;
    return cachedGuardBase;
  }

  return "";
}

/**
 * Wrap a real video URL with a protected streaming token.
 * Returns the guarded URL (/play?t=...), which streams bytes without redirecting
 * to the real URL. If copied to another browser/device, it is rejected.
 * If the guard worker is not configured, returns the input unchanged.
 */
export async function guardVideoUrl(realUrl: string, ttlSec = 6 * 60 * 60): Promise<string> {
  const raw = String(realUrl || "").trim();
  if (!/^https?:\/\//i.test(raw)) return raw;

  // Reuse a still-valid token for the same URL within the same page load
  // to avoid re-signing on quality/audio switch churn.
  const cached = cache.get(raw);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.guarded;

  const base = await getGuardBase();
  if (!base) return raw;

  try {
    const res = await fetch(`${base}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: raw, ttl: ttlSec }),
    });
    if (!res.ok) return raw;
    const data = (await res.json()) as GuardResponse;
    if (!data?.guarded) return raw;
    cache.set(raw, { guarded: data.guarded, expiresAt: data.expiresAt });
    return data.guarded;
  } catch {
    return raw;
  }
}

/** Resolve a guarded token back to the real URL (also burns the token). */
export async function resolveGuardedUrl(guardedUrl: string): Promise<string | null> {
  try {
    const u = new URL(guardedUrl);
    const t = u.searchParams.get("t");
    if (!t) return null;
    u.pathname = "/resolve";
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const data = await res.json();
    return data?.url || null;
  } catch {
    return null;
  }
}
