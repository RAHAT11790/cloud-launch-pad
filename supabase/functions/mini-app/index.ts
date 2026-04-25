// Mini App backend: handles unlock grant + API key validation for Telegram Mini App
// Endpoints:
//   POST /  { action: "grant", userId, source?, apiKey?, redirect? }
//   POST /  { action: "validate-key", apiKey }
//   POST /  { action: "stats" }   (admin-style read)
//
// FIREBASE structure:
//   miniApp/stats/{visits, completes, grantsBySource}
//   miniApp/apiKeys/{keyId}: { key, label, redirectUrl, enabled, createdAt, uses, lastUsedAt }
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "visit") {
      // mini app opened
      await incCounter("miniApp/stats/visits");
      const src = String(body?.source || "default");
      await incCounter(`miniApp/stats/visitsBySource/${src}`);
      return json({ ok: true });
    }

    if (action === "validate-key") {
      const key = String(body?.apiKey || "").trim();
      if (!key) return json({ ok: false, error: "no_key" }, 400);
      const all = (await fbGet("miniApp/apiKeys")) || {};
      const entry = Object.values(all).find(
        (k: any) => k && k.key === key && k.enabled !== false,
      ) as any;
      if (!entry) return json({ ok: false, error: "invalid_key" }, 401);
      return json({
        ok: true,
        label: entry.label || "External",
        redirectUrl: entry.redirectUrl || "",
      });
    }

    if (action === "grant") {
      const userId = String(body?.userId || "").trim();
      const source = String(body?.source || "site").trim(); // 'site' | 'api'
      const apiKey = String(body?.apiKey || "").trim();
      if (!userId) return json({ ok: false, error: "no_user" }, 400);

      // ===== External API mode =====
      if (source === "api") {
        if (!apiKey) return json({ ok: false, error: "no_key" }, 400);
        const all = (await fbGet("miniApp/apiKeys")) || {};
        const keyId = Object.keys(all).find(
          (id) => all[id]?.key === apiKey && all[id]?.enabled !== false,
        );
        if (!keyId) return json({ ok: false, error: "invalid_key" }, 401);
        const entry = all[keyId];

        // Record completion under the key's own bucket — DO NOT touch site freeAccess
        await fbPatch(`miniApp/apiKeys/${keyId}`, {
          uses: (entry.uses || 0) + 1,
          lastUsedAt: Date.now(),
        });
        await incCounter("miniApp/stats/apiCompletes");
        await fbPut(`miniApp/apiCompletions/${keyId}/${userId}`, {
          completedAt: Date.now(),
          userId,
        });

        return json({
          ok: true,
          mode: "api",
          redirectUrl: entry.redirectUrl || "",
          label: entry.label || "External",
        });
      }

      // ===== Site mode: grant 24h access =====
      // Get configured duration
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
      await fbPut(`miniApp/completions/${userId}/${now}`, {
        userId,
        grantedAt: now,
        expiresAt,
      });

      return json({ ok: true, mode: "site", expiresAt });
    }

    // Telegram Bot setup: register mini app menu button
    if (action === "setup-bot") {
      const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
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
