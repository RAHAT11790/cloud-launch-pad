import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InlineButton = { text: string; url: string };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const buildKeyboard = (buttons: InlineButton[]) => ({
  inline_keyboard: buttons
    .filter((btn) => btn?.text && btn?.url)
    .map((btn) => [{ text: btn.text, url: btn.url }]),
});

async function deleteMessage(botToken: string, chatId: number | string, messageId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {}
}

// ========== /start WELCOME MESSAGE ==========
async function sendStartMessage(botToken: string, chatId: number | string, firstName: string) {
  const telegramBase = `https://api.telegram.org/bot${botToken}`;

  const siteName = "RS ANIME";
  const siteUrl = "https://rsanime03.lovable.app";
  const channelUrl = "https://t.me/cartoonfunny03";
  const channelName = "@CARTOONFUNNY03";
  const siteIcon = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";

  const welcomeText = `
🎌 <b>Welcome to ${siteName}!</b>

━━━━━━━━━━━━━━━━━━

Hey <b>${firstName}</b>! 👋

🌟 <b>${siteName}</b> is your ultimate destination for watching anime series & movies — completely free!

━━━━━━━━━━━━━━━━━━

📺 <b>What We Offer:</b>

  ✅ 1000+ Anime Series & Movies
  ✅ Hindi Dubbed & Subbed
  ✅ HD Quality Streaming
  ✅ Daily New Episode Updates
  ✅ Fast & Smooth Player
  ✅ No Ads — Premium Experience

━━━━━━━━━━━━━━━━━━

📢 <b>Join Our Channel:</b> ${channelName}
🔔 Stay updated with latest releases!

━━━━━━━━━━━━━━━━━━

🎬 Tap <b>Free Access</b> on any post to unlock 24h access instantly!
`.trim();

  const keyboard = {
    inline_keyboard: [
      [{ text: "🌐 Visit Website", url: siteUrl }],
      [{ text: "📢 Join Channel", url: channelUrl }],
      [{ text: "🎬 Latest Releases", url: `${siteUrl}/#new-releases` }],
    ],
  };

  try {
    const photoRes = await fetch(`${telegramBase}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: siteIcon,
        caption: welcomeText,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    });
    const photoData = await photoRes.json();
    if (photoRes.ok && photoData?.ok) return photoData;
  } catch (_) {}

  const res = await fetch(`${telegramBase}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: welcomeText,
      parse_mode: "HTML",
      reply_markup: keyboard,
    }),
  });
  return await res.json();
}

async function getBotUsername(botToken: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const d = await r.json();
    return d?.result?.username || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  if (req.method === "GET")
    return json({ ok: true, service: "telegram-post", actions: ["send", "edit-buttons", "webhook", "set-webhook", "create-unlock-link"] });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const body = await req.json();
    if (body?.test === true) return json({ ok: true, ping: "telegram-post" });
    const action = String(body?.action || "send");
    const telegramBase = `https://api.telegram.org/bot${botToken}`;

    // ========== AUTO-DETECT TELEGRAM WEBHOOK (update_id present = from Telegram) ==========
    if (body?.update_id !== undefined) {
      const message = body?.message;
      const text = String(message?.text || "");
      if (text.startsWith("/start")) {
        const chatId = message.chat.id;
        const firstName = message.from?.first_name || "Friend";
        const tgUserId = message.from?.id;
        const m = text.match(/^\/start\s+unlock_(.+)$/);
        if (m && m[1]) {
          await handleUnlockDeepLink(botToken, chatId, m[1].trim(), tgUserId);
        } else {
          await sendStartMessage(botToken, chatId, firstName);
        }
      }
      return json({ ok: true });
    }

    // ========== MANUAL WEBHOOK (from admin panel) ==========
    if (action === "webhook") {
      const update = body?.update;
      if (!update) return json({ ok: true, skipped: true });
      const message = update?.message;
      const text = String(message?.text || "");
      if (text.startsWith("/start")) {
        const chatId = message.chat.id;
        const firstName = message.from?.first_name || "Friend";
        const tgUserId = message.from?.id;
        const m = text.match(/^\/start\s+unlock_(.+)$/);
        if (m && m[1]) {
          await handleUnlockDeepLink(botToken, chatId, m[1].trim(), tgUserId);
        } else {
          await sendStartMessage(botToken, chatId, firstName);
        }
      }
      return json({ ok: true });
    }

    // ========== CREATE UNLOCK LINK (called from website "Verify" button) ==========
    if (action === "create-unlock-link") {
      const userId = String(body?.userId || "").trim();
      if (!userId) return json({ error: "userId required" }, 400);
      const username = await getBotUsername(botToken);
      if (!username) return json({ error: "Could not resolve bot username" }, 500);
      const deepLink = `https://t.me/${username}?start=unlock_${encodeURIComponent(userId)}`;
      return json({ ok: true, deepLink, botUsername: username });
    }

    // ========== CLAIM ACCESS CODE (paste-token flow from website player) ==========
    if (action === "claim-access-code") {
      const code = String(body?.code || "").trim().toUpperCase();
      const userId = String(body?.userId || "").trim();
      if (!code || !userId) return json({ ok: false, error: "code & userId required" }, 400);
      const rec = await fbGet(`accessCodes/${code}`);
      if (!rec) return json({ ok: false, error: "invalid_code" }, 400);
      if (rec.consumed) return json({ ok: false, error: "already_used" }, 400);
      if (Number(rec.expiresAt || 0) < Date.now()) return json({ ok: false, error: "expired" }, 400);
      if (rec.ownerUserId && rec.ownerUserId !== userId) return json({ ok: false, error: "not_owner" }, 400);
      const grantMs = Number(rec.grantMs) > 0 ? Number(rec.grantMs) : 24 * 3600_000;
      const expiresAt = Date.now() + grantMs;
      await fbPut(`accessCodes/${code}`, {
        ...rec, consumed: true, status: "claimed",
        claimedByUserId: userId, claimedAt: Date.now(),
      });
      // Mirror to user freeAccess
      await fbPut(`users/${userId}/freeAccess`, {
        active: true,
        grantedAt: Date.now(),
        expiresAt,
        viaCode: code,
        source: "telegram_bot_token",
      });
      return json({ ok: true, durationMs: grantMs, expiresAt });
    }

    // ========== GENERIC SHORTENER (multi-site) ==========
    // body: { url, site, apiKey } – uses any "*.*/api?api=KEY&url=..." style endpoint
    if (action === "shorten-with-config") {
      const target = String(body?.url || "").trim();
      const site = String(body?.site || "").trim().replace(/\/+$/, "");
      const apiKey = String(body?.apiKey || "").trim();
      if (!target || !site || !apiKey) return json({ ok: false, error: "url, site, apiKey required" }, 400);
      try {
        const apiUrl = `${site}/api?api=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(target)}`;
        const r = await fetch(apiUrl);
        const d = await r.json().catch(() => ({}));
        if (d?.shortenedUrl) return json({ ok: true, shortenedUrl: d.shortenedUrl });
        return json({ ok: false, error: "shorten_failed", details: d }, 400);
      } catch (e: any) {
        return json({ ok: false, error: e?.message || "shorten_error" }, 500);
      }
    }

    if (action === "set-webhook") {
      const webhookUrl = String(body?.webhookUrl || "").trim();
      if (!webhookUrl) return json({ error: "webhookUrl required" }, 400);

      const res = await fetch(`${telegramBase}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message"],
        }),
      });
      const data = await res.json();
      if (!data?.ok && String(data?.description || "").toLowerCase().includes("unauthorized")) {
        return json({ ok: false, error: "Telegram bot token unauthorized", details: data?.description || "Unauthorized" }, 400);
      }
      return json(data);
    }

    if (action === "delete-webhook") {
      const res = await fetch(`${telegramBase}/deleteWebhook`, { method: "POST" });
      const data = await res.json();
      if (!data?.ok && String(data?.description || "").toLowerCase().includes("unauthorized")) {
        return json({ ok: false, error: "Telegram bot token unauthorized", details: data?.description || "Unauthorized" }, 400);
      }
      return json(data);
    }

    if (action === "webhook-info") {
      const res = await fetch(`${telegramBase}/getWebhookInfo`);
      const data = await res.json();
      if (!data?.ok && String(data?.description || "").toLowerCase().includes("unauthorized")) {
        return json({ ok: false, error: "Telegram bot token unauthorized", details: data?.description || "Unauthorized" }, 400);
      }
      return json(data);
    }

    if (action === "get-bot-username") {
      const username = await getBotUsername(botToken);
      return json({ ok: !!username, username });
    }

    // ========== EDIT BUTTONS ==========
    if (action === "edit-buttons") {
      const chatId = body?.chatId;
      const messageId = body?.messageId;
      const inlineButtons: InlineButton[] = Array.isArray(body?.inlineButtons) ? body.inlineButtons : [];

      if (!chatId || !messageId || inlineButtons.length === 0) {
        return json({ error: "chatId, messageId, inlineButtons required" }, 400);
      }

      const res = await fetch(`${telegramBase}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: buildKeyboard(inlineButtons),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok)
        return json({ error: data?.description || "Telegram API error" }, 400);
      return json({ ok: true, result: data.result });
    }

    // ========== SEND POST ==========
    // Resolve a default chatId from settings/telegramChatId if not provided
    let chatId = body?.chatId;
    if (!chatId) {
      try {
        const r = await fetch(`${FIREBASE_DB}/settings/telegramChatId.json`);
        const v = await r.json().catch(() => null);
        if (v) chatId = v;
      } catch {}
    }
    if (!chatId) return json({ error: "chatId required (set settings/telegramChatId in Firebase or pass chatId in body)" }, 400);

    const caption = String(body?.caption || "");
    const photoUrl = String(body?.photoUrl || "").trim();
    const buttonText = String(body?.buttonText || "").trim();
    const buttonUrl = String(body?.buttonUrl || "").trim();
    const extraInlineButtons: InlineButton[] = Array.isArray(body?.inlineButtons) ? body.inlineButtons : [];
    // Free Access button is now OPTIONAL — default OFF (admin can opt in per call)
    const includeFreeAccess = body?.includeFreeAccess === true;
    const freeAccessUserId = String(body?.freeAccessUserId || "guest").trim() || "guest";
    const collection = String(body?.collection || "").trim();
    const seriesId = String(body?.seriesId || "").trim();

    const buttons: InlineButton[] = [];
    if (buttonText && buttonUrl) buttons.push({ text: buttonText, url: buttonUrl });
    extraInlineButtons.forEach((btn: any) => {
      if (btn?.text && btn?.url) buttons.push({ text: String(btn.text), url: String(btn.url) });
    });

    // 🆕 Auto-attach per-series custom button (saved at <collection>/<seriesId>/telegramCustomButton)
    if (collection && seriesId && buttons.length === 0) {
      try {
        const r = await fetch(`${FIREBASE_DB}/${collection}/${seriesId}/telegramCustomButton.json`);
        const cb = await r.json().catch(() => null);
        if (cb?.text && cb?.url) buttons.push({ text: String(cb.text), url: String(cb.url) });
      } catch {}
    }

    // ✨ Auto-attach Free Access button when global toggle is enabled
    let autoIncludeFA = false;
    let autoFAHours = 24;
    let autoFALabel = "🔓 𝐅𝐫𝐞𝐞 𝐀𝐜𝐜𝐞𝐬𝐬";
    try {
      const cfg = await fbGet("settings/telegramFreeAccess");
      if (cfg && cfg.enabled === true) {
        autoIncludeFA = true;
        autoFAHours = Number(cfg.hours) > 0 ? Number(cfg.hours) : 24;
        autoFALabel = String(cfg.label || `🔓 Free Access (${autoFAHours}h)`);
      }
    } catch {}

    if ((includeFreeAccess || autoIncludeFA)) {
      const username = await getBotUsername(botToken);
      if (username) {
        const label = includeFreeAccess
          ? "🔓 𝐅𝐫𝐞𝐞 𝐀𝐜𝐜𝐞𝐬𝐬 (𝟐𝟒𝐡)"
          : autoFALabel;
        buttons.push({
          text: label,
          url: `https://t.me/${username}?start=unlock_${encodeURIComponent(freeAccessUserId)}`,
        });
      }
    }

    const payloadBase: Record<string, unknown> = {
      chat_id: chatId,
      parse_mode: "HTML",
    };
    if (buttons.length > 0) payloadBase.reply_markup = buildKeyboard(buttons);

    const endpoint = photoUrl ? "sendPhoto" : "sendMessage";
    const payload = photoUrl
      ? { ...payloadBase, photo: photoUrl, caption }
      : { ...payloadBase, text: caption };

    const res = await fetch(`${telegramBase}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok)
      return json({ error: data?.description || "Telegram API error" }, 400);

    return json({ ok: true, message_id: data?.result?.message_id, result: data.result });
  } catch (err: any) {
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
