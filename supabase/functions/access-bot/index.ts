// RS Anime Access Bot — handles /start for the dedicated mini-app bot
// (@RS_ANIME_ACCESS_BOT). Uses RS_ACCESS_BOT_TOKEN secret (separate from
// the main TELEGRAM_BOT_TOKEN used for posting).
//
// Actions (POST JSON):
//   - update_id present (Telegram webhook auto-detect) -> handles /start
//   { action: "set-webhook", webhookUrl }
//   { action: "delete-webhook" }
//   { action: "webhook-info" }
//   { action: "set-menu", miniUrl }   -> sets persistent web_app menu button
//   { action: "send-start", chatId }  -> manually re-sends start message

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SITE_NAME = "RS ANIME";
const SITE_URL = "https://rsanime03.lovable.app";
const MINI_APP_URL = `${SITE_URL}/mini`;
const CHANNEL_URL = "https://t.me/cartoonfunny03";
const HERO_IMAGE =
  "https://i.ibb.co/PsNMKqnT/IMG-20260417-065611-339.jpg";

function buildWelcomeText(firstName: string) {
  return `🎬 <b>Welcome to ${SITE_NAME} Access, ${firstName}!</b>

━━━━━━━━━━━━━━━━━━━━

🎁 <b>Get 24-Hour FREE Access</b>
Watch just <b>5 short ads</b> inside the Mini App and unlock the entire ${SITE_NAME} library — no payment, no signup hassles.

━━━━━━━━━━━━━━━━━━━━

✨ <b>What you get with Free Access</b>
  ✅ HD &amp; Full HD streaming
  ✅ Hindi dubbed + Subbed anime
  ✅ Movies, Series &amp; Live TV
  ✅ Zero buffering on weak networks
  ✅ Daily new episode updates

━━━━━━━━━━━━━━━━━━━━

⚡ <b>How it works</b>
  1️⃣ Tap <b>Open Mini App</b> below
  2️⃣ Watch 5 quick rewarded ads
  3️⃣ Your 24h access unlocks instantly
  4️⃣ Open the website — already unlocked!

━━━━━━━━━━━━━━━━━━━━

📌 <i>Tip:</i> Each ad must run for at least 15 seconds. Closing early will not count.

🚀 Ready? Tap the button below 👇`;
}

const startKeyboard = {
  inline_keyboard: [
    [
      {
        text: "🎁 Open Mini App",
        web_app: { url: `${MINI_APP_URL}?entry=telegram` },
      },
    ],
    [
      { text: "🌐 Visit Website", url: SITE_URL },
      { text: "📢 Join Channel", url: CHANNEL_URL },
    ],
  ],
};

async function sendStart(botToken: string, chatId: number | string, firstName: string) {
  const base = `https://api.telegram.org/bot${botToken}`;
  const text = buildWelcomeText(firstName || "Friend");

  // Try sendPhoto with caption first
  try {
    const r = await fetch(`${base}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: HERO_IMAGE,
        caption: text,
        parse_mode: "HTML",
        reply_markup: startKeyboard,
      }),
    });
    const data = await r.json();
    if (r.ok && data?.ok) return data;
  } catch (_) {
    // fall through to text
  }

  const r = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: startKeyboard,
      disable_web_page_preview: false,
    }),
  });
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "access-bot",
      actions: ["set-webhook", "delete-webhook", "webhook-info", "set-menu", "send-start"],
    });
  }

  try {
    const botToken = Deno.env.get("RS_ACCESS_BOT_TOKEN");
    if (!botToken) return json({ error: "RS_ACCESS_BOT_TOKEN not configured" }, 500);

    const base = `https://api.telegram.org/bot${botToken}`;
    const body = await req.json().catch(() => ({}));

    // === Telegram webhook auto-detect ===
    if (body?.update_id !== undefined) {
      const message = body?.message;
      if (message?.text) {
        const text = String(message.text).trim();
        if (text === "/start" || text.startsWith("/start ")) {
          const chatId = message.chat.id;
          const firstName = message.from?.first_name || "Friend";
          await sendStart(botToken, chatId, firstName);
        } else if (text === "/help") {
          await fetch(`${base}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: message.chat.id,
              text: "Tap <b>Open Mini App</b> from /start to unlock 24h free access.",
              parse_mode: "HTML",
            }),
          });
        }
      }
      return json({ ok: true });
    }

    const action = String(body?.action || "");

    if (action === "set-webhook") {
      const webhookUrl = String(body?.webhookUrl || "").trim();
      if (!webhookUrl) return json({ error: "webhookUrl required" }, 400);
      const r = await fetch(`${base}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
      });
      return json(await r.json());
    }

    if (action === "delete-webhook") {
      const r = await fetch(`${base}/deleteWebhook`, { method: "POST" });
      return json(await r.json());
    }

    if (action === "webhook-info") {
      const r = await fetch(`${base}/getWebhookInfo`);
      return json(await r.json());
    }

    if (action === "set-menu") {
      const requestedMiniUrl = String(body?.miniUrl || MINI_APP_URL).trim();
      const miniUrl = requestedMiniUrl.includes("?")
        ? `${requestedMiniUrl}&entry=telegram`
        : `${requestedMiniUrl}?entry=telegram`;
      const r = await fetch(`${base}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu_button: {
            type: "web_app",
            text: "🎁 Free Access",
            web_app: { url: miniUrl },
          },
        }),
      });
      return json(await r.json());
    }

    if (action === "send-start") {
      const chatId = body?.chatId;
      const firstName = String(body?.firstName || "Friend");
      if (!chatId) return json({ error: "chatId required" }, 400);
      const data = await sendStart(botToken, chatId, firstName);
      return json(data);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "internal" }, 500);
  }
});
