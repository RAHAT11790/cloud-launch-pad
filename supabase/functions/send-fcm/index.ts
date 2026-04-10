/**
 * send-fcm — Supabase Edge Function
 * Firebase Cloud Messaging sender with server-side token resolution.
 *
 * Accepts either:
 *   { tokens: string[], ... }   — direct token list
 *   { userIds: string[], ... }  — resolves tokens from Firebase RTDB
 *
 * Required Supabase secrets:
 *   FIREBASE_SERVICE_ACCOUNT_KEY  — Firebase service account JSON
 *
 * Deploy TWO copies (send-fcm & send-fcm-b) for dual-batching large user lists.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---- JWT for Google OAuth2 ----
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const b64 = (o: any) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${b64(header)}.${b64(claim)}`;

  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8", binKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(unsigned)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsigned}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ---- RTDB helpers ----
async function fetchRTDB(url: string, token: string) {
  const res = await fetch(`${url}.json?access_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`RTDB error ${res.status}: ${errBody.substring(0, 200)}`);
    throw new Error(`RTDB ${res.status}: ${errBody.substring(0, 100)}`);
  }
  return res.json();
}

async function patchRTDB(url: string, token: string, body: Record<string, null>) {
  const res = await fetch(`${url}.json?access_token=${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(`RTDB patch error ${res.status}: ${errBody.substring(0, 200)}`);
    throw new Error(`RTDB patch ${res.status}: ${errBody.substring(0, 100)}`);
  }

  return res.json().catch(() => null);
}

const SITE_ORIGIN = "https://rsanime03.lovable.app";

function extractTokens(userTokens: any): string[] {
  if (!userTokens || typeof userTokens !== "object") return [];
  return Object.values(userTokens)
    .filter((e: any) => {
      if (!e?.token) return false;
      const origin = typeof e.origin === "string" ? e.origin : "";
      return !origin || origin === SITE_ORIGIN;
    })
    .map((e: any) => e.token);
}

// ---- FCM v1 send single ----
async function sendOne(
  accessToken: string, projectId: string, token: string,
  notification: { title: string; body: string; image?: string },
  data: Record<string, string>,
  webpush?: { icon?: string; badge?: string }
): Promise<{ ok: boolean; invalid?: boolean; error?: string }> {
  const msg: any = {
    token, notification, data,
    webpush: {
      notification: {
        ...notification,
        icon: webpush?.icon || data?.icon,
        badge: webpush?.badge || data?.badge,
      },
      fcm_options: data?.url ? { link: data.url } : undefined,
    },
  };

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      }
    );
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.details?.[0]?.errorCode || err?.error?.status || "";
    const invalid = code === "UNREGISTERED" || code === "INVALID_ARGUMENT" || res.status === 404;
    return { ok: false, invalid, error: code || `${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network" };
  }
}

// ---- Main ----
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "send-fcm" });

  try {
    const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY");
    if (!saRaw) {
      console.error("FIREBASE_SERVICE_ACCOUNT_KEY is not set in environment");
      return json({ error: "FIREBASE_SERVICE_ACCOUNT_KEY not set" }, 500);
    }

    let sa: any;
    try {
      sa = JSON.parse(saRaw);
    } catch (parseErr) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", parseErr);
      return json({ error: "Invalid FIREBASE_SERVICE_ACCOUNT_KEY format" }, 500);
    }

    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      console.error("FIREBASE_SERVICE_ACCOUNT_KEY missing required fields (client_email, private_key, project_id)");
      return json({ error: "FIREBASE_SERVICE_ACCOUNT_KEY incomplete" }, 500);
    }

    const projectId = sa.project_id;
    const dbUrl = `https://${projectId}-default-rtdb.firebaseio.com`;
    const accessToken = await getAccessToken(sa);

    const body = await req.json();
    const { title, body: msgBody, image, icon, badge, data: extra, tokens: directTokens, userIds } = body;
    if (!title) return json({ error: "title required" }, 400);

    // ---- Resolve tokens ----
    let allTokens: string[] = [];

    if (Array.isArray(directTokens) && directTokens.length > 0) {
      allTokens = directTokens.filter(Boolean);
    } else if (Array.isArray(userIds) && userIds.length > 0) {
      const allFcm = await fetchRTDB(`${dbUrl}/fcmTokens`, accessToken);
      if (allFcm) {
        const keys = new Set<string>();
        userIds.forEach((uid: string) => {
          keys.add(uid);
          if (uid.includes("@") || uid.includes(",")) keys.add(uid.replace(/\./g, ","));
        });
        try {
          const users = await fetchRTDB(`${dbUrl}/users`, accessToken);
          if (users) {
            userIds.forEach((uid: string) => {
              const u = users[uid];
              if (u?.email) keys.add(u.email.replace(/\./g, ","));
              if (u?.id) keys.add(u.id);
            });
          }
        } catch {}

        keys.forEach((k) => {
          if (allFcm[k]) allTokens.push(...extractTokens(allFcm[k]));
        });
      }
    }

    allTokens = [...new Set(allTokens)];
    if (allTokens.length === 0) {
      return json({ ok: true, totalTokens: 0, success: 0, failed: 0, invalidRemoved: 0 });
    }

    // ---- Build payload ----
    const notification = { title, body: msgBody || "", image: image || undefined };
    const dataPayload: Record<string, string> = {};
    if (extra && typeof extra === "object") {
      Object.entries(extra).forEach(([k, v]) => { dataPayload[k] = v == null ? "" : String(v); });
    }

    // ---- Send in batches of 25 concurrently ----
    const BATCH = 25;
    let success = 0, failed = 0;
    const invalidTokens: string[] = [];
    const failReasons = { invalid: 0, transient: 0, other: 0 };

    for (let i = 0; i < allTokens.length; i += BATCH) {
      const batch = allTokens.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((t) => sendOne(accessToken, projectId, t, notification, dataPayload, { icon, badge }))
      );
      results.forEach((r, idx) => {
        if (r.ok) { success++; }
        else {
          failed++;
          if (r.invalid) { failReasons.invalid++; invalidTokens.push(batch[idx]); }
          else if (r.error?.includes("UNAVAILABLE") || r.error?.includes("INTERNAL")) { failReasons.transient++; }
          else { failReasons.other++; }
        }
      });
    }

    // ---- Cleanup invalid tokens ----
    let invalidRemoved = 0;
    if (invalidTokens.length > 0) {
      try {
        const allFcm = await fetchRTDB(`${dbUrl}/fcmTokens`, accessToken);
        const badSet = new Set(invalidTokens);
        const patches: Record<string, null> = {};
        if (allFcm) {
          Object.entries(allFcm).forEach(([uid, ut]: any) => {
            if (ut && typeof ut === "object") {
              Object.entries(ut).forEach(([tk, e]: any) => {
                if (e?.token && badSet.has(e.token)) patches[`${uid}/${tk}`] = null;
              });
            }
          });
        }
        if (Object.keys(patches).length > 0) {
          await patchRTDB(`${dbUrl}/fcmTokens`, accessToken, patches);
          invalidRemoved = Object.keys(patches).length;
        }
      } catch (e) { console.error("Cleanup error:", e); }
    }

    return json({
      ok: true, totalTokens: allTokens.length, success, failed,
      invalidRemoved, invalidTokens: invalidTokens.slice(0, 10), failReasons,
    });
  } catch (err: any) {
    console.error("send-fcm error:", err);
    return json({ error: err?.message || "Internal error", detail: String(err).substring(0, 200) }, 500);
  }
});
