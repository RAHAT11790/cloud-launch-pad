// ============================================================
// Cloudflare Worker — telegram-post  (posts only)
// ------------------------------------------------------------
//   1) Channel posts    → POST { text | photo, caption }
//   2) Group link share → POST { text, chatId }
//
// Comment bridge lives in a SEPARATE worker: `comment-bridge`.
//
// ENV:
//   TELEGRAM_BOT_TOKEN  (required)
//   TELEGRAM_CHAT_ID    (required) channel/group for posts
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function tg(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { httpOk: r.ok, ...data };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const chat = String(body.chatId || env.TELEGRAM_CHAT_ID || "").trim();
    if (!chat) return json({ error: "TELEGRAM_CHAT_ID not configured" }, 500);

    const isPhoto = !!body.photo;
    const endpoint = isPhoto ? "sendPhoto" : "sendMessage";
    const payload = isPhoto
      ? { chat_id: chat, photo: body.photo, caption: body.caption || body.text || "", parse_mode: body.parse_mode || "HTML" }
      : { chat_id: chat, text: body.text || "", parse_mode: body.parse_mode || "HTML", disable_web_page_preview: body.disable_web_page_preview ?? true };
    if (body.reply_markup) payload.reply_markup = body.reply_markup;

    const data = await tg(token, endpoint, payload);
    return json({ ok: !!data.ok, result: data }, data.ok ? 200 : 502);
  },
};
