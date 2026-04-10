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

🎬 Start watching now — tap the buttons below! 👇
`.trim();

  const keyboard = {
    inline_keyboard: [
      [{ text: "🌐 Visit Website", url: siteUrl }],
      [{ text: "📢 Join Channel", url: channelUrl }],
      [{ text: "🎬 Latest Releases", url: `${siteUrl}/#new-releases` }],
    ],
  };

  // Try sending with photo first
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
  } catch (_) {
    // fallback to text
  }

  // Fallback: text only
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

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  if (req.method === "GET")
    return json({ ok: true, service: "telegram-post", actions: ["send", "edit-buttons", "webhook", "set-webhook"] });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const body = await req.json();
    const action = String(body?.action || "send");
    const telegramBase = `https://api.telegram.org/bot${botToken}`;

    // ========== AUTO-DETECT TELEGRAM WEBHOOK (update_id present = from Telegram) ==========
    if (body?.update_id !== undefined) {
      const message = body?.message;
      if (message?.text === "/start") {
        const chatId = message.chat.id;
        const firstName = message.from?.first_name || "Friend";
        await sendStartMessage(botToken, chatId, firstName);
      }
      return json({ ok: true });
    }

    // ========== MANUAL WEBHOOK (from admin panel) ==========
    if (action === "webhook") {
      const update = body?.update;
      if (!update) return json({ ok: true, skipped: true });
      const message = update?.message;
      if (message?.text === "/start") {
        const chatId = message.chat.id;
        const firstName = message.from?.first_name || "Friend";
        await sendStartMessage(botToken, chatId, firstName);
      }
      return json({ ok: true });
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
      return json(data);
    }

    // ========== DELETE WEBHOOK ==========
    if (action === "delete-webhook") {
      const res = await fetch(`${telegramBase}/deleteWebhook`, { method: "POST" });
      const data = await res.json();
      return json(data);
    }

    // ========== GET WEBHOOK INFO ==========
    if (action === "webhook-info") {
      const res = await fetch(`${telegramBase}/getWebhookInfo`);
      const data = await res.json();
      return json(data);
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
    const chatId = body?.chatId;
    const caption = String(body?.caption || "");
    const photoUrl = String(body?.photoUrl || "").trim();
    const buttonText = String(body?.buttonText || "").trim();
    const buttonUrl = String(body?.buttonUrl || "").trim();
    const extraInlineButtons: InlineButton[] = Array.isArray(body?.inlineButtons) ? body.inlineButtons : [];

    if (!chatId) return json({ error: "chatId required" }, 400);

    const buttons: InlineButton[] = [];
    if (buttonText && buttonUrl) buttons.push({ text: buttonText, url: buttonUrl });
    extraInlineButtons.forEach((btn: any) => {
      if (btn?.text && btn?.url) buttons.push({ text: String(btn.text), url: String(btn.url) });
    });

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
