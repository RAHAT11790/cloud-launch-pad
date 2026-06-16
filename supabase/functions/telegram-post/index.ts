import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIREBASE_DB = Deno.env.get("FIREBASE_DB_URL") || "https://rs-anime-default-rtdb.firebaseio.com";

async function fbGet(path: string) {
  const res = await fetch(`${FIREBASE_DB.replace(/\/$/, "")}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET failed: ${path}`);
  return await res.json();
}

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

🎬 Use the post buttons below to open content instantly!
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

// ============== GROUP ANIME LINK-SHARE (moved from link-share-bot) ==============
// Users type anime name in a group where THIS bot is a member → bot replies
// with a backdrop photo + buttons that deep-link to the website's detail page.
const SITE_URL = Deno.env.get("SITE_URL") || "https://rsanime03.lovable.app";
type CatalogItem = { id: string; title: string; backdrop: string; poster: string; source: "RS" | "AN" };
let _rsCache: { items: CatalogItem[]; ts: number } | null = null;
let _anCache: { items: CatalogItem[]; ts: number } | null = null;
const CATALOG_TTL = 10 * 60_000;
const recentGroupUpdates = new Map<number, number>();

async function loadRsCatalog(): Promise<CatalogItem[]> {
  if (_rsCache && Date.now() - _rsCache.ts < CATALOG_TTL) return _rsCache.items;
  const items: CatalogItem[] = [];
  for (const path of ["webseries", "movies"]) {
    try {
      const data: any = await fbGet(path);
      if (!data) continue;
      for (const [id, raw] of Object.entries<any>(data)) {
        if (!raw || typeof raw !== "object") continue;
        const title = String((raw as any).title || (raw as any).name || "").trim();
        if (!title) continue;
        items.push({
          id, title,
          backdrop: String((raw as any).backdrop || (raw as any).poster || ""),
          poster: String((raw as any).poster || (raw as any).backdrop || ""),
          source: "RS",
        });
      }
    } catch (e) { console.error("[loadRsCatalog]", path, e); }
  }
  _rsCache = { items, ts: Date.now() };
  return items;
}

async function loadAnCatalog(): Promise<CatalogItem[]> {
  if (_anCache && Date.now() - _anCache.ts < CATALOG_TTL) return _anCache.items;
  const items: CatalogItem[] = [];
  try {
    const data: any = await fbGet("animesaltSelected");
    if (data && typeof data === "object") {
      for (const [slug, raw] of Object.entries<any>(data)) {
        if (!raw || typeof raw !== "object") continue;
        const title = String((raw as any).title || slug || "").trim();
        if (!title) continue;
        const poster = String((raw as any).poster || (raw as any).tmdbPoster || (raw as any).posterUrl || (raw as any).backdrop || "");
        const backdrop = String((raw as any).backdrop || (raw as any).tmdbBackdrop || poster || "");
        items.push({ id: `as_${slug}`, title, backdrop, poster, source: "AN" });
      }
    }
  } catch (e) { console.error("[loadAnCatalog]", e); }
  _anCache = { items, ts: Date.now() };
  return items;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\s]/g, " ").replace(/\s+/g, " ").trim();
}
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}
function similarity(a: string, b: string): number {
  const A = normalizeTitle(a), B = normalizeTitle(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (B.includes(A) || A.includes(B)) {
    const s = Math.min(A.length, B.length), l = Math.max(A.length, B.length);
    return s / l;
  }
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}
function scoreItem(message: string, title: string): number {
  const msg = normalizeTitle(message), item = normalizeTitle(title);
  if (!msg || !item) return 0;
  if (msg.includes(item)) return 1;
  const parts = msg.split(" ").filter(Boolean);
  let best = 0;
  for (let size = Math.min(item.split(" ").length, 6); size >= 1; size--) {
    for (let start = 0; start <= parts.length - size; start++) {
      const phrase = parts.slice(start, start + size).join(" ");
      if (phrase.length < 4) continue;
      best = Math.max(best, similarity(phrase, item));
      if (best >= 1) return 1;
    }
  }
  return best;
}
function escHtml(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
async function sendGroupPhoto(botToken: string, chat_id: number, photo: string, caption: string, reply_to: number, rows: any[][]) {
  const payload = {
    chat_id, photo, caption, parse_mode: "HTML",
    reply_to_message_id: reply_to,
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: rows },
  };
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d?.ok) return d;
  } catch {}
  // fallback to text
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id, text: caption, parse_mode: "HTML",
      reply_to_message_id: reply_to, allow_sending_without_reply: true,
      reply_markup: { inline_keyboard: rows },
    }),
  }).catch(() => {});
}
async function handleGroupQuery(botToken: string, chat_id: number, user_id: number, from: any, text: string, reply_to: number) {
  const q = text.trim();
  if (q.length < 3 || q.length > 1200) return;
  const NOISE = new Set(["hi", "hello", "hey", "ok", "okay", "thanks", "thank", "bro", "bot", "lol", "yes", "no", "hmm"]);
  if (NOISE.has(q.toLowerCase())) return;
  const key = chat_id * 1_000_000_000 + reply_to;
  if (recentGroupUpdates.get(key) && Date.now() - recentGroupUpdates.get(key)! < 10 * 60_000) return;
  recentGroupUpdates.set(key, Date.now());

  const [rsAll, anAll] = await Promise.all([
    loadRsCatalog().catch(() => [] as CatalogItem[]),
    loadAnCatalog().catch(() => [] as CatalogItem[]),
  ]);
  const filterFn = (it: CatalogItem) => {
    const s = scoreItem(q, it.title);
    return s >= 0.88 ? { it, score: s } : null;
  };
  const rs = rsAll.map(filterFn).filter(Boolean).sort((a, b) => b!.score - a!.score) as any[];
  const an = anAll.map(filterFn).filter(Boolean).sort((a, b) => b!.score - a!.score) as any[];
  if (!rs.length && !an.length) return;

  type Group = { title: string; backdrop: string; rs?: CatalogItem; an?: CatalogItem; score: number };
  const groups = new Map<string, Group>();
  const addToGroup = (item: CatalogItem, score: number) => {
    const k = normalizeTitle(item.title).split(" ").slice(0, 4).join(" ");
    let g = groups.get(k);
    if (!g) { g = { title: item.title, backdrop: item.backdrop || item.poster, score }; groups.set(k, g); }
    g.score = Math.max(g.score, score);
    if (item.source === "RS" && !g.rs) g.rs = item;
    if (item.source === "AN" && !g.an) g.an = item;
    if (!g.backdrop && (item.backdrop || item.poster)) g.backdrop = item.backdrop || item.poster;
  };
  rs.slice(0, 12).forEach((x: any) => addToGroup(x.it, x.score));
  an.slice(0, 12).forEach((x: any) => addToGroup(x.it, x.score));
  const ranked = Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 6);

  const name = escHtml([from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || "there");
  for (const g of ranked) {
    const rows: any[][] = [];
    if (g.rs) rows.push([{ text: `▶️ ${truncate(g.rs.title, 22)} • RS`, url: `${SITE_URL}/anime/${encodeURIComponent(g.rs.id)}` }]);
    if (g.an) rows.push([{ text: `▶️ ${truncate(g.an.title, 22)} • AN`, url: `${SITE_URL}/anime/${encodeURIComponent(g.an.id)}` }]);
    if (!rows.length) continue;
    const caption = `╭─ <b>RS ANIME GROUP SHARE</b>\n│\n│ 👤 <a href="tg://user?id=${user_id}">${name}</a>\n│ 🎬 <b>${escHtml(g.title)}</b>\n│ ${g.rs && g.an ? "Available in both RS &amp; AN" : g.rs ? "Available in RS catalog" : "Available in AN catalog"}\n│ Tap a button below to open details\n╰─`;
    await sendGroupPhoto(botToken, chat_id, g.backdrop, caption, reply_to, rows);
  }
}


serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  if (req.method === "GET")
    return json({ ok: true, service: "telegram-post", actions: ["send", "edit-buttons", "set-webhook", "delete-webhook", "webhook-info", "get-bot-username"] });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const body = await req.json();
    if (body?.test === true) return json({ ok: true, ping: "telegram-post" });

    // ========== TELEGRAM WEBHOOK ENTRY (group anime-share) ==========
    // Telegram calls our URL directly with an `update` object — detect & handle.
    if (body?.update_id !== undefined || body?.message || body?.edited_message) {
      const update = body;
      const msg = update.message || update.edited_message;
      if (msg && (msg.chat?.type === "group" || msg.chat?.type === "supergroup")) {
        const text: string = msg.text || msg.caption || "";
        if (text && !text.startsWith("/") && msg.from?.id) {
          handleGroupQuery(botToken, msg.chat.id, msg.from.id, msg.from, text, msg.message_id)
            .catch((e) => console.error("[group anime share]", e));
        }
      }
      return json({ ok: true });
    }

    const action = String(body?.action || "send");
    const telegramBase = `https://api.telegram.org/bot${botToken}`;



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

    // 🆕 GLOBAL permanent custom button — attached to EVERY post when enabled
    try {
      const gcb = await fbGet("settings/telegramGlobalButton");
      if (gcb && gcb.enabled === true && gcb.text && gcb.url) {
        buttons.push({ text: String(gcb.text), url: String(gcb.url) });
      }
    } catch {}

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
      const username = (
        Deno.env.get("LINK_SHARE_BOT_USERNAME") ||
        Deno.env.get("RS_MINI_BOT") ||
        Deno.env.get("RS_ACCESS_BOT_USERNAME") ||
        "RS_ANIME_ACCESS_BOT"
      ).replace(/^@/, "").trim();
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
