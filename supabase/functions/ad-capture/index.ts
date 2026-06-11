import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const FIREBASE_DB_URL =
  Deno.env.get("FIREBASE_DB_URL") || "https://rs-anime-default-rtdb.firebaseio.com";
const FIREBASE_SA_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "";

let _accessToken: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function getFirebaseToken(): Promise<string> {
  if (_accessToken && _accessToken.exp > Date.now() + 60_000) return _accessToken.token;
  if (!FIREBASE_SA_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing");
  const sa = JSON.parse(FIREBASE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = new TextEncoder();
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claim)))}`;
  const keyDer = pemToDer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson?.access_token) throw new Error("Failed to get Firebase token");
  _accessToken = { token: tokenJson.access_token, exp: Date.now() + ((tokenJson.expires_in || 3600) - 60) * 1000 };
  return _accessToken.token;
}

async function fb(method: "GET" | "PUT" | "PATCH", path: string, body?: any) {
  const token = await getFirebaseToken();
  const url = `${FIREBASE_DB_URL}/${path}.json?access_token=${token}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase ${method} ${path} failed: ${res.status} ${text}`);
  }
  return await res.json().catch(() => null);
}

const dateKey = () => new Date().toISOString().slice(0, 10);

async function incrementStat(path: string) {
  const current = await fb("GET", path).catch(() => 0);
  const next = Number(current || 0) + 1;
  await fb("PUT", path, next);
  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    const kind = String(new URL(req.url).searchParams.get("kind") || "all");
    const today = dateKey();
    const stats = await fb("GET", `adsterraStats/${today}`).catch(() => ({}));
    return new Response(JSON.stringify({ ok: true, service: "ad-capture", kind, today, stats: stats || {} }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json().catch(() => ({} as any));
    const kind = String(body?.kind || "");
    const phase = String(body?.phase || "click");
    const result = String(body?.result || "ok");
    const userId = String(body?.userId || "anon").trim() || "anon";
    if (kind !== "popunder" && kind !== "social") {
      return new Response(JSON.stringify({ ok: false, error: "bad kind" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const today = dateKey();
    const root = `adsterraStats/${today}/${kind}`;
    const clickCount = await incrementStat(`${root}/clicks`).catch(() => 0);
    if (phase === "load") await incrementStat(`${root}/loads`).catch(() => 0);
    let accepted = false;
    if (result === "ok") {
      accepted = true;
      await incrementStat(`${root}/accepted`).catch(() => 0);
      await fb("PUT", `adsterraUsers/${userId}/${kind}`, {
        cooldownUntil: Date.now() + Math.max(0, Number(body?.cooldownMs || 0)),
        lastUrl: String(body?.url || "").slice(0, 500),
        lastOkAt: Date.now(),
      }).catch(() => null);
    } else {
      await incrementStat(`${root}/rejected`).catch(() => 0);
    }
    await fb("PATCH", `${root}/lastEvent`, {
      at: Date.now(),
      url: String(body?.url || "").slice(0, 500),
      result,
      phase,
      userId,
    }).catch(() => null);
    try {
      console.log("[ad-capture]", JSON.stringify({
        kind,
        phase,
        result,
        url: String(body?.url || "").slice(0, 200),
        cycle: body?.cycle ?? null,
        userId,
        ts: Date.now(),
      }));
    } catch {}
    return new Response(JSON.stringify({ ok: accepted, accepted, kind, phase, result, clickCount, ts: Date.now() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
