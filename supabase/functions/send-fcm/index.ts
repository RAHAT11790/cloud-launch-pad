import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  database_url?: string;
};

type TokenLookupResult = {
  tokens: string[];
  tokenPathsByToken: Record<string, string[]>;
  tokenUserIdsByToken: Record<string, string[]>;
};

const BRAND_ICON_URL = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";
const DEFAULT_DB_URL = "https://rs-anime-default-rtdb.firebaseio.com";

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64UrlEncode(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function dbBase(sa: ServiceAccount): string {
  const url = (sa.database_url || "").trim() || DEFAULT_DB_URL;
  return url.replace(/\/$/, "");
}

function absUrl(v: string | undefined, base: string): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return `https:${v}`;
  if (v.startsWith("/")) return `${base}${v}`;
  return `${base}/${v}`;
}

const TRANSIENT = ["UNAVAILABLE", "INTERNAL", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED"];
type FailCat = "invalid" | "transient" | "other";
function categorize(msg: string): FailCat {
  const m = msg.toUpperCase();
  if (m.includes("UNREGISTERED") || m.includes("REGISTRATION_TOKEN_NOT_REGISTERED")) return "invalid";
  if (m.includes("INVALID_ARGUMENT") && (m.includes("TOKEN") || m.includes("REGISTRATION"))) return "invalid";
  if (TRANSIENT.some((c) => m.includes(c))) return "transient";
  return "other";
}

async function fetchTokens(sa: ServiceAccount, accessToken: string, userIds?: string[]): Promise<TokenLookupResult> {
  const base = dbBase(sa);
  let res = await fetch(`${base}/fcmTokens.json?access_token=${accessToken}`);
  if (!res.ok) res = await fetch(`${base}/fcmTokens.json`);
  if (!res.ok) throw new Error(`fcmTokens read failed: ${res.status}`);
  const tree = (await res.json()) || {};
  const allowed = userIds?.length ? new Set(userIds) : null;
  const tokens = new Set<string>();
  const paths: Record<string, string[]> = {};
  const usersByToken: Record<string, string[]> = {};
  Object.entries(tree).forEach(([uid, userTokens]: any) => {
    if (allowed && !allowed.has(uid)) return;
    Object.entries(userTokens || {}).forEach(([key, entry]: any) => {
      const t = entry?.token;
      if (!t) return;
      tokens.add(t);
      (paths[t] = paths[t] || []).push(`fcmTokens/${uid}/${key}`);
      (usersByToken[t] = usersByToken[t] || []).push(String(uid));
    });
  });
  return { tokens: [...tokens], tokenPathsByToken: paths, tokenUserIdsByToken: usersByToken };
}

async function cleanupInvalid(sa: ServiceAccount, accessToken: string, invalid: string[], pathsByToken: Record<string, string[]>): Promise<number> {
  if (!invalid.length) return 0;
  const base = dbBase(sa);
  const paths = invalid.flatMap((t) => pathsByToken[t] || []);
  let removed = 0;
  await Promise.all(paths.map(async (p) => {
    try {
      const r = await fetch(`${base}/${p}.json?access_token=${accessToken}`, { method: "DELETE" });
      if (r.ok) removed++;
    } catch {}
  }));
  return removed;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOne(projectId: string, accessToken: string, message: any, retries = 2): Promise<{ ok: boolean; category?: FailCat; err?: string }> {
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (r.ok) { await r.text().catch(() => ""); return { ok: true }; }
      const err = await r.text();
      const cat = categorize(err);
      if (cat === "transient" && a < retries) { await sleep(500 * 2 ** a); continue; }
      return { ok: false, category: cat, err };
    } catch (e) {
      if (a < retries) { await sleep(500 * 2 ** a); continue; }
      return { ok: false, category: "transient", err: String(e) };
    }
  }
  return { ok: false, category: "other" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { tokens, userIds, title, body: msgBody, image, icon, badge, data } = body || {};
    const inTokens: string[] = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
    const inUsers: string[] = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
    if (!inTokens.length && !inUsers.length) {
      return new Response(JSON.stringify({ error: "No tokens or userIds provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY");
    if (!saJson) return new Response(JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const sa: ServiceAccount = JSON.parse(saJson);
    const accessToken = await getAccessToken(sa);

    const normalized: Record<string, string> = {};
    if (data && typeof data === "object") {
      Object.entries(data).forEach(([k, v]) => { normalized[k] = v == null ? "" : String(v); });
    }
    const base = (normalized.baseUrl || req.headers.get("origin") || "https://rsanime03.lovable.app").replace(/\/$/, "");
    const iconUrl = absUrl(icon, base) || BRAND_ICON_URL;
    const badgeUrl = absUrl(badge, base) || BRAND_ICON_URL;
    const imageUrl = absUrl(image, base);
    const clickLink = absUrl(normalized.url || "/", base);

    let resolvedTokens = [...new Set(inTokens)];
    let pathsByToken: Record<string, string[]> = {};
    let usersByToken: Record<string, string[]> = {};
    if (!resolvedTokens.length && inUsers.length) {
      try {
        const l = await fetchTokens(sa, accessToken, inUsers);
        resolvedTokens = l.tokens;
        pathsByToken = l.tokenPathsByToken;
        usersByToken = l.tokenUserIdsByToken;
      } catch (e: any) {
        return new Response(JSON.stringify({
          success: 0, failed: 0, totalTokens: 0, invalidTokens: [], invalidRemoved: 0,
          deliveredUserIds: [], deliveredUsers: 0,
          reason: "TOKEN_LOOKUP_FAILED", details: { message: e?.message || String(e) },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (!resolvedTokens.length) {
      return new Response(JSON.stringify({
        success: 0, failed: 0, totalTokens: 0, invalidTokens: [], invalidRemoved: 0,
        deliveredUserIds: [], deliveredUsers: 0,
        reason: "NO_MATCHING_TOKENS",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let success = 0, failed = 0;
    const invalid: string[] = [];
    const deliveredUserIds = new Set<string>();
    const failReasons = { invalid: 0, transient: 0, other: 0 };
    const concurrency = Math.min(30, resolvedTokens.length);
    let idx = 0;
    const worker = async () => {
      while (idx < resolvedTokens.length) {
        const i = idx++;
        const token = resolvedTokens[i];
        const message = {
          message: {
            token,
            notification: { title, body: msgBody },
            webpush: {
              headers: { Urgency: "high", TTL: "2419200" },
              notification: {
                title, body: msgBody,
                icon: iconUrl, badge: badgeUrl, image: imageUrl,
                vibrate: [200, 100, 200], requireInteraction: false,
              },
              fcm_options: clickLink ? { link: clickLink } : undefined,
            },
            data: normalized,
          },
        };
        const r = await sendOne(sa.project_id, accessToken, message);
        if (r.ok) {
          success++;
          (usersByToken[token] || []).forEach((uid) => deliveredUserIds.add(uid));
        }
        else {
          failed++;
          const c = r.category || "other";
          failReasons[c]++;
          if (c === "invalid") invalid.push(token);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const invalidRemoved = inUsers.length ? await cleanupInvalid(sa, accessToken, invalid, pathsByToken) : 0;
    const deliveredIds = [...deliveredUserIds];
    console.log("[send-fcm] result", JSON.stringify({
      requestedUsers: inUsers.length,
      totalTokens: resolvedTokens.length,
      success,
      failed,
      deliveredUsers: deliveredIds.length,
      invalidRemoved,
      failReasons,
    }));

    return new Response(JSON.stringify({
      success, failed, totalTokens: resolvedTokens.length,
      invalidTokens: invalid, invalidRemoved, failReasons,
      deliveredUserIds: deliveredIds,
      deliveredUsers: deliveredIds.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
