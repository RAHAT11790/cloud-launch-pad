// ============================================================
// Cloudflare Worker — telegram-post (CF-native)
// SECRETS: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// POST { text, photo?, caption?, parse_mode? } → forwards to Telegram Bot API.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
    const chat = (env.TELEGRAM_CHAT_ID || "").trim();
    if (!token || !chat) return json({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const isPhoto = !!body.photo;
    const endpoint = isPhoto ? "sendPhoto" : "sendMessage";
    const payload = isPhoto
      ? { chat_id: chat, photo: body.photo, caption: body.caption || body.text || "", parse_mode: body.parse_mode || "HTML" }
      : { chat_id: chat, text: body.text || "", parse_mode: body.parse_mode || "HTML", disable_web_page_preview: body.disable_web_page_preview ?? true };

    const r = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return json({ ok: r.ok && data.ok, result: data }, r.ok ? 200 : 502);
  },
};
