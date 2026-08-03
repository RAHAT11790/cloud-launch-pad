// ============================================================
// Cloudflare Worker — telegram-post  (v3 · Comment Bridge)
// ------------------------------------------------------------
// The bot does exactly three jobs:
//   1) Channel posts   → POST { text | photo, caption }
//   2) Group link share→ POST { text, chatId }            (same API)
//   3) Comment bridge  → POST { kind:"comment", ... }  → comment group
//      + Telegram webhook: admin replies with "/rs <text>" to the bot's
//        comment message → the reply is written back into the website's
//        comment thread (Firebase RTDB) and the user gets a push.
//
// ENV (set in Cloudflare → Settings → Variables):
//   TELEGRAM_BOT_TOKEN         (required) BotFather token
//   TELEGRAM_CHAT_ID           (required) channel for new-episode posts
//   TELEGRAM_COMMENT_GROUP_ID  (required) e.g. @myGroup or -1001234567890
//   TELEGRAM_ADMIN_USER_ID     (required) your numeric Telegram user id
//   FIREBASE_DB_URL            (required) https://<project>-default-rtdb.firebaseio.com
//   FIREBASE_DB_SECRET         (optional) RTDB legacy secret if rules are locked
//   SEND_FCM_URL               (optional) send-fcm worker URL for push
//   ADMIN_DISPLAY_NAME         (optional) name shown on the website reply
//
// Open the worker URL in a browser once → webhook is registered automatically.
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const b64uEncode = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64uDecode = (s) => {
  try {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

async function tg(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { httpOk: r.ok, ...data };
}

// ── Firebase RTDB REST helpers ────────────────────────────────
const dbUrl = (env, path) => {
  const base = String(env.FIREBASE_DB_URL || "").replace(/\/+$/, "");
  const auth = env.FIREBASE_DB_SECRET ? `?auth=${encodeURIComponent(env.FIREBASE_DB_SECRET)}` : "";
  return `${base}/${path}.json${auth}`;
};
async function dbGet(env, path) {
  const r = await fetch(dbUrl(env, path));
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
async function dbPut(env, path, value) {
  const r = await fetch(dbUrl(env, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, body: txt };
}

// ── Comment card ──────────────────────────────────────────────
function buildCommentCard(p, tag) {
  const who = p.isGuest || !p.userName ? "Guest" : p.userName;
  const kindLine = p.parentId ? "↩️ <b>New Reply</b>" : "💬 <b>New Comment</b>";
  const lines = [
    kindLine,
    "━━━━━━━━━━━━━━━━━━",
    `👤 <b>${esc(who)}</b>`,
  ];
  if (p.title) lines.push(`🎬 <i>${esc(p.title)}</i>`);
  lines.push("", `🗨 ${esc(p.text)}`, "");
  if (p.pageUrl) lines.push(`🔗 <a href="${esc(p.pageUrl)}">Open on website</a>`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("↩️ <i>Reply to this message with</i> <code>/rs your answer</code>");
  lines.push(`<code>#rs ${tag}</code>`);
  return lines.join("\n");
}

// ── Webhook: admin reply → website comment ───────────────────
async function handleUpdate(update, env) {
  const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
  const msg = update.message || update.edited_message;
  if (!msg) return json({ ok: true, skipped: "no-message" });

  const text = String(msg.text || msg.caption || "").trim();
  const chatId = msg.chat?.id;

  // /start & /help
  if (/^\/(start|help)(@\w+)?$/i.test(text)) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "🤖 <b>RS ANIME Bot</b>\n\n" +
        "• Posts new episodes to the channel\n" +
        "• Shares links in groups\n" +
        "• Forwards website comments here\n\n" +
        "To answer a user: <b>reply</b> to a comment message with <code>/rs your answer</code>.",
    });
    return json({ ok: true });
  }

  const reply = msg.reply_to_message;
  if (!reply) return json({ ok: true, skipped: "not-a-reply" });

  const isCommand = /^\/?rs(@\w+)?\b/i.test(text);
  if (!isCommand) return json({ ok: true, skipped: "no-rs-command" });

  // Only the configured admin may answer
  const adminId = String(env.TELEGRAM_ADMIN_USER_ID || "").trim();
  if (!adminId || String(msg.from?.id || "") !== adminId) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: "⛔ Only the admin can reply to website comments.",
    });
    return json({ ok: true, skipped: "not-admin" });
  }

  const src = String(reply.text || reply.caption || "");
  const tagMatch = src.match(/#rs\s+([A-Za-z0-9_-]+)/);
  const meta = tagMatch ? b64uDecode(tagMatch[1]) : null;
  if (!meta?.a || !meta?.c) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: "⚠️ Reply to a comment message from this bot (the one containing the #rs tag).",
    });
    return json({ ok: true, skipped: "no-tag" });
  }

  const answer = text.replace(/^\/?rs(@\w+)?[\s:,-]*/i, "").trim();
  if (!answer) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: "✍️ Usage: <code>/rs your answer</code>",
      parse_mode: "HTML",
    });
    return json({ ok: true, skipped: "empty" });
  }

  const animeId = String(meta.a);
  const parentId = String(meta.c);
  const targetUid = String(meta.u || "");
  const adminName = (env.ADMIN_DISPLAY_NAME || "Admin").trim();

  // Parent must still exist (deleted comment → don't create an orphan)
  const parent = await dbGet(env, `comments/${animeId}/${parentId}`);
  if (!parent) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: "🗑 That comment no longer exists.",
    });
    return json({ ok: true, skipped: "parent-gone" });
  }

  const cid = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wrote = await dbPut(env, `comments/${animeId}/${cid}`, {
    userId: "admin",
    userName: adminName,
    text: answer.slice(0, 500),
    timestamp: Date.now(),
    parentId,
    isAdmin: true,
    via: "telegram",
  });

  if (!wrote.ok) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      reply_to_message_id: msg.message_id,
      text: `❌ Failed to save reply (DB ${wrote.status}).`,
    });
    return json({ ok: false, error: wrote.body }, 200);
  }

  // Best-effort push to the comment owner
  let pushed = false;
  const fcmUrl = String(env.SEND_FCM_URL || "").trim();
  if (fcmUrl && targetUid && targetUid !== "guest") {
    try {
      const r = await fetch(fcmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: [targetUid],
          title: `💬 ${adminName} replied to your comment`,
          body: answer.slice(0, 90),
          data: {
            url: `/?anime=${encodeURIComponent(animeId)}#comments`,
            deepLink: `/?anime=${encodeURIComponent(animeId)}#comments`,
            kind: "comment_reply",
            notificationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        }),
      });
      pushed = r.ok;
    } catch {}
  }

  await tg(token, "sendMessage", {
    chat_id: chatId,
    reply_to_message_id: msg.message_id,
    parse_mode: "HTML",
    text: `✅ <b>Reply delivered</b>${pushed ? " · 🔔 push sent" : ""}\n🗨 ${esc(answer.slice(0, 120))}`,
  });

  return json({ ok: true, delivered: true, pushed });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const token = (env.TELEGRAM_BOT_TOKEN || "").trim();
    const url = new URL(req.url);

    // ── GET → auto-register webhook + status page ──
    if (req.method === "GET") {
      if (!token) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
      const hookUrl = `${url.origin}${url.pathname}`;
      const set = await tg(token, "setWebhook", {
        url: hookUrl,
        allowed_updates: ["message", "edited_message"],
        drop_pending_updates: url.searchParams.get("reset") === "1",
      });
      const info = await tg(token, "getWebhookInfo", {});
      const me = await tg(token, "getMe", {});
      const envState = {
        TELEGRAM_BOT_TOKEN: !!token,
        TELEGRAM_CHAT_ID: !!env.TELEGRAM_CHAT_ID,
        TELEGRAM_COMMENT_GROUP_ID: !!env.TELEGRAM_COMMENT_GROUP_ID,
        TELEGRAM_ADMIN_USER_ID: !!env.TELEGRAM_ADMIN_USER_ID,
        FIREBASE_DB_URL: !!env.FIREBASE_DB_URL,
        SEND_FCM_URL: !!env.SEND_FCM_URL,
      };
      if (url.searchParams.get("format") === "json") {
        return json({ ok: !!set.ok, webhook: hookUrl, info: info.result, bot: me.result, env: envState });
      }
      const rows = Object.entries(envState)
        .map(([k, v]) => `<tr><td>${k}</td><td>${v ? "✅ set" : "❌ missing"}</td></tr>`)
        .join("");
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>RS Telegram Bot</title>
<style>body{font:14px/1.6 system-ui;background:#0b0b10;color:#e6e6ef;padding:24px;max-width:720px;margin:auto}
h1{font-size:18px}code{background:#1a1a24;padding:2px 6px;border-radius:6px}
table{width:100%;border-collapse:collapse;margin:12px 0}td{border-bottom:1px solid #22222e;padding:6px 4px;font-family:ui-monospace}
.ok{color:#34d399}.bad{color:#f87171}</style>
<h1>🤖 RS ANIME Telegram Bot</h1>
<p class="${set.ok ? "ok" : "bad"}">Webhook ${set.ok ? "registered" : "failed"}: <code>${hookUrl}</code></p>
<p>Bot: <code>@${me.result?.username || "unknown"}</code> · pending: <code>${info.result?.pending_update_count ?? "?"}</code></p>
<table>${rows}</table>
<p>Reply flow: bot posts a comment in your group → <b>reply</b> to that message with <code>/rs your answer</code>.</p>`,
        { headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!token) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const body = await req.json().catch(() => ({}));

    // ── Telegram webhook update ──
    if (body && typeof body.update_id === "number") {
      try {
        return await handleUpdate(body, env);
      } catch (e) {
        return json({ ok: true, error: String(e?.message || e) });
      }
    }

    // ── Website comment → comment group ──
    if (body?.kind === "comment") {
      const group = String(env.TELEGRAM_COMMENT_GROUP_ID || "").trim();
      if (!group) return json({ error: "TELEGRAM_COMMENT_GROUP_ID not configured" }, 500);
      if (!body.animeId || !body.commentId || !body.text) {
        return json({ error: "animeId, commentId and text are required" }, 400);
      }
      const tag = b64uEncode({ a: String(body.animeId), c: String(body.commentId), u: String(body.userId || "guest") });
      const r = await tg(token, "sendMessage", {
        chat_id: group,
        text: buildCommentCard(body, tag),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      return json({ ok: !!r.ok, result: r }, r.ok ? 200 : 502);
    }

    // ── Legacy: channel post / link share ──
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
