// ============================================================
// Cloudflare Worker — anime-search-bot
// ------------------------------------------------------------
// Telegram bot: search anime via TMDB, return 4 assets
// (title, backdrop, poster, title-logo URL) with optional
// per-image background removal.
//
// REQUIRED SECRET: TELEGRAM_BOT_TOKEN
// OPTIONAL SECRET: REMOVE_BG_API_KEY   (remove.bg key — enables
//                  true character-only cutouts. If missing, the
//                  bot uses a free fallback endpoint.)
//
// DEPLOY → just visit the Worker URL once in a browser. It will
// auto-register the Telegram webhook to itself. No manual setup.
// ============================================================

const TMDB_KEY = "37f4b185e3dc487e4fd3e56e2fab2307";
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/original";
const BRAND_IMG = "https://i.ibb.co.com/4w72zhGs/IMG-20260417-065611-339.jpg";
const SITE_NAME = "RS ANIME";
const SITE_URL = "https://rsanime03.lovable.app";

// ---------- helpers ---------------------------------------------------------
const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

async function tmdb(path, params = {}) {
  const u = new URL(TMDB + path);
  u.searchParams.set("api_key", TMDB_KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  return r.json();
}

// ---------- webhook auto-setup ---------------------------------------------
async function ensureWebhook(token, workerUrl) {
  const info = await tg(token, "getWebhookInfo", {});
  const target = `${workerUrl}/webhook`;
  if (info?.result?.url === target) return { ok: true, already: true, url: target };
  const r = await tg(token, "setWebhook", {
    url: target,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return { ok: !!r.ok, result: r, url: target };
}

// ---------- TMDB queries ----------------------------------------------------
async function searchAnime(query) {
  // Anime = keyword 210024 on TMDB. Search TV + Movie, filter by keyword.
  const [tv, mv] = await Promise.all([
    tmdb("/search/tv", { query, include_adult: "false", language: "en-US" }),
    tmdb("/search/movie", { query, include_adult: "false", language: "en-US" }),
  ]);
  const items = [
    ...(tv?.results || []).map((r) => ({ ...r, media_type: "tv" })),
    ...(mv?.results || []).map((r) => ({ ...r, media_type: "movie" })),
  ];
  // Prefer JP originals but don't hard-drop others.
  items.sort((a, b) => {
    const ja = a.original_language === "ja" ? 1 : 0;
    const jb = b.original_language === "ja" ? 1 : 0;
    if (ja !== jb) return jb - ja;
    return (b.popularity || 0) - (a.popularity || 0);
  });
  return items.slice(0, 12);
}

async function fetchAssets(mediaType, id) {
  const [details, images] = await Promise.all([
    tmdb(`/${mediaType}/${id}`, { language: "en-US" }),
    tmdb(`/${mediaType}/${id}/images`, { include_image_language: "en,null,ja" }),
  ]);
  const pickLogo = (arr = []) =>
    arr.filter((x) => x.file_path && (x.iso_639_1 === "en" || !x.iso_639_1))
       .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  const logo = pickLogo(images?.logos);
  const backdrop = (images?.backdrops || [])[0] || { file_path: details?.backdrop_path };
  const poster = (images?.posters || [])[0] || { file_path: details?.poster_path };
  return {
    title: details?.name || details?.title || "Unknown",
    year: (details?.first_air_date || details?.release_date || "").slice(0, 4),
    overview: details?.overview || "",
    backdrop: backdrop?.file_path ? IMG + backdrop.file_path : null,
    poster: poster?.file_path ? IMG + poster.file_path : null,
    logo: logo?.file_path ? IMG + logo.file_path : null,
  };
}

// ---------- background removal (ULTRA-PROFESSIONAL) -------------------------
// Strategy: remove.bg with maxed-out quality flags for anime character cutouts.
//   • size=full           → max resolution (uses 1 credit — worth it)
//   • format=png          → true alpha channel, no JPEG compression halos
//   • channels=rgba       → keep transparency
//   • semitransparency=true → soft anti-aliased hair/edge pixels (critical
//                             for anime — otherwise you get "chopped" edges)
//   • crop=true           → auto-tight crop around character, no dead space
//   • crop_margin=10px    → tiny breathing room so hair spikes aren't clipped
//   • roi=... (optional)  → let AI pick, best for full illustrations
// On any failure we retry once with size=auto before falling back.
async function removeBg(imageUrl, apiKey) {
  if (apiKey) {
    // `type` is intentionally OMITTED by default — forcing type=auto/person
    // makes remove.bg reject stylized anime art with "unknown_foreground".
    // Letting the model decide freely dramatically improves anime hit-rate.
    const build = (size, opts = {}) => {
      const f = new FormData();
      f.append("image_url", imageUrl);
      f.append("size", size);
      f.append("format", "png");
      f.append("channels", "rgba");
      f.append("semitransparency", "true");
      f.append("crop", opts.crop === false ? "false" : "true");
      f.append("crop_margin", "10px");
      f.append("bg_color", "");
      if (opts.type) f.append("type", opts.type);
      return f;
    };
    const call = async (size, opts) =>
      fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "X-Api-Key": apiKey, "Accept": "image/png" },
        body: build(size, opts),
      });

    // Attempt ladder — each targets a different failure mode on anime art.
    const attempts = [
      { size: "full", opts: {} },                 // best quality, free detection
      { size: "full", opts: { type: "person" } }, // force person model
      { size: "auto", opts: { crop: false } },    // no crop — helps wide scenes
      { size: "auto", opts: {} },                 // last-ditch cheap retry
    ];

    let lastErr = "";
    for (const a of attempts) {
      const r = await call(a.size, a.opts);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
      const txt = await r.text().catch(() => "");
      lastErr = `${r.status}: ${txt.slice(0, 240)}`;
      if (r.status === 402 || r.status === 401 || r.status === 403) break;
    }
    throw new Error(`remove.bg ${lastErr}`);
  }
  // Free fallback — best-effort only, no API key present.
  const r = await fetch(`https://api.bgrem.ai/api/v1/remove?url=${encodeURIComponent(imageUrl)}`);
  if (!r.ok) throw new Error(`fallback bg-remove ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Telegram's sendPhoto converts to JPEG → destroys transparency.
// For cutouts we MUST use sendDocument to preserve the alpha channel.
async function sendCutoutDocument(token, chatId, bytes, filename, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes], { type: "image/png" }), filename);
  if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  return r.json().catch(() => ({}));
}

// Also send a preview photo so user sees it inline (photo strips alpha to
// a checkerboard-free flat — Telegram renders PNG-in-photo on dark bg fine).
async function sendCutoutPreview(token, chatId, bytes, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([bytes], { type: "image/png" }), "preview.png");
  if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  return r.json().catch(() => ({}));
}


// ---------- UX pieces -------------------------------------------------------
const WELCOME = `<b>✨ Welcome to ${SITE_NAME} Asset Bot ✨</b>

I hunt down premium anime assets from TMDB — instantly.

<b>What I deliver</b>
• 🎞  Backdrop image
• 🖼  Poster image
• 🅰️  Title logo (transparent PNG)
• 🏷  Official title &amp; year

<b>Bonus</b>
• 🪄  <i>Remove BG</i> — ultra-clean character-only cutouts

<b>How to use</b>
Just type an anime name.  Example:
<code>Naruto</code>   <code>Demon Slayer</code>   <code>Solo Leveling</code>

Powered by <a href="${SITE_URL}">${SITE_NAME}</a>`;

function searchHeader(query, count) {
  return `<b>🔎 Search:</b> <code>${escapeHtml(query)}</code>
<b>📦 Results:</b> ${count}

<i>Pick the one you want ↓</i>`;
}

function assetCaption(a) {
  return `<b>🎬 ${escapeHtml(a.title)}</b>${a.year ? `  <i>(${a.year})</i>` : ""}
${a.overview ? `\n${escapeHtml(a.overview.slice(0, 350))}${a.overview.length > 350 ? "…" : ""}` : ""}`;
}

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Uniform-width buttons: pad every label to the longest label in the set
function uniformButtons(items, mkCb) {
  const labels = items.map((it) => {
    const y = (it.first_air_date || it.release_date || "").slice(0, 4);
    const tag = it.media_type === "movie" ? "🎥" : "📺";
    return `${tag} ${it.name || it.title}${y ? ` (${y})` : ""}`;
  });
  const maxLen = Math.min(48, Math.max(...labels.map((l) => l.length)));
  return items.map((it, i) => {
    let l = labels[i];
    if (l.length > maxLen) l = l.slice(0, maxLen - 1) + "…";
    else l = l + " ".repeat(maxLen - l.length);
    return [{ text: l, callback_data: mkCb(it) }];
  });
}

// ---------- handlers --------------------------------------------------------
async function handleUpdate(update, env, workerUrl) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    if (text === "/start" || text === "/help") {
      await tg(token, "sendPhoto", {
        chat_id: chatId,
        photo: BRAND_IMG,
        caption: WELCOME,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "🌐 Visit Website", url: SITE_URL },
          ]],
        },
      });
      return;
    }

    if (!text || text.startsWith("/")) return;

    // Search flow
    await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });
    const results = await searchAnime(text);
    if (!results.length) {
      await tg(token, "sendMessage", {
        chat_id: chatId,
        text: `❌ Nothing found for <code>${escapeHtml(text)}</code>`,
        parse_mode: "HTML",
      });
      return;
    }
    const kb = uniformButtons(results, (it) => `s:${it.media_type[0]}:${it.id}`);
    await tg(token, "sendPhoto", {
      chat_id: chatId,
      photo: BRAND_IMG,
      caption: searchHeader(text, results.length),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: kb },
    });
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const data = cq.data || "";
    await tg(token, "answerCallbackQuery", { callback_query_id: cq.id });

    const parts = data.split(":");
    const kind = parts[0];
    const mtype = parts[1] === "t" ? "tv" : "movie";
    const id = parts[2];

    if (kind === "s") {
      // Show Normal / Remove BG choice
      const a = await fetchAssets(mtype, id);
      await tg(token, "sendPhoto", {
        chat_id: chatId,
        photo: a.backdrop || a.poster || BRAND_IMG,
        caption: assetCaption(a),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "📤 Normal",     callback_data: `n:${parts[1]}:${id}` },
            { text: "🪄 Remove BG",  callback_data: `r:${parts[1]}:${id}` },
          ]],
        },
      });
      return;
    }

    if (kind === "n") {
      const a = await fetchAssets(mtype, id);
      await sendAllAssets(token, chatId, a);
      return;
    }

    if (kind === "r") {
      await tg(token, "sendMessage", {
        chat_id: chatId,
        text: "🪄 <b>Which image should I clean?</b>\nCharacter stays, background disappears.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "🖼 Poster",   callback_data: `rp:${parts[1]}:${id}` },
            { text: "🎞 Backdrop", callback_data: `rb:${parts[1]}:${id}` },
          ]],
        },
      });
      return;
    }

    if (kind === "rp" || kind === "rb") {
      const a = await fetchAssets(mtype, id);
      const target = kind === "rp" ? a.poster : a.backdrop;
      if (!target) {
        await tg(token, "sendMessage", { chat_id: chatId, text: "⚠️ No source image available." });
        return;
      }
      await tg(token, "sendChatAction", { chat_id: chatId, action: "upload_photo" });
      try {
        const bytes = await removeBg(target, env.REMOVE_BG_API_KEY || "");
        const label = kind === "rp" ? "Poster" : "Backdrop";
        const safeTitle = a.title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "cutout";
        const caption = `🪄 <b>Character Cutout — ${label}</b>\n🎬 ${escapeHtml(a.title)}\n<i>Transparent PNG · HD · anti-aliased edges</i>`;
        // 1) inline preview so user sees it immediately
        await sendCutoutPreview(token, chatId, bytes, caption);
        // 2) true transparent PNG as document (Telegram keeps alpha channel)
        await sendCutoutDocument(token, chatId, bytes, `${safeTitle}_${label.toLowerCase()}_cutout.png`,
          `📎 <b>Transparent PNG file</b> — download for editing`);
        // 3) remaining assets
        const rest = { ...a, [kind === "rp" ? "poster" : "backdrop"]: null };
        await sendAllAssets(token, chatId, rest, { skipCutout: kind === "rp" ? "poster" : "backdrop" });

      } catch (e) {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ Background removal failed.\n<code>${escapeHtml(String(e).slice(0, 200))}</code>\nSending originals instead.`,
          parse_mode: "HTML",
        });
        await sendAllAssets(token, chatId, a);
      }
      return;
    }
  }
}

async function sendAllAssets(token, chatId, a, opts = {}) {
  const media = [];
  if (a.backdrop && opts.skipCutout !== "backdrop") media.push({ type: "photo", media: a.backdrop, caption: `🎞 <b>Backdrop</b>`, parse_mode: "HTML" });
  if (a.poster   && opts.skipCutout !== "poster")   media.push({ type: "photo", media: a.poster,   caption: `🖼 <b>Poster</b>`,   parse_mode: "HTML" });
  if (media.length) await tg(token, "sendMediaGroup", { chat_id: chatId, media });

  const lines = [
    `🎬 <b>Title:</b> ${escapeHtml(a.title)}${a.year ? ` (${a.year})` : ""}`,
    a.logo     ? `🅰️ <b>Logo URL:</b>\n<code>${a.logo}</code>`         : `🅰️ <b>Logo URL:</b> <i>not available</i>`,
    a.backdrop ? `🎞 <b>Backdrop URL:</b>\n<code>${a.backdrop}</code>` : "",
    a.poster   ? `🖼 <b>Poster URL:</b>\n<code>${a.poster}</code>`     : "",
  ].filter(Boolean);
  await tg(token, "sendMessage", {
    chat_id: chatId,
    text: lines.join("\n\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (a.logo) {
    // Logo as a doc so Telegram keeps transparency
    await tg(token, "sendDocument", { chat_id: chatId, document: a.logo, caption: "🅰️ <b>Title Logo</b>", parse_mode: "HTML" });
  }
}

// ---------- entry -----------------------------------------------------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const workerUrl = `${url.protocol}//${url.host}`;
    const token = env.TELEGRAM_BOT_TOKEN;

    // Landing / auto-setup page
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/setup")) {
      if (!token) {
        return new Response("TELEGRAM_BOT_TOKEN secret missing.", { status: 500 });
      }
      const hook = await ensureWebhook(token, workerUrl);
      return new Response(
        `<!doctype html><meta charset=utf-8><title>${SITE_NAME} Bot</title>
<style>body{font:15px/1.55 system-ui;background:#0b0f1a;color:#e8ecff;padding:40px;max-width:640px;margin:auto}
h1{background:linear-gradient(90deg,#8b5cf6,#22d3ee);-webkit-background-clip:text;color:transparent}
code{background:#151b2e;padding:2px 8px;border-radius:6px}</style>
<h1>✅ ${SITE_NAME} Anime Asset Bot</h1>
<p>Webhook: <code>${hook.url}</code></p>
<p>Status: <b>${hook.already ? "already registered" : hook.ok ? "registered now" : "failed"}</b></p>
<p>Open your bot in Telegram and send <code>/start</code>.</p>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      if (!token) return j({ ok: false, error: "no token" }, 500);
      const update = await req.json().catch(() => null);
      if (!update) return j({ ok: false, error: "bad json" }, 400);
      // Fire-and-forget so Telegram gets 200 fast
      const p = handleUpdate(update, env, workerUrl).catch((e) => console.error("handler", e));
      if (typeof (globalThis).waitUntil === "function") (globalThis).waitUntil(p);
      else await p;
      return j({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};
