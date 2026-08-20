import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIREBASE_DB = Deno.env.get("FIREBASE_DB_URL") || "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";

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

// ============== GROUP ANIME LINK-SHARE ==============
// Users type anime name in a group where THIS bot is a member → bot replies
// with ONE consolidated card (top match + buttons for alternates + season/
// episode breakdown from Firebase). Random auto-replies eliminated via:
//   • update_id dedup (Telegram retries won't re-fire)
//   • per-chat query debounce
//   • strict trigger: `/anime <name>`, @mention, reply-to-bot, OR score ≥ 0.92
//   • hard noise-word blocklist
const SITE_URL = Deno.env.get("SITE_URL") || "https://rsanime03.lovable.app";
type CatalogItem = {
  id: string; title: string; backdrop: string; poster: string; source: "RS" | "AN";
  seasonSummary?: string; totalEpisodes?: number; totalSeasons?: number; kind?: "series" | "movie";
};
let _rsCache: { items: CatalogItem[]; ts: number } | null = null;
let _anCache: { items: CatalogItem[]; ts: number } | null = null;
const CATALOG_TTL = 10 * 60_000;
const recentGroupUpdates = new Map<number, number>(); // per (chat,message) → replied ts
const processedUpdateIds = new Set<number>();          // hard dedup for Telegram retries
const recentChatQueries = new Map<number, { q: string; ts: number }>(); // per-chat debounce
const DEDUP_CAP = 5000;

function markUpdateProcessed(id: number): boolean {
  if (!id) return false;
  if (processedUpdateIds.has(id)) return true;
  processedUpdateIds.add(id);
  if (processedUpdateIds.size > DEDUP_CAP) {
    // trim oldest by re-creating from tail entries
    const arr = Array.from(processedUpdateIds).slice(-Math.floor(DEDUP_CAP / 2));
    processedUpdateIds.clear();
    for (const v of arr) processedUpdateIds.add(v);
  }
  return false;
}

function summarizeSeasons(raw: any): { summary: string; totalEp: number; totalSeasons: number } {
  const seasons = Array.isArray(raw?.seasons) ? raw.seasons : [];
  if (!seasons.length) return { summary: "", totalEp: 0, totalSeasons: 0 };
  const lines: string[] = [];
  let totalEp = 0;
  seasons.forEach((s: any, i: number) => {
    const eps = Array.isArray(s?.episodes) ? s.episodes.length : 0;
    if (!eps) return;
    totalEp += eps;
    const name = String(s?.name || `Season ${i + 1}`).trim();
    lines.push(`📺 <b>${escHtml(name)}</b> — ${eps} Episode${eps === 1 ? "" : "s"}`);
  });
  return { summary: lines.join("\n"), totalEp, totalSeasons: lines.length };
}

async function loadRsCatalog(): Promise<CatalogItem[]> {
  if (_rsCache && Date.now() - _rsCache.ts < CATALOG_TTL) return _rsCache.items;
  const items: CatalogItem[] = [];
  const seen = new Set<string>();

  // Prefer full webseries/movies (has seasons array); fall back to index if missing.
  for (const path of ["webseries", "movies"] as const) {
    try {
      const data: any = await fbGet(path);
      if (!data) continue;
      for (const [id, raw] of Object.entries<any>(data)) {
        if (!raw || typeof raw !== "object") continue;
        const title = String((raw as any).title || (raw as any).name || "").trim();
        if (!title || seen.has(id)) continue;
        seen.add(id);
        const kind: "series" | "movie" = path === "movies" ? "movie" : "series";
        const info = kind === "series" ? summarizeSeasons(raw) : { summary: "", totalEp: 0, totalSeasons: 0 };
        items.push({
          id, title,
          backdrop: String((raw as any).backdrop || (raw as any).poster || ""),
          poster: String((raw as any).poster || (raw as any).backdrop || ""),
          source: "RS",
          kind,
          seasonSummary: info.summary,
          totalEpisodes: info.totalEp,
          totalSeasons: info.totalSeasons,
        });
      }
    } catch (e) { console.error("[loadRsCatalog]", path, e); }
  }
  _rsCache = { items, ts: Date.now() };
  return items;
}

const shareUrlFor = (item: CatalogItem) => `${SITE_URL}/watch/${encodeURIComponent(item.id)}`;

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
        items.push({ id: `as_${slug}`, title, backdrop, poster, source: "AN", kind: "series" });
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

// Extract explicit anime query if user used /anime <name> or mentioned the bot.
function extractExplicitQuery(text: string, botUsername: string | null): { query: string; isExplicit: boolean } {
  const t = text.trim();
  // /anime name  or  /find name  or  /search name
  const cmd = t.match(/^\/(anime|find|search)(?:@\w+)?\s+(.+)/i);
  if (cmd) return { query: cmd[2].trim(), isExplicit: true };
  if (botUsername) {
    const mentionRx = new RegExp(`@${botUsername}\\b`, "i");
    if (mentionRx.test(t)) {
      return { query: t.replace(mentionRx, "").trim(), isExplicit: true };
    }
  }
  return { query: t, isExplicit: false };
}

async function handleGroupQuery(
  botToken: string,
  chat_id: number,
  user_id: number,
  from: any,
  text: string,
  reply_to: number,
  isExplicit: boolean,
) {
  const q = text.trim();
  if (q.length < 3 || q.length > 200) return;

  const NOISE = new Set([
    "hi", "hello", "hey", "ok", "okay", "thanks", "thank", "bro", "bot", "lol",
    "yes", "no", "hmm", "good", "nice", "cool", "wow", "haha", "hehe", "sir", "vai", "bhai",
  ]);
  if (NOISE.has(q.toLowerCase())) return;

  // Per-chat query debounce — same query within 3s from same chat = ignore.
  const prev = recentChatQueries.get(chat_id);
  if (prev && prev.q === q.toLowerCase() && Date.now() - prev.ts < 3000) return;
  recentChatQueries.set(chat_id, { q: q.toLowerCase(), ts: Date.now() });

  // Per-message dedup
  const key = chat_id * 1_000_000_000 + reply_to;
  if (recentGroupUpdates.get(key) && Date.now() - recentGroupUpdates.get(key)! < 10 * 60_000) return;
  recentGroupUpdates.set(key, Date.now());

  const [rsAll, anAll] = await Promise.all([
    loadRsCatalog().catch(() => [] as CatalogItem[]),
    loadAnCatalog().catch(() => [] as CatalogItem[]),
  ]);

  // Stricter threshold when the message wasn't explicit — avoids random auto-replies.
  const threshold = isExplicit ? 0.75 : 0.92;
  const filterFn = (it: CatalogItem) => {
    const s = scoreItem(q, it.title);
    return s >= threshold ? { it, score: s } : null;
  };
  const rs = rsAll.map(filterFn).filter(Boolean).sort((a, b) => b!.score - a!.score) as any[];
  const an = anAll.map(filterFn).filter(Boolean).sort((a, b) => b!.score - a!.score) as any[];
  if (!rs.length && !an.length) {
    if (isExplicit) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text: `❌ No match for <code>${escHtml(q)}</code>`,
          parse_mode: "HTML",
          reply_to_message_id: reply_to,
          allow_sending_without_reply: true,
        }),
      }).catch(() => {});
    }
    return;
  }

  // Group by normalized title so RS + AN of the same anime collapse into one entry.
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
  rs.slice(0, 6).forEach((x: any) => addToGroup(x.it, x.score));
  an.slice(0, 6).forEach((x: any) => addToGroup(x.it, x.score));
  const ranked = Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 4);
  if (!ranked.length) return;

  // ONE consolidated card: top match's poster + caption + inline buttons for
  // every result. This kills the "6 replies at once" bug.
  const top = ranked[0];
  const primary = top.rs || top.an!;
  const name = escHtml([from?.first_name, from?.last_name].filter(Boolean).join(" ") || from?.username || "there");

  // Season/Episode breakdown block
  let bodyBlock = "";
  if (primary.kind === "movie") {
    bodyBlock = `🎬 <b>Full Movie</b>`;
  } else if (primary.seasonSummary && primary.totalEpisodes) {
    bodyBlock = `${primary.seasonSummary}\n\n<b>Total:</b> ${primary.totalEpisodes} Episode${primary.totalEpisodes === 1 ? "" : "s"} across ${primary.totalSeasons} Season${primary.totalSeasons === 1 ? "" : "s"}`;
  } else {
    bodyBlock = `<i>Tap below to open on the website</i>`;
  }

  const caption =
`╭─  <b>RS ANIME</b>  ─╮
│
│  🎬  <b>${escHtml(primary.title)}</b>
│  👤  <a href="tg://user?id=${user_id}">${name}</a>
│
${bodyBlock.split("\n").map(l => `│  ${l}`).join("\n")}
│
╰─  <i>Tap a button to open ↓</i>`;

  // Buttons: primary Watch on top, alternates below (max 4 total).
  const rows: any[][] = [];
  if (top.rs) rows.push([{ text: `▶️ Watch on RS ANIME`, url: shareUrlFor(top.rs) }]);
  if (top.an) rows.push([{ text: `🌸 Watch on AN (Sub/Dub)`, url: shareUrlFor(top.an) }]);
  ranked.slice(1).forEach((g) => {
    const it = g.rs || g.an!;
    rows.push([{ text: `🎯 ${truncate(it.title, 30)}`, url: shareUrlFor(it) }]);
  });
  rows.push([{ text: "🌐 Visit Website", url: SITE_URL }]);

  await sendGroupPhoto(botToken, chat_id, primary.backdrop || primary.poster, caption, reply_to, rows);
}



const ADMIN_ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const isAdminOrigin = (req: Request): boolean => {
  const check = (u: string | null) => {
    if (!u) return false;
    try { return ADMIN_ALLOWED_HOST_RX.some((rx) => rx.test(new URL(u).host)); } catch { return false; }
  };
  return check(req.headers.get("origin")) || check(req.headers.get("referer"));
};

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
      // Hard dedup against Telegram retries (fixes "random duplicate replies").
      if (typeof update.update_id === "number" && markUpdateProcessed(update.update_id)) {
        return json({ ok: true, dedup: true });
      }
      const msg = update.message || update.edited_message;
      if (msg) {
        const chatType = msg.chat?.type;
        const text: string = msg.text || msg.caption || "";

        // PRIVATE chat: ONLY /start or /help sends the welcome. Random free-text
        // no longer auto-triggers the welcome (was spammy).
        if (chatType === "private" && msg.chat?.id) {
          const firstName = String(msg.from?.first_name || "there").slice(0, 40);
          if (text.startsWith("/start") || text.startsWith("/help")) {
            sendStartMessage(botToken, msg.chat.id, firstName)
              .catch((e) => console.error("[start message]", e));
          }
        }

        // GROUP chat: anime-share.
        // Strict trigger — either explicit (/anime <name> | @mention | reply to bot)
        // OR a strong fuzzy match. Prevents random-message auto-reply floods.
        if ((chatType === "group" || chatType === "supergroup") && text && msg.from?.id) {
          const botUsername = await getBotUsername(botToken).catch(() => null);
          const repliedToBot =
            msg.reply_to_message?.from?.is_bot === true &&
            (!botUsername || msg.reply_to_message.from?.username === botUsername);
          const { query, isExplicit } = extractExplicitQuery(text, botUsername);
          const explicit = isExplicit || repliedToBot;
          // Skip pure commands unless it's our /anime family (handled by extractExplicitQuery)
          if (query && (!query.startsWith("/") || explicit)) {
            handleGroupQuery(botToken, msg.chat.id, msg.from.id, msg.from, query, msg.message_id, explicit)
              .catch((e) => console.error("[group anime share]", e));
          }
        }
      }
      return json({ ok: true });
    }



    // All non-webhook actions are admin-only — require an RS Anime site origin/referer.
    if (!isAdminOrigin(req)) {
      return json({ error: "Access denied" }, 403);
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
