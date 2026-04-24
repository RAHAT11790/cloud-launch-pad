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

// ====== Site / Firebase / Shortener config (for bot unlock flow) ======
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://rsanime03.lovable.app";
const FIREBASE_DB =
  Deno.env.get("FIREBASE_DATABASE_URL") ??
  "https://rs-anime-default-rtdb.firebaseio.com";
const VPLINK_API_KEY =
  Deno.env.get("VPLINK_API_KEY") ?? "ab26a97a3a3540c5be2ce837bd97526f8e76043d";
const UNLOCK_BANNER_IMAGE = "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";

async function fbPut(path: string, data: unknown) {
  await fetch(`${FIREBASE_DB}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => null);
}

const randomToken = () =>
  `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

async function shortenUrl(target: string): Promise<string | null> {
  try {
    const url = `https://vplink.in/api?api=${encodeURIComponent(VPLINK_API_KEY)}&url=${encodeURIComponent(target)}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (j?.status === "success" && j?.shortenedUrl) return j.shortenedUrl;
    return null;
  } catch {
    return null;
  }
}

async function deleteMessage(botToken: string, chatId: number | string, messageId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {}
}

async function sendUnlockMessage(
  botToken: string,
  chatId: number | string,
  shortLink: string,
) {
  const telegramBase = `https://api.telegram.org/bot${botToken}`;
  const caption =
    `<b>🔓 𝐔𝐍𝐋𝐎𝐂𝐊 𝐘𝐎𝐔𝐑 𝟐𝟒𝐇 𝐀𝐂𝐂𝐄𝐒𝐒</b>\n\n` +
    `✨ <i>Open the link below to unlock</i> <b>24 hours</b> <i>of free access to RS Anime.</i>\n\n` +
    `📌 <b>𝐇𝐨𝐰 𝐢𝐭 𝐰𝐨𝐫𝐤𝐬:</b>\n` +
    `1️⃣ Tap the <b>Unlock Access</b> button below\n` +
    `2️⃣ Wait a few seconds on the shortener page\n` +
    `3️⃣ You'll be redirected back automatically\n\n` +
    `⏱ <i>One tap • One unlock • Fast & safe</i>`;
  const noticeText =
    `⚠️ <b>𝐈𝐌𝐏𝐎𝐑𝐓𝐀𝐍𝐓 𝐍𝐎𝐓𝐈𝐂𝐄</b>\n\n` +
    `⏰ This link will <b>auto-delete in 30 seconds</b>.\n\n` +
    `If you miss it, just tap the <b>Free Access</b> button on any Telegram post or the <b>Verify</b> button on the website again.`;
  const keyboard = {
    inline_keyboard: [[{ text: "🔓 𝐔𝐧𝐥𝐨𝐜𝐤 𝐀𝐜𝐜𝐞𝐬𝐬", url: shortLink }]],
  };

  let mainMessageId: number | null = null;
  let noticeMessageId: number | null = null;

  // Try sending photo first
  try {
    const r = await fetch(`${telegramBase}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: UNLOCK_BANNER_IMAGE,
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.ok) mainMessageId = d.result?.message_id ?? null;
  } catch (_) {}

  if (!mainMessageId) {
    try {
      const r2 = await fetch(`${telegramBase}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: caption,
          parse_mode: "HTML",
          reply_markup: keyboard,
        }),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (r2.ok && d2?.ok) mainMessageId = d2.result?.message_id ?? null;
    } catch (_) {}
  }

  // Send the 30s notice as a separate message
  try {
    const rN = await fetch(`${telegramBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: noticeText,
        parse_mode: "HTML",
      }),
    });
    const dN = await rN.json().catch(() => ({}));
    if (rN.ok && dN?.ok) noticeMessageId = dN.result?.message_id ?? null;
  } catch (_) {}

  // Schedule auto-cleanup after 30s (best-effort, edge runtime allows ~60s)
  if (mainMessageId || noticeMessageId) {
    const ids = [mainMessageId, noticeMessageId].filter((x): x is number => !!x);
    setTimeout(() => {
      ids.forEach((mid) => deleteMessage(botToken, chatId, mid));
    }, 30_000);
  }

  return { mainMessageId, noticeMessageId };
}

async function handleUnlockDeepLink(
  botToken: string,
  chatId: number | string,
  userId: string,
  tgUserId: number | string,
) {
  const token = randomToken();
  const now = Date.now();
  await fbPut(`unlockTokens/${token}`, {
    token,
    ownerUserId: userId,
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    status: "pending",
    consumed: false,
    source: "telegram_bot",
    serviceId: "telegram_bot",
    tgUserId: String(tgUserId),
  });
  const callbackUrl = `${SITE_URL}/unlock?t=${encodeURIComponent(token)}&svc=telegram`;
  const shortUrl = (await shortenUrl(callbackUrl)) || callbackUrl;
  await sendUnlockMessage(botToken, chatId, shortUrl);
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

    // ========== SET WEBHOOK ==========
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

    // ========== DELETE MESSAGE FROM CHANNEL ==========
    if (action === "delete-message") {
      const chatId = body?.chatId;
      const messageId = body?.messageId;
      if (!chatId || !messageId) return json({ error: "chatId and messageId required" }, 400);
      try {
        const r = await fetch(`${telegramBase}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        });
        const d = await r.json().catch(() => ({}));
        // Telegram returns "message to delete not found" if already deleted — treat as success
        if (d?.ok || /not found|message can't be deleted/i.test(String(d?.description || ""))) {
          return json({ ok: true, alreadyDeleted: !d?.ok });
        }
        return json({ ok: false, error: d?.description || "Telegram delete error" }, 400);
      } catch (e: any) {
        return json({ ok: false, error: e?.message || "Delete failed" }, 500);
      }
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

    // ✨ Optional Free Access button — only when admin explicitly requests it
    if (includeFreeAccess) {
      const username = await getBotUsername(botToken);
      if (username) {
        buttons.push({
          text: "🔓 𝐅𝐫𝐞𝐞 𝐀𝐜𝐜𝐞𝐬𝐬 (𝟐𝟒𝐡)",
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
