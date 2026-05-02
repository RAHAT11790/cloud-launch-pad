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

async function sendTelegramUnlockMessage(userId: string, options: { dest?: string; expiresAt?: number; label?: string }) {
  if (!/^tg_\d+$/.test(userId)) return null;

  const session = (await fbGet(`miniApp/sessions/${userId}`)) || {};
  const profile = (await fbGet(`miniApp/telegramUsers/${userId}`)) || {};
  const chatId = session?.chatId || profile?.chatId;
  const botUsername = String(
    session?.botUsername ||
      (await fbGet("settings/telegramMiniBotUsername")) ||
      "RS_ANIME_ACCESS_BOT",
  ).replace(/^@/, "");
  const token = Deno.env.get("RS_ACCESS_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");

  if (!token || !chatId) {
    return { botUrl: botUsername ? `https://t.me/${botUsername}` : "" };
  }

  const firstName = String(profile?.firstName || session?.firstName || "Friend");
  const fullName = String(profile?.fullName || session?.fullName || firstName || "Friend");
  const username = String(profile?.username || session?.username || "");
  const photo = String(profile?.photoFileId || session?.photoFileId || "").trim();
  const expiresAt = Number(options.expiresAt || Date.now() + 24 * 60 * 60 * 1000);
  const expiresText = new Date(expiresAt).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const caption = [
    `🎉 <b>Welcome ${fullName.replace(/[<>]/g, "")}</b>`,
    "",
    "✅ <b>24 Hours Access Unlocked</b>",
    `🕒 Valid until: <b>${expiresText}</b>`,
    username ? `👤 Username: @${username.replace(/[<>]/g, "")}` : `🆔 User: <b>${userId}</b>`,
    options.label ? `🔓 Source: <b>${String(options.label).replace(/[<>]/g, "")}</b>` : "",
    options.dest ? "\nTap the button below to open your unlocked link." : "\nআপনার access verify হয়ে গেছে। এখন bot থেকেই continue করতে পারবেন।",
  ].filter(Boolean).join("\n");

  const reply_markup = options.dest
    ? { inline_keyboard: [[{ text: "🔓 Open Link", url: options.dest }]] }
    : undefined;

  const endpoint = photo ? "sendPhoto" : "sendMessage";
  const payload: Record<string, unknown> = photo
    ? {
        chat_id: chatId,
        photo,
        caption,
        parse_mode: "HTML",
        reply_markup,
      }
    : {
        chat_id: chatId,
        text: caption,
        parse_mode: "HTML",
        reply_markup,
      };

  const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  const messageId = data?.result?.message_id;

  if (messageId) {
    setTimeout(() => {
      fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      }).catch(() => {});
    }, 30000);
  }

  return {
    botUrl: botUsername ? `https://t.me/${botUsername}` : "",
    sent: !!messageId,
  };
}

// Notify the Link Share Bot so it can push welcome auto (no /start needed).
async function notifyLinkShareBot(userId: string) {
  if (!/^tg_\d+$/.test(userId)) return;
  const tg_id = Number(userId.replace("tg_", ""));
  const url =
    Deno.env.get("LINK_SHARE_BOT_NOTIFY_URL") ||
    "https://kqxpzqegtvaiwgdusrin.supabase.co/functions/v1/link-share-bot/notify";
  const secret =
    Deno.env.get("LINK_SHARE_NOTIFY_SECRET") ||
    Deno.env.get("RS_API_KEY") ||
    "";
  if (!secret) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-notify-secret": secret },
      body: JSON.stringify({ user_id: tg_id, secret }),
    });
  } catch (e) {
    console.error("[notifyLinkShareBot]", e);
  }
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
      if (/^tg_\d+$/.test(userId)) {
        const tgNumeric = userId.replace(/^tg_/, "");
        const tgu =
          (await fbGet(`miniApp/telegramUsers/${userId}`)) ||
          (await fbGet(`miniApp/sessions/${userId}`)) ||
          (await fbGet(`linkShareBot/users/${tgNumeric}`)) ||
          null;
        if (!tgu) return json({ ok: false, error: "not_found" }, 404);
        return json({
          ok: true,
          user: {
            id: userId,
            name: tgu.fullName || tgu.firstName || tgu.name || "Telegram User",
            email: "",
            photoURL: tgu.photoURL || tgu.photoFilePath || tgu.photo_url || "",
            username: tgu.username || "",
          },
          freeAccess: {
            active: false,
            expiresAt: 0,
          },
        });
      }
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
      const tierId = String(body?.tierId || "").trim();
      if (!userId) return json({ ok: false, error: "no_user" }, 400);

      // Resolve tier (admin-configured): { adsRequired, hours, label, enabled }
      // Tier is the SOURCE OF TRUTH for hours when provided & enabled.
      let tierHours: number | null = null;
      let tierLabel = "";
      if (tierId) {
        const tier = await fbGet(`miniApp/unlockTiers/${tierId}`);
        if (tier && tier.enabled !== false) {
          const h = Number(tier.hours);
          if (h > 0) tierHours = h;
          tierLabel = String(tier.label || "");
        }
      }
      const fallbackHoursSnap = await fbGet("settings/unlockDurationHours");
      const fallbackHours =
        typeof fallbackHoursSnap === "number" && fallbackHoursSnap > 0
          ? fallbackHoursSnap
          : 24;
      const grantHours = tierHours ?? fallbackHours;

      // ===== Short-link mode (external bot via /mini?s=ID) =====
      if (source === "short" && shortId) {
        const entry = await fbGet(`miniApp/shortLinks/${shortId}`);
        if (!entry) return json({ ok: false, error: "not_found" }, 404);
        const expiresAt = Date.now() + grantHours * 60 * 60 * 1000;
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
        const botResult = await sendTelegramUnlockMessage(userId, {
          dest: entry.dest,
          expiresAt,
          label: tierLabel || entry.label || "External",
        });
        notifyLinkShareBot(userId).catch(() => {});
        return json({
          ok: true,
          mode: "short",
          dest: entry.dest,
          label: entry.label || "External",
          botUrl: botResult?.botUrl || "",
          hours: grantHours,
          expiresAt,
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
        const botResult = await sendTelegramUnlockMessage(userId, {
          dest: found.entry.redirectUrl || "",
          expiresAt: Date.now() + grantHours * 60 * 60 * 1000,
          label: tierLabel || found.entry.label || "External",
        });
        notifyLinkShareBot(userId).catch(() => {});

        return json({
          ok: true,
          mode: "api",
          redirectUrl: found.entry.redirectUrl || "",
          label: found.entry.label || "External",
          botUrl: botResult?.botUrl || "",
          hours: grantHours,
        });
      }

      // ===== Site mode: grant access to userId using selected tier hours =====
      const now = Date.now();
      const expiresAt = now + grantHours * 60 * 60 * 1000;

      await fbPut(`users/${userId}/freeAccess`, {
        active: true,
        grantedAt: now,
        expiresAt,
        viaToken: "mini-app",
        source: "telegram-mini-app",
        tierId: tierId || null,
        tierLabel: tierLabel || null,
      });

      // Also mirror into freeAccessUsers/{userId} so Admin panel sees Mini App users
      try {
        const uSnap = await fbGet(`users/${userId}`);
        const uName = uSnap?.name || uSnap?.username || `Telegram ${userId}`;
        const uEmail = uSnap?.email || "";
        await fbPut(`freeAccessUsers/${userId}`, {
          userId,
          name: uName,
          email: uEmail,
          unlockedAt: now,
          expiresAt,
          prizeHours: grantHours,
          prizeMinutes: 0,
          mode: "miniapp",
          source: "telegram-mini-app",
          tierLabel: tierLabel || null,
        });
      } catch (_) {}

      await incCounter("miniApp/stats/completes");
      await incCounter(`miniApp/stats/daily/${todayKey}/completes`);
      await fbPut(`miniApp/completions/${userId}/${now}`, {
        userId,
        grantedAt: now,
        expiresAt,
        tierId: tierId || null,
      });

      // Also create a one-time fallback token for the user to paste in browser
      const token = `fb_${randomId(10)}${Date.now().toString(36)}`;
      await fbPut(`miniApp/fallbackTokens/${token}`, {
        userId,
        createdAt: now,
        expiresAt: now + 30 * 60 * 1000,
        consumed: false,
        grantHours,
        tierId: tierId || null,
      });

      const botResult = await sendTelegramUnlockMessage(userId, {
        expiresAt,
        label: tierLabel || "RS ANIME",
      });
      notifyLinkShareBot(userId).catch(() => {});

      return json({ ok: true, mode: "site", expiresAt, hours: grantHours, fallbackToken: token, botUrl: botResult?.botUrl || "" });
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

      // Use the saved tier hours from the token (so fallback honours selected tier)
      let hours = Number(entry.grantHours);
      if (!(hours > 0)) {
        const hoursSnap = await fbGet("settings/unlockDurationHours");
        hours = typeof hoursSnap === "number" && hoursSnap > 0 ? hoursSnap : 24;
      }
      const now = Date.now();
      const expiresAt = now + hours * 60 * 60 * 1000;

      await fbPut(`users/${userId}/freeAccess`, {
        active: true,
        grantedAt: now,
        expiresAt,
        viaToken: "mini-app-fallback",
        source: "telegram-mini-app-fallback",
      });
      // Mirror into freeAccessUsers/{userId}
      try {
        const uSnap = await fbGet(`users/${userId}`);
        const uName = uSnap?.name || uSnap?.username || `Telegram ${userId}`;
        const uEmail = uSnap?.email || "";
        await fbPut(`freeAccessUsers/${userId}`, {
          userId,
          name: uName,
          email: uEmail,
          unlockedAt: now,
          expiresAt,
          prizeHours: hours,
          prizeMinutes: 0,
          mode: "miniapp",
          source: "telegram-mini-app-fallback",
        });
      } catch (_) {}
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
