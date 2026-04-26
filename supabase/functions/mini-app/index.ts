// Mini App backend: handles unlock grant + API key validation + URL shortening
// Endpoints (action-based POST):
//   { action: "visit", source }
//   { action: "validate-key", apiKey }
//   { action: "grant", userId, source, apiKey?, shortId? }
//   { action: "shorten", apiKey, url } -> returns short URL (used by external bots like a link-shortener)
//   { action: "resolve", shortId } -> returns destination URL + apiKey owner
//   { action: "create-fallback-token", userId } -> creates a one-time unlock token for browser fallback
//   { action: "setup-bot", miniUrl } -> sets bot menu button
//   { action: "stats" }
//
// FIREBASE structure:
//   miniApp/stats/{visits, completes, apiCompletes, ...}
//   miniApp/apiKeys/{keyId}: { key, label, redirectUrl, enabled, createdAt, uses, lastUsedAt }
//   miniApp/shortLinks/{shortId}: { dest, apiKey, createdAt, hits, completes }
//   miniApp/fallbackTokens/{token}: { userId, createdAt, expiresAt, consumed }
//   users/{uid}/freeAccess: { active, grantedAt, expiresAt, viaToken: 'mini-app' }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const FB_URL =
  Deno.env.get("FIREBASE_DB_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";

async function fbGet(path: string) {
  const r = await fetch(`${FB_URL}/${path}.json`);
  if (!r.ok) return null;
  return await r.json();
}
async function fbPut(path: string, value: unknown) {
  await fetch(`${FB_URL}/${path}.json`, {
    method: "PUT",
    body: JSON.stringify(value),
  });
}
async function fbPatch(path: string, value: unknown) {
  await fetch(`${FB_URL}/${path}.json`, {
    method: "PATCH",
    body: JSON.stringify(value),
  });
}

async function incCounter(path: string, by = 1) {
  const cur = (await fbGet(path)) || 0;
  const next = (typeof cur === "number" ? cur : 0) + by;
  await fbPut(path, next);
  return next;
}

const randomId = (len = 8) =>
  Array.from({ length: len }, () =>
    "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]
  ).join("");

// Find a key entry by its key string
async function findApiKey(key: string): Promise<{ id: string; entry: any } | null> {
  const all = (await fbGet("miniApp/apiKeys")) || {};
  for (const id of Object.keys(all)) {
    if (all[id]?.key === key && all[id]?.enabled !== false) {
      return { id, entry: all[id] };
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const todayKey = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    if (action === "visit") {
      await incCounter("miniApp/stats/visits");
      await incCounter(`miniApp/stats/daily/${todayKey}/visits`);
      const src = String(body?.source || "default");
      await incCounter(`miniApp/stats/visitsBySource/${src}`);
      return json({ ok: true });
    }

    if (action === "user-info") {
      const userId = String(body?.userId || "").trim();
      if (!userId) return json({ ok: false, error: "no_user" }, 400);
      const u = await fbGet(`users/${userId}`);
      if (!u) return json({ ok: false, error: "not_found" }, 404);
      const fa = u.freeAccess || {};
      return json({
        ok: true,
        user: {
          id: userId,
          name: u.name || u.displayName || "User",
          email: u.email || "",
          photoURL: u.photoURL || u.photo || u.avatar || "",
        },
        freeAccess: {
          active: !!(fa.active && Number(fa.expiresAt || 0) > Date.now()),
          expiresAt: Number(fa.expiresAt || 0),
        },
      });
    }

    if (action === "validate-key") {
      const key = String(body?.apiKey || "").trim();
      if (!key) return json({ ok: false, error: "no_key" }, 400);
      const found = await findApiKey(key);
      if (!found) return json({ ok: false, error: "invalid_key" }, 401);
      return json({
        ok: true,
        label: found.entry.label || "External",
        redirectUrl: found.entry.redirectUrl || "",
      });
    }

    // External bots use this like a URL shortener.
    if (action === "shorten") {
      const key = String(body?.apiKey || "").trim();
      const url = String(body?.url || "").trim();
      if (!key) return json({ ok: false, error: "no_key" }, 400);
      if (!url || !/^https?:\/\//i.test(url))
        return json({ ok: false, error: "invalid_url" }, 400);

      const found = await findApiKey(key);
      if (!found) return json({ ok: false, error: "invalid_key" }, 401);

      const shortId = randomId(8);
      await fbPut(`miniApp/shortLinks/${shortId}`, {
        dest: url,
        apiKey: key,
        keyId: found.id,
        label: found.entry.label || "",
        createdAt: Date.now(),
        hits: 0,
        completes: 0,
      });

      // Build the public mini-app URL — the caller (admin UI) will know the origin.
      // We return shortId so caller can construct: <origin>/mini?s=<shortId>
      return json({ ok: true, shortId });
    }

    if (action === "resolve") {
      const shortId = String(body?.shortId || "").trim();
      if (!shortId) return json({ ok: false, error: "no_id" }, 400);
      const entry = await fbGet(`miniApp/shortLinks/${shortId}`);
      if (!entry) return json({ ok: false, error: "not_found" }, 404);
      // increment hit counter
      await fbPatch(`miniApp/shortLinks/${shortId}`, {
        hits: (entry.hits || 0) + 1,
      });
      return json({
        ok: true,
        dest: entry.dest,
        label: entry.label || "External",
        // We do NOT return the raw apiKey to the client; only that it's valid.
        hasKey: !!entry.apiKey,
      });
    }

    if (action === "create-fallback-token") {
      const userId = String(body?.userId || "").trim();
      if (!userId) return json({ ok: false, error: "no_user" }, 400);
      const token = `fb_${randomId(10)}${Date.now().toString(36)}`;
      const now = Date.now();
      await fbPut(`miniApp/fallbackTokens/${token}`, {
        userId,
        createdAt: now,
        expiresAt: now + 30 * 60 * 1000, // 30 min validity
        consumed: false,
      });
      return json({ ok: true, token });
    }

    if (action === "grant") {
      const userId = String(body?.userId || "").trim();
      const source = String(body?.source || "site").trim(); // 'site' | 'api' | 'short'
      const apiKey = String(body?.apiKey || "").trim();
      const shortId = String(body?.shortId || "").trim();
      if (!userId) return json({ ok: false, error: "no_user" }, 400);

      // ===== Short-link mode (external bot via /mini?s=ID) =====
      if (source === "short" && shortId) {
        const entry = await fbGet(`miniApp/shortLinks/${shortId}`);
        if (!entry) return json({ ok: false, error: "not_found" }, 404);
        await fbPatch(`miniApp/shortLinks/${shortId}`, {
          completes: (entry.completes || 0) + 1,
          lastUsedAt: Date.now(),
        });
        if (entry.keyId) {
          const keyData = await fbGet(`miniApp/apiKeys/${entry.keyId}`);
          await fbPatch(`miniApp/apiKeys/${entry.keyId}`, {
            uses: ((keyData?.uses) || 0) + 1,
            lastUsedAt: Date.now(),
          });
        }
        await incCounter("miniApp/stats/apiCompletes");
        await incCounter(`miniApp/stats/daily/${todayKey}/apiCompletes`);
        await incCounter(`miniApp/stats/daily/${todayKey}/completes`);
        return json({
          ok: true,
          mode: "short",
          dest: entry.dest,
          label: entry.label || "External",
        });
      }

      // ===== Direct API mode (legacy: /mini?key=...&user=...) =====
      if (source === "api") {
        if (!apiKey) return json({ ok: false, error: "no_key" }, 400);
        const found = await findApiKey(apiKey);
        if (!found) return json({ ok: false, error: "invalid_key" }, 401);

        await fbPatch(`miniApp/apiKeys/${found.id}`, {
          uses: (found.entry.uses || 0) + 1,
          lastUsedAt: Date.now(),
        });
        await incCounter("miniApp/stats/apiCompletes");
        await incCounter(`miniApp/stats/daily/${todayKey}/apiCompletes`);
        await incCounter(`miniApp/stats/daily/${todayKey}/completes`);
        await fbPut(`miniApp/apiCompletions/${found.id}/${userId}`, {
          completedAt: Date.now(),
          userId,
        });

        return json({
          ok: true,
          mode: "api",
          redirectUrl: found.entry.redirectUrl || "",
          label: found.entry.label || "External",
        });
      }

      // ===== Site mode: grant 24h access to userId =====
      const hoursSnap = await fbGet("settings/unlockDurationHours");
      const hours =
        typeof hoursSnap === "number" && hoursSnap > 0 ? hoursSnap : 24;
      const now = Date.now();
      const expiresAt = now + hours * 60 * 60 * 1000;

      await fbPut(`users/${userId}/freeAccess`, {
        active: true,
        grantedAt: now,
        expiresAt,
        viaToken: "mini-app",
        source: "telegram-mini-app",
      });

      await incCounter("miniApp/stats/completes");
      await incCounter(`miniApp/stats/daily/${todayKey}/completes`);
      await fbPut(`miniApp/completions/${userId}/${now}`, {
        userId,
        grantedAt: now,
        expiresAt,
      });

      // Also create a one-time fallback token for the user to paste in browser
      const token = `fb_${randomId(10)}${Date.now().toString(36)}`;
      await fbPut(`miniApp/fallbackTokens/${token}`, {
        userId,
        createdAt: now,
        expiresAt: now + 30 * 60 * 1000,
        consumed: false,
      });

      return json({ ok: true, mode: "site", expiresAt, fallbackToken: token });
    }

    if (action === "consume-fallback-token") {
      const token = String(body?.token || "").trim();
      if (!token) return json({ ok: false, error: "no_token" }, 400);
      const entry = await fbGet(`miniApp/fallbackTokens/${token}`);
      if (!entry) return json({ ok: false, error: "invalid" }, 404);
      if (entry.consumed) return json({ ok: false, error: "used" }, 410);
      if (Date.now() > Number(entry.expiresAt || 0))
        return json({ ok: false, error: "expired" }, 410);

      const userId = String(entry.userId || "");
      if (!userId) return json({ ok: false, error: "no_user" }, 500);

      const hoursSnap = await fbGet("settings/unlockDurationHours");
      const hours =
        typeof hoursSnap === "number" && hoursSnap > 0 ? hoursSnap : 24;
      const now = Date.now();
      const expiresAt = now + hours * 60 * 60 * 1000;

      await fbPut(`users/${userId}/freeAccess`, {
        active: true,
        grantedAt: now,
        expiresAt,
        viaToken: "mini-app-fallback",
        source: "telegram-mini-app-fallback",
      });
      await fbPatch(`miniApp/fallbackTokens/${token}`, {
        consumed: true,
        consumedAt: now,
      });

      return json({ ok: true, userId, expiresAt });
    }

    if (action === "setup-bot") {
      // Prefer the dedicated access bot token; fall back to main token.
      const token =
        Deno.env.get("RS_ACCESS_BOT_TOKEN") ||
        Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (!token) return json({ ok: false, error: "no_bot_token" }, 500);
      const miniUrl = String(body?.miniUrl || "").trim();
      if (!miniUrl) return json({ ok: false, error: "no_url" }, 400);
      const r = await fetch(
        `https://api.telegram.org/bot${token}/setChatMenuButton`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menu_button: {
              type: "web_app",
              text: "🎬 Get Access",
              web_app: { url: miniUrl },
            },
          }),
        },
      );
      const data = await r.json();
      return json({ ok: data?.ok === true, telegram: data });
    }

    if (action === "stats") {
      const stats = (await fbGet("miniApp/stats")) || {};
      const apiKeys = (await fbGet("miniApp/apiKeys")) || {};
      return json({ ok: true, stats, apiKeys });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "internal" }, 500);
  }
});
