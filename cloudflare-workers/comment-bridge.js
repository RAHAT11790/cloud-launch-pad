// ============================================================
// Cloudflare Worker — comment-bridge  (standalone bot)
// ------------------------------------------------------------
// Website comment  →  your Telegram group
// Admin replies in the group with "/rs your answer"
//        →  reply is written into the website comment thread
//        →  the user gets a push notification
//
// YOU ONLY SET 3 SECRETS:
//   TELEGRAM_BOT_TOKEN         BotFather token (separate bot!)
//   TELEGRAM_ADMIN_USER_ID     your numeric Telegram user id
//   TELEGRAM_COMMENT_GROUP_ID  @yourGroup  or  -1001234567890
//
// Everything else is hard-coded below (CONFIG).
// Open the worker URL once in a browser → webhook auto-registers.
// ============================================================

const CONFIG = {
  FIREBASE_DB_URL: "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_DB_SECRET: "", // only if RTDB rules are locked
  SEND_FCM_URL: "", // optional: send-fcm worker URL for push
  ADMIN_DISPLAY_NAME: "Admin",
  SITE_URL: "https://rsanime03.lovable.app",
};

const cfg = (env, key) => String(env?.[key] || CONFIG[key] || "").trim();

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
  const base = cfg(env, "FIREBASE_DB_URL").replace(/\/+$/, "");
  const secret = cfg(env, "FIREBASE_DB_SECRET");
  const auth = secret ? `?auth=${encodeURIComponent(secret)}` : "";
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
  const lines = [kindLine, "━━━━━━━━━━━━━━━━━━", `👤 <b>${esc(who)}</b>`];
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
  const token = cfg(env, "TELEGRAM_BOT_TOKEN");
  const msg = update.message || update.edited_message;
  if (!msg) return json({ ok: true, skipped: "no-message" });

  const text = String(msg.text || msg.caption || "").trim();
  const chatId = msg.chat?.id;

  if (/^\/(start|help)(@\w+)?$/i.test(text)) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "💬 <b>RS ANIME Comment Bridge</b>\n\n" +
        "Website comments arrive in this group.\n" +
        "To answer a user: <b>reply</b> to a comment message with <code>/rs your answer</code>.",
    });
    return json({ ok: true });
  }

  const reply = msg.reply_to_message;
  if (!reply) return json({ ok: true, skipped: "not-a-reply" });

  const isCommand = /^\/?rs(@\w+)?\b/i.test(text);
  if (!isCommand) return json({ ok: true, skipped: "no-rs-command" });

  const adminId = cfg(env, "TELEGRAM_ADMIN_USER_ID");
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
      parse_mode: "HTML",
      text: "✍️ Usage: <code>/rs your answer</code>",
    });
    return json({ ok: true, skipped: "empty" });
  }

  const animeId = String(meta.a);
  const parentId = String(meta.c);
  const targetUid = String(meta.u || "");
  const adminName = cfg(env, "ADMIN_DISPLAY_NAME") || "Admin";

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

  let pushed = false;
  const fcmUrl = cfg(env, "SEND_FCM_URL");
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

    const token = cfg(env, "TELEGRAM_BOT_TOKEN");
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
        TELEGRAM_ADMIN_USER_ID: !!cfg(env, "TELEGRAM_ADMIN_USER_ID"),
        TELEGRAM_COMMENT_GROUP_ID: !!cfg(env, "TELEGRAM_COMMENT_GROUP_ID"),
        "FIREBASE_DB_URL (built-in)": !!cfg(env, "FIREBASE_DB_URL"),
        "SEND_FCM_URL (optional)": !!cfg(env, "SEND_FCM_URL"),
      };
      if (url.searchParams.get("format") === "json") {
        return json({ ok: !!set.ok, webhook: hookUrl, info: info.result, bot: me.result, env: envState });
      }
      const rows = Object.entries(envState)
        .map(([k, v]) => `<tr><td>${k}</td><td>${v ? "✅ set" : "❌ missing"}</td></tr>`)
        .join("");
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>RS Comment Bridge</title>
<style>body{font:14px/1.6 system-ui;background:#0b0b10;color:#e6e6ef;padding:24px;max-width:720px;margin:auto}
h1{font-size:18px}code{background:#1a1a24;padding:2px 6px;border-radius:6px}
table{width:100%;border-collapse:collapse;margin:12px 0}td{border-bottom:1px solid #22222e;padding:6px 4px;font-family:ui-monospace}
.ok{color:#34d399}.bad{color:#f87171}</style>
<h1>💬 RS ANIME — Comment Bridge Bot</h1>
<p class="${set.ok ? "ok" : "bad"}">Webhook ${set.ok ? "registered" : "failed"}: <code>${hookUrl}</code></p>
<p>Bot: <code>@${me.result?.username || "unknown"}</code> · pending: <code>${info.result?.pending_update_count ?? "?"}</code></p>
<table>${rows}</table>
<p>Flow: website comment → this group → <b>reply</b> with <code>/rs your answer</code> → user sees it on the site.</p>`,
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
    const group = cfg(env, "TELEGRAM_COMMENT_GROUP_ID");
    if (!group) return json({ error: "TELEGRAM_COMMENT_GROUP_ID not configured" }, 500);
    if (!body?.animeId || !body?.commentId || !body?.text) {
      return json({ error: "animeId, commentId and text are required" }, 400);
    }
    const pageUrl = body.pageUrl || `${cfg(env, "SITE_URL")}/?anime=${encodeURIComponent(body.animeId)}#comments`;
    const tag = b64uEncode({
      a: String(body.animeId),
      c: String(body.commentId),
      u: String(body.userId || "guest"),
    });
    const r = await tg(token, "sendMessage", {
      chat_id: group,
      text: buildCommentCard({ ...body, pageUrl }, tag),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return json({ ok: !!r.ok, result: r }, r.ok ? 200 : 502);
  },
};
