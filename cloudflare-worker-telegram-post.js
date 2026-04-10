/**
 * RS Anime Telegram Post Worker — Cloudflare Workers
 * 
 * ENV VARS needed:
 *   - TELEGRAM_BOT_TOKEN: Your Telegram Bot API token
 * 
 * Features:
 *   - Send photo/message to Telegram channels
 *   - Edit inline keyboard buttons on existing messages (for URL updates)
 * 
 * Actions:
 *   - default (no action): Send a new post
 *   - "edit-buttons": Edit inline buttons of an existing message
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "GET") {
      return json({ status: "ok", service: "telegram-post", actions: ["send", "edit-buttons"] });
    }

    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    try {
      const body = await request.json();
      const { action } = body;

      // ===== EDIT BUTTONS =====
      if (action === "edit-buttons") {
        const { chatId, messageId, inlineButtons } = body;
        if (!chatId || !messageId || !inlineButtons) {
          return json({ error: "chatId, messageId, inlineButtons required" }, 400);
        }

        // Build inline keyboard (each button in its own row)
        const inline_keyboard = inlineButtons.map(btn => [{ text: btn.text, url: btn.url }]);

        const tgRes = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/editMessageReplyMarkup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard },
          }),
        });

        const tgData = await tgRes.json();
        if (!tgData.ok) {
          return json({ error: tgData.description || "Telegram API error", ok: false }, 400);
        }
        return json({ ok: true, result: tgData.result });
      }

      // ===== SEND NEW POST (default) =====
      const { chatId, caption, photoUrl, buttonText, buttonUrl, inlineButtons } = body;
      if (!chatId) return json({ error: "chatId required" }, 400);

      // Build inline keyboard
      const keyboard = [];
      if (buttonText && buttonUrl) {
        keyboard.push([{ text: buttonText, url: buttonUrl }]);
      }
      if (inlineButtons && Array.isArray(inlineButtons)) {
        // Skip the first if it's the same as buttonText/buttonUrl
        const startIdx = (buttonText && buttonUrl) ? 1 : 0;
        for (let i = startIdx; i < inlineButtons.length; i++) {
          keyboard.push([{ text: inlineButtons[i].text, url: inlineButtons[i].url }]);
        }
      }

      const reply_markup = keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;

      let tgRes;
      if (photoUrl) {
        tgRes = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,
            caption: caption || "",
            parse_mode: "HTML",
            reply_markup,
          }),
        });
      } else {
        tgRes = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: caption || "No content",
            parse_mode: "HTML",
            reply_markup,
          }),
        });
      }

      const tgData = await tgRes.json();
      if (!tgData.ok) {
        return json({ error: tgData.description || "Telegram API error", ok: false }, 400);
      }

      return json({
        ok: true,
        message_id: tgData.result?.message_id,
        result: tgData.result,
      });

    } catch (err) {
      return json({ error: err.message || "Internal error" }, 500);
    }
  },
};
