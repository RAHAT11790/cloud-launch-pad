// =====================================================================
// Telegram Admin Bot v3 — Manual Only (RS Anime + Movies)
// =====================================================================
// Pure manual flow. No AI. Features:
//  • Stylish /start with banner + 3 buttons (Search Anime / Help / Menu)
//  • Search anime → poster + details + Seasons grid
//  • Season → Add/Delete season buttons + 3-per-row EP1/EP2/... list
//  • Episode click → direct edit (qualities), delete option
//  • Add Episode → quality buttons (Default/480/720/1080/4K) → Finish
//  • Link verify → Confirm preview (image + caption + button list) → Save
//  • Custom buttons: ➕ Add Custom Button (Permanent / One-time)
//  • Permanent buttons stored at Firebase: animeCustomButtons/{seriesId}
//  • Telegram post sent via existing telegram-post function (chatId auto)
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_TG_ID = 6621572366;
const FIREBASE_DB =
  Deno.env.get("FIREBASE_DATABASE_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const START_BANNER =
  "https://i.ibb.co.com/PsNMKqnT/IMG-20260417-065611-339.jpg";
const FALLBACK_POSTER = START_BANNER;

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---------- Firebase REST ----------
async function fbGet(path: string) {
  try {
    const r = await fetch(`${FIREBASE_DB}/${path}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
async function fbPut(path: string, data: unknown) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {}
}
async function fbPatch(path: string, data: unknown) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {}
}
async function fbDelete(path: string) {
  try {
    await fetch(`${FIREBASE_DB}/${path}.json`, { method: "DELETE" });
  } catch {}
}

// ---------- Telegram helpers ----------
function tgApi(method: string) {
  const t = Deno.env.get("TELEGRAM_BOT_TOKEN");
  return `https://api.telegram.org/bot${t}/${method}`;
}
async function tgSend(chatId: number | string, text: string, extra: any = {}) {
  const r = await fetch(tgApi("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return await r.json();
}
async function tgSendPhoto(
  chatId: number | string,
  photo: string,
  caption: string,
  extra: any = {},
) {
  const r = await fetch(tgApi("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo,
      caption,
      parse_mode: "HTML",
      ...extra,
    }),
  });
  return await r.json();
}
async function tgEdit(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: any = {},
) {
  const r = await fetch(tgApi("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return await r.json();
}
async function tgAnswerCb(cbId: string, text = "") {
  await fetch(tgApi("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}
async function tgDeleteMsg(chatId: number | string, messageId: number) {
  try {
    await fetch(tgApi("deleteMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch {}
}

// ---------- Session (per chat) ----------
type Session = {
  step?: string;
  seriesId?: string;
  collection?: "webseries" | "movies";
  seasonIdx?: number;
  episodeIdx?: number;
  newEpisodeNumber?: number;
  links?: Record<string, string>;
  pendingQuality?: string;
  customButton?: { text?: string; url?: string; mode?: "permanent" | "onetime" };
  oneTimeButtons?: Array<{ text: string; url: string }>;
  lastResults?: Array<{ id: string; collection: string; title: string }>;
};
async function getSession(chatId: number): Promise<Session> {
  const s = await fbGet(`telegramAdminSession/${chatId}`);
  return (s as Session) || {};
}
async function setSession(chatId: number, s: Session) {
  await fbPut(`telegramAdminSession/${chatId}`, s);
}
async function clearSession(chatId: number) {
  await fbDelete(`telegramAdminSession/${chatId}`);
}

// ---------- Search ----------
function normalize(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function score(query: string, title: string): number {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;
  // token match
  const qt = q.split(" ").filter(Boolean);
  const tt = t.split(" ").filter(Boolean);
  let hit = 0;
  for (const tok of qt) if (tt.some((x) => x.startsWith(tok))) hit++;
  return Math.round((hit / qt.length) * 70);
}
async function searchAnime(
  query: string,
): Promise<Array<{ id: string; collection: string; title: string; poster?: string; data: any }>> {
  const results: Array<{ id: string; collection: string; title: string; poster?: string; data: any; sc: number }> = [];
  for (const col of ["webseries", "movies"]) {
    const all = (await fbGet(col)) || {};
    if (!all || typeof all !== "object") continue;
    for (const [id, item] of Object.entries(all as any)) {
      const it: any = item;
      if (!it || typeof it !== "object") continue;
      const title = String(it.title || it.name || "");
      const sc = score(query, title);
      if (sc >= 40) {
        results.push({
          id,
          collection: col,
          title,
          poster: it.backdrop || it.poster,
          data: it,
          sc,
        });
      }
    }
  }
  results.sort((a, b) => b.sc - a.sc);
  return results.slice(0, 8).map(({ sc, ...rest }) => rest);
}

// ---------- UI Builders ----------
function startKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔎 Search Anime", callback_data: "act:search" }],
      [{ text: "🆕 Add New Anime", callback_data: "act:addnew" }],
      [
        { text: "📋 Menu", callback_data: "act:menu" },
        { text: "❓ Help", callback_data: "act:help" },
      ],
    ],
  };
}

const TMDB_KEY = "8265bd1679663a7ea12ac168da84d2e8";

async function tmdbSearch(query: string) {
  try {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&include_adult=false`;
    const r = await fetch(url);
    const j = await r.json();
    return (j?.results || []).filter((x: any) => x.media_type === "tv" || x.media_type === "movie").slice(0, 8);
  } catch {
    return [];
  }
}

async function tmdbDetails(mediaType: string, tmdbId: number) {
  try {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
    const r = await fetch(url);
    return await r.json();
  } catch {
    return null;
  }
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Website-style Telegram post helpers ----------
// Reads the SAME settings the website Admin panel writes (admin/*).
// Channel IDs: admin/telegramChannel (comma/newline separated). Fallback: settings/telegramChatId.
async function getPostChannelIds(): Promise<string[]> {
  const raw = (await fbGet("admin/telegramChannel")) as string | null;
  let ids: string[] = [];
  if (raw && typeof raw === "string") {
    ids = raw.split(/[,\n\s]+/).map((x) => x.trim()).filter(Boolean);
  }
  if (ids.length === 0) {
    const fb = await fbGet("settings/telegramChatId");
    if (fb && typeof fb === "string") ids = [fb.trim()];
    else if (typeof fb === "number") ids = [String(fb)];
  }
  return ids;
}

// Build the EXACT same caption format the website's Admin "Telegram Post" sends.
async function buildWebsiteCaption(opts: {
  title: string;
  season: string | number;
  totalEpisodes: string | number;
  newEpAdded: string | number;
  rating?: string | number;
  genres?: string;
}): Promise<string> {
  const quality = ((await fbGet("admin/tgQuality")) as string) || "480p,720p,1080p,4K";
  const languages = ((await fbGet("admin/tgLanguages")) as string) || "Hindi";
  const dubType = ((await fbGet("admin/tgDubType")) as string) || "official";
  const hashtags =
    ((await fbGet("admin/tgHashtags")) as string) || "#ɪᴄғᴀɴɪᴍᴇ #ᴀɴɪᴍᴇ #ᴏғғɪᴄɪᴀʟ";
  const footerArr = ((await fbGet("admin/tgFooterLinks")) as Array<{
    label: string;
    url: string;
    emoji: string;
  }>) || [];
  const footerLinksHtml = footerArr
    .filter((l) => l?.label && l?.url)
    .map((l) => `๏ ${l.emoji || "🔰"} <a href="${l.url}">${escapeHtml(l.label)}</a> ${l.emoji || "🔰"}`)
    .join("\n");

  const dubTag = dubType === "fandub" ? "#ғᴀɴᴅᴜʙ" : "#ᴏғғɪᴄɪᴀʟ";
  const ratingStr = opts.rating ? `${opts.rating}` : "0.0";
  const genresStr = opts.genres || "—";

  return (
    `♨️ <b>Tɪᴛᴇʟ;-</b> ${escapeHtml(String(opts.title))}\n` +
    `┌──────────────────\n` +
    `│ ✦ <b>Sᴇᴀsᴏɴ :</b> ${opts.season}\n` +
    `│ ✦ <b>Eᴘɪsᴏᴅᴇs :</b> ${opts.totalEpisodes}\n` +
    `│ ✦ <b>Aᴜᴅɪᴏ :</b> 🎧 ${escapeHtml(languages)} ${dubTag}\n` +
    `│ ✦ <b>Qᴜᴀʟɪᴛʏ :</b> ${escapeHtml(quality)}\n` +
    `│ ✦ <b>Rᴀᴛɪɴɢ :</b> ⭐ ${ratingStr}/10\n` +
    `│ ✦ <b>Gᴇɴʀᴇs :</b> ${escapeHtml(genresStr)}\n` +
    `└──────────────────\n` +
    `▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰\n` +
    `📌 Sᴇᴀsᴏɴ #${opts.season} • Eᴘɪsᴏᴅᴇ #${opts.newEpAdded} Aᴅᴅᴇᴅ\n` +
    `▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰\n` +
    (footerLinksHtml ? `${footerLinksHtml}\n` : "") +
    `▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▰\n` +
    hashtags
  );
}

// Send to ALL configured channels via the existing telegram-post edge function.
// Also saves a record in Firebase telegramPosts/<key> so the website URL Changer can edit/delete it.
async function postToAllChannels(payload: {
  caption: string;
  photoUrl?: string;
  inlineButtons: Array<{ text: string; url: string }>;
  collection?: string;
  seriesId?: string;
  title?: string;
}): Promise<{ posted: number; failed: number; errors: string[] }> {
  const channels = await getPostChannelIds();
  if (channels.length === 0) {
    return { posted: 0, failed: 1, errors: ["No channel configured. Set admin/telegramChannel or settings/telegramChatId in website Admin."] };
  }
  let posted = 0,
    failed = 0;
  const errors: string[] = [];
  for (const ch of channels) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/telegram-post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          chatId: ch,
          caption: payload.caption,
          photoUrl: payload.photoUrl,
          buttonText: payload.inlineButtons[0]?.text,
          buttonUrl: payload.inlineButtons[0]?.url,
          inlineButtons: payload.inlineButtons.length > 1 ? payload.inlineButtons : undefined,
          collection: payload.collection,
          seriesId: payload.seriesId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j?.error) {
        posted++;
        // Mirror website behaviour — save record so URL Changer can manage it later
        const msgId = j?.result?.message_id || j?.message_id;
        if (msgId) {
          const safeKey = `${String(ch).replace(/[^a-zA-Z0-9_-]/g, "_")}_${msgId}`;
          await fbPut(`telegramPosts/${safeKey}`, {
            chatId: ch,
            messageId: msgId,
            title: payload.title || "",
            poster: payload.photoUrl || "",
            buttons: payload.inlineButtons,
            sentAt: Date.now(),
            source: "bot",
          });
        }
      } else {
        failed++;
        errors.push(`${ch}: ${j?.error || "API error"}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${ch}: ${e?.message || "fetch failed"}`);
    }
  }
  return { posted, failed, errors };
}

async function sendStart(chatId: number) {
  const text =
    `<b>━━━━━━━━━━━━━━━━━━━</b>\n` +
    `   🎌 <b>𝐑𝐒 𝐀𝐍𝐈𝐌𝐄 — 𝐀𝐃𝐌𝐈𝐍 𝐁𝐎𝐓</b>\n` +
    `<b>━━━━━━━━━━━━━━━━━━━</b>\n\n` +
    `👋 <i>Welcome, Admin!</i>\n\n` +
    `🛠 <b>Manual Control Panel</b>\n` +
    `   • Search any anime / movie\n` +
    `   • Add / Edit / Delete episodes\n` +
    `   • Send styled posts to Telegram\n\n` +
    `<i>Tap a button below to begin.</i>`;
  await tgSendPhoto(chatId, START_BANNER, text, { reply_markup: startKeyboard() });
}

async function sendHelp(chatId: number) {
  const text =
    `<b>📖 𝐇𝐎𝐖 𝐓𝐎 𝐔𝐒𝐄</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n\n` +
    `1️⃣ Tap <b>🔎 Search Anime</b>\n` +
    `2️⃣ Type the anime name\n` +
    `3️⃣ Pick the correct match\n` +
    `4️⃣ Choose a season\n` +
    `5️⃣ See <b>EP1, EP2…</b> grid (3 per row)\n` +
    `6️⃣ Tap any episode to edit/delete\n` +
    `7️⃣ Tap <b>➕ Add Episode</b> to add a new one\n\n` +
    `<b>Quality flow:</b> Default → 480p → 720p → 1080p → 4K → ✅ Finish\n` +
    `<b>Custom button:</b> Permanent (saved) or One-time (this post only).\n\n` +
    `<i>Use /start to return home anytime.</i>`;
  await tgSend(chatId, text, { reply_markup: startKeyboard() });
}

// ---------- Anime detail view ----------
async function showAnime(chatId: number, collection: string, id: string) {
  const data = await fbGet(`${collection}/${id}`);
  if (!data) {
    await tgSend(chatId, "❌ Anime not found.");
    return;
  }
  const title = data.title || data.name || "Untitled";
  const year = data.year ? ` (${data.year})` : "";
  const rating = data.rating ? ` ⭐ ${data.rating}` : "";
  const lang = data.language ? `\n🗣 ${data.language}` : "";
  const dub = data.dubType ? ` • ${data.dubType}` : "";
  const cat = data.category ? `\n📂 ${data.category}` : "";
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const totalEps = seasons.reduce(
    (n: number, s: any) => n + (Array.isArray(s?.episodes) ? s.episodes.length : 0),
    0,
  );

  const caption =
    `<b>🎬 ${escapeHtml(title)}</b>${escapeHtml(year)}${escapeHtml(rating)}\n` +
    `<b>━━━━━━━━━━━━━━━</b>${cat}${lang}${dub}\n` +
    `📚 Seasons: <b>${seasons.length}</b>\n` +
    `🎞 Episodes: <b>${totalEps}</b>\n\n` +
    `<i>Pick a season to manage:</i>`;

  const rows: any[][] = [];
  // Season buttons (3 per row)
  let row: any[] = [];
  for (let i = 0; i < seasons.length; i++) {
    row.push({
      text: `S${seasons[i]?.seasonNumber || i + 1}`,
      callback_data: `season:${collection}:${id}:${i}`,
    });
    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([
    { text: "➕ Add Season", callback_data: `addseason:${collection}:${id}` },
  ]);
  if (seasons.length > 0) {
    rows.push([
      { text: "🗑 Delete Season", callback_data: `delseason_pick:${collection}:${id}` },
    ]);
  }
  rows.push([
    { text: "📤 Send Telegram Post", callback_data: `post:${collection}:${id}::` },
    { text: "🏠 Home", callback_data: "act:home" },
  ]);

  const poster = data.backdrop || data.poster || FALLBACK_POSTER;
  await tgSendPhoto(chatId, poster, caption, {
    reply_markup: { inline_keyboard: rows },
  });
}

// ---------- Season episode grid ----------
async function showSeason(
  chatId: number,
  collection: string,
  id: string,
  seasonIdx: number,
) {
  const data = await fbGet(`${collection}/${id}`);
  if (!data) {
    await tgSend(chatId, "❌ Anime not found.");
    return;
  }
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const season = seasons[seasonIdx];
  if (!season) {
    await tgSend(chatId, "❌ Season not found.");
    return;
  }
  const title = data.title || "Untitled";
  const eps = Array.isArray(season.episodes) ? season.episodes : [];

  const text =
    `<b>🎬 ${escapeHtml(title)}</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    `📚 Season <b>${season.seasonNumber || seasonIdx + 1}</b>\n` +
    `🎞 Episodes: <b>${eps.length}</b>\n\n` +
    `<i>Tap an episode to edit. Tap ➕ to add new.</i>`;

  const rows: any[][] = [];
  let row: any[] = [];
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    const epNum = ep?.episodeNumber || i + 1;
    row.push({
      text: `EP${epNum}`,
      callback_data: `ep:${collection}:${id}:${seasonIdx}:${i}`,
    });
    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);

  rows.push([
    {
      text: "➕ Add Episode",
      callback_data: `addep:${collection}:${id}:${seasonIdx}`,
    },
    {
      text: "📥 Bulk Import",
      callback_data: `bulk:${collection}:${id}:${seasonIdx}`,
    },
  ]);
  rows.push([
    { text: "⬅ Back", callback_data: `back:${collection}:${id}` },
    { text: "🏠 Home", callback_data: "act:home" },
  ]);

  await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
}

// ---------- Bulk Import: JSON / TXT parser ----------
type ParsedEp = {
  episodeNumber: number;
  link?: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  title?: string;
};

function normalizeQualityKey(k: string): string | null {
  const x = String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!x) return null;
  if (x === "default" || x === "auto" || x === "main" || x === "link") return "link";
  if (x === "480" || x === "480p" || x === "sd") return "link480";
  if (x === "720" || x === "720p" || x === "hd") return "link720";
  if (x === "1080" || x === "1080p" || x === "fhd") return "link1080";
  if (x === "4k" || x === "2160" || x === "2160p" || x === "uhd") return "link4k";
  return null;
}

function parseEpisodesJSON(raw: any): ParsedEp[] {
  const out: ParsedEp[] = [];
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (Array.isArray(raw?.episodes)) arr = raw.episodes;
  else if (Array.isArray(raw?.seasons?.[0]?.episodes)) arr = raw.seasons[0].episodes;
  else if (raw && typeof raw === "object") arr = Object.values(raw);
  for (let i = 0; i < arr.length; i++) {
    const e: any = arr[i];
    if (!e || typeof e !== "object") continue;
    const epNum = Number(
      e.episodeNumber ?? e.episode ?? e.ep ?? e.number ?? e.no ?? i + 1,
    );
    const ep: ParsedEp = { episodeNumber: epNum };
    if (e.title) ep.title = String(e.title);
    // direct fields
    if (e.link) ep.link = String(e.link);
    if (e.link480) ep.link480 = String(e.link480);
    if (e.link720) ep.link720 = String(e.link720);
    if (e.link1080) ep.link1080 = String(e.link1080);
    if (e.link4k) ep.link4k = String(e.link4k);
    // alternate keyed shape
    for (const [k, v] of Object.entries(e)) {
      if (typeof v !== "string") continue;
      const nk = normalizeQualityKey(k);
      if (nk && !(ep as any)[nk]) (ep as any)[nk] = v;
    }
    // links: { "480": "...", ... }
    if (e.links && typeof e.links === "object") {
      for (const [k, v] of Object.entries(e.links)) {
        if (typeof v !== "string") continue;
        const nk = normalizeQualityKey(k);
        if (nk && !(ep as any)[nk]) (ep as any)[nk] = v;
      }
    }
    if (
      ep.link || ep.link480 || ep.link720 || ep.link1080 || ep.link4k
    ) {
      out.push(ep);
    }
  }
  return out;
}

function parseEpisodesTXT(text: string): ParsedEp[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const map = new Map<number, ParsedEp>();
  let currentEp: number | null = null;

  const epHeader = /^(?:ep(?:isode)?\s*)?#?\s*(\d{1,4})\s*[:\-|]?\s*(.*)$/i;

  for (const raw of lines) {
    const line = raw.replace(/^[\-\*•▶➤]+\s*/, "");

    // Pattern A: "EP1 | default=URL | 480=URL"
    const pipeMatch = line.match(/^ep(?:isode)?\s*#?(\d+)\s*[|:\-]\s*(.+)$/i);
    if (pipeMatch && /=|\s(480|720|1080|4k|default)/i.test(pipeMatch[2])) {
      const num = Number(pipeMatch[1]);
      const ep = map.get(num) || { episodeNumber: num };
      const parts = pipeMatch[2].split(/[|,;]+/);
      for (const p of parts) {
        const m = p.trim().match(/^(\w+)\s*[=:]\s*(https?:\/\/\S+)/i);
        if (m) {
          const nk = normalizeQualityKey(m[1]);
          if (nk) (ep as any)[nk] = m[2];
        } else {
          const u = p.trim().match(/(https?:\/\/\S+)/);
          if (u && !ep.link) ep.link = u[1];
        }
      }
      map.set(num, ep);
      currentEp = num;
      continue;
    }

    // Pattern B: "EP1: URL"  or  "Episode 1 - URL"
    const simple = line.match(/^ep(?:isode)?\s*#?(\d+)\s*[:\-|]\s*(https?:\/\/\S+)/i);
    if (simple) {
      const num = Number(simple[1]);
      const ep = map.get(num) || { episodeNumber: num };
      if (!ep.link) ep.link = simple[2];
      map.set(num, ep);
      currentEp = num;
      continue;
    }

    // Pattern C: header only "EP1"
    const header = line.match(/^ep(?:isode)?\s*#?(\d+)\s*[:\-]?\s*$/i);
    if (header) {
      currentEp = Number(header[1]);
      if (!map.has(currentEp)) map.set(currentEp, { episodeNumber: currentEp });
      continue;
    }

    // Pattern D: under a current ep, lines like "480: URL" or "720p - URL"
    if (currentEp !== null) {
      const qm = line.match(/^(default|auto|480p?|720p?|1080p?|4k|2160p?)\s*[:\-=]\s*(https?:\/\/\S+)/i);
      if (qm) {
        const ep = map.get(currentEp)!;
        const nk = normalizeQualityKey(qm[1]);
        if (nk) (ep as any)[nk] = qm[2];
        map.set(currentEp, ep);
        continue;
      }
      const justUrl = line.match(/^(https?:\/\/\S+)/);
      if (justUrl) {
        const ep = map.get(currentEp)!;
        if (!ep.link) ep.link = justUrl[1];
        map.set(currentEp, ep);
        continue;
      }
    }

    // Fallback: standalone URL — auto increment
    const standaloneUrl = line.match(/^(https?:\/\/\S+)/);
    if (standaloneUrl) {
      const num = (currentEp ?? 0) + 1;
      currentEp = num;
      const ep = map.get(num) || { episodeNumber: num };
      if (!ep.link) ep.link = standaloneUrl[1];
      map.set(num, ep);
    }
  }

  return Array.from(map.values())
    .filter((e) => e.link || e.link480 || e.link720 || e.link1080 || e.link4k)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function parseBulkInput(text: string): ParsedEp[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Try JSON first
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const j = JSON.parse(trimmed);
      const eps = parseEpisodesJSON(j);
      if (eps.length) return eps;
    } catch {
      // fall through to TXT
    }
  }
  return parseEpisodesTXT(trimmed);
}

// Download file from Telegram
async function tgDownloadFile(fileId: string): Promise<string | null> {
  try {
    const t = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const r = await fetch(tgApi("getFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const j = await r.json();
    const fp = j?.result?.file_path;
    if (!fp) return null;
    const dl = await fetch(`https://api.telegram.org/file/bot${t}/${fp}`);
    if (!dl.ok) return null;
    return await dl.text();
  } catch {
    return null;
  }
}

async function startBulkImport(
  chatId: number,
  collection: string,
  seriesId: string,
  seasonIdx: number,
) {
  await setSession(chatId, {
    step: "bulk_wait",
    collection: collection as any,
    seriesId,
    seasonIdx,
  });
  await tgSend(
    chatId,
    `<b>📥 Bulk Import — Season ${seasonIdx + 1}</b>\n` +
      `<b>━━━━━━━━━━━━━━━</b>\n\n` +
      `Send episodes in any of these ways:\n\n` +
      `<b>1) Paste JSON</b> array of episodes\n` +
      `<b>2) Paste TXT</b> like:\n` +
      `<code>EP1 | default=URL | 720=URL\nEP2 | default=URL</code>\n\n` +
      `<b>3) Upload .json or .txt file</b>\n\n` +
      `<i>I'll parse, verify links, then ask you to confirm before posting.</i>`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "❌ Cancel", callback_data: `season:${collection}:${seriesId}:${seasonIdx}` },
        ]],
      },
    },
  );
}

async function processBulkParsed(chatId: number, eps: ParsedEp[]) {
  const s = await getSession(chatId);
  if (!s.seriesId || !s.collection || s.seasonIdx === undefined) {
    await tgSend(chatId, "❌ Session lost. Try again.");
    return;
  }
  if (eps.length === 0) {
    await tgSend(
      chatId,
      "❌ <b>No episodes found</b> in your input.\n\n<i>Check the format and try again.</i>",
    );
    return;
  }

  // Verify all links per episode
  const progressMsg = await tgSend(
    chatId,
    `🔄 <b>Verifying ${eps.length} episodes...</b>`,
  );
  const msgId = progressMsg?.result?.message_id;

  const results: Array<{ ep: ParsedEp; broken: string[]; ok: string[] }> = [];
  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    const broken: string[] = [];
    const ok: string[] = [];
    const checks: Array<[string, string | undefined]> = [
      ["default", ep.link],
      ["480", ep.link480],
      ["720", ep.link720],
      ["1080", ep.link1080],
      ["4k", ep.link4k],
    ];
    for (const [q, url] of checks) {
      if (!url) continue;
      const good = await verifyLink(url);
      if (good) ok.push(q);
      else broken.push(q);
    }
    results.push({ ep, broken, ok });
    if (msgId) {
      const bar = "▰".repeat(i + 1) + "▱".repeat(eps.length - i - 1);
      await tgEdit(
        chatId,
        msgId,
        `🔄 <b>Verifying...</b>\n${bar} ${i + 1}/${eps.length}`,
      );
    }
  }
  if (msgId) await tgDeleteMsg(chatId, msgId);

  // Save parsed eps to temp for confirm step
  await fbPut(`telegramAdminBulk/${chatId}`, {
    collection: s.collection,
    seriesId: s.seriesId,
    seasonIdx: s.seasonIdx,
    episodes: eps,
  });

  let text =
    `<b>📥 Bulk Import Result</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    `📦 Total parsed: <b>${eps.length}</b>\n\n`;

  const brokenEps = results.filter((r) => r.broken.length > 0);
  const okEps = results.filter((r) => r.broken.length === 0);

  text += `✅ <b>${okEps.length} OK</b> · ❌ <b>${brokenEps.length} broken</b>\n\n`;

  for (const r of results.slice(0, 20)) {
    const status = r.broken.length === 0 ? "✅" : "⚠️";
    const detail = r.broken.length === 0
      ? `(${r.ok.join(", ")})`
      : `<b>broken:</b> ${r.broken.join(", ")}`;
    text += `${status} <b>EP${r.ep.episodeNumber}</b> ${detail}\n`;
  }
  if (results.length > 20) text += `\n<i>... and ${results.length - 20} more</i>\n`;

  const rows: any[][] = [];
  if (brokenEps.length > 0) {
    // edit buttons for broken eps (max 10)
    const editRow: any[] = [];
    for (const r of brokenEps.slice(0, 10)) {
      editRow.push({
        text: `✏️ EP${r.ep.episodeNumber}`,
        callback_data: `bulkedit:${r.ep.episodeNumber}`,
      });
      if (editRow.length === 3) {
        rows.push([...editRow]);
        editRow.length = 0;
      }
    }
    if (editRow.length) rows.push(editRow);
  }
  rows.push([
    { text: `✅ Confirm & Post All (${eps.length})`, callback_data: "bulk_confirm_all" },
  ]);
  if (okEps.length < eps.length && okEps.length > 0) {
    rows.push([
      { text: `📤 Post only OK ones (${okEps.length})`, callback_data: "bulk_confirm_ok" },
    ]);
  }
  rows.push([{ text: "❌ Cancel", callback_data: "bulk_cancel" }]);

  await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
}

async function bulkConfirmAndPost(chatId: number, onlyOk: boolean) {
  const blob: any = await fbGet(`telegramAdminBulk/${chatId}`);
  if (!blob) {
    await tgSend(chatId, "❌ Bulk session expired.");
    return;
  }
  const { collection, seriesId, seasonIdx } = blob;
  let eps: ParsedEp[] = blob.episodes || [];

  // Filter OK only if requested
  if (onlyOk) {
    const filtered: ParsedEp[] = [];
    for (const ep of eps) {
      const checks: Array<[string, string | undefined]> = [
        ["default", ep.link],
        ["480", ep.link480],
        ["720", ep.link720],
        ["1080", ep.link1080],
        ["4k", ep.link4k],
      ];
      let allOk = true;
      for (const [, url] of checks) {
        if (!url) continue;
        if (!(await verifyLink(url))) {
          allOk = false;
          break;
        }
      }
      if (allOk) filtered.push(ep);
    }
    eps = filtered;
  }

  if (eps.length === 0) {
    await tgSend(chatId, "❌ No episodes to post.");
    return;
  }

  // Save all episodes to Firebase
  const data = await fbGet(`${collection}/${seriesId}`);
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  const season = seasons[seasonIdx];
  if (!season) {
    await tgSend(chatId, "❌ Season not found.");
    return;
  }
  const existingEps = Array.isArray(season.episodes) ? season.episodes : [];

  for (const ep of eps) {
    const epObj: any = {
      episodeNumber: ep.episodeNumber,
      title: ep.title || `Episode ${ep.episodeNumber}`,
      link: ep.link || "",
      link480: ep.link480 || "",
      link720: ep.link720 || "",
      link1080: ep.link1080 || "",
      link4k: ep.link4k || "",
    };
    const idx = existingEps.findIndex(
      (e: any) => Number(e?.episodeNumber) === Number(ep.episodeNumber),
    );
    if (idx >= 0) existingEps[idx] = { ...existingEps[idx], ...epObj };
    else existingEps.push(epObj);
  }
  existingEps.sort(
    (a: any, b: any) => Number(a.episodeNumber) - Number(b.episodeNumber),
  );
  season.episodes = existingEps;
  seasons[seasonIdx] = season;
  await fbPatch(`${collection}/${seriesId}`, {
    seasons,
    updatedAt: Date.now(),
  });

  // Send Telegram post for each episode (website-style format → all configured channels)
  const sNum = season.seasonNumber || seasonIdx + 1;
  const photoUrl = data.backdrop || data.poster || FALLBACK_POSTER;
  const permanent = ((await fbGet(`animeCustomButtons/${seriesId}`)) as any[]) || [];
  const totalEps = (season.episodes || []).length;

  const progressMsg = await tgSend(
    chatId,
    `📤 <b>Posting ${eps.length} episodes to Telegram...</b>`,
  );
  const pmId = progressMsg?.result?.message_id;
  let posted = 0;
  let failed = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < eps.length; i++) {
    const ep = eps[i];
    const buttons: Array<{ text: string; url: string }> = [
      {
        text: `▶️ Watch S${sNum} EP${ep.episodeNumber}`,
        url: `https://rsanime03.lovable.app/?anime=${seriesId}&season=${sNum}&episode=${ep.episodeNumber}`,
      },
    ];
    if (Array.isArray(permanent)) {
      for (const b of permanent) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
    }
    const caption = await buildWebsiteCaption({
      title: data.title || "Untitled",
      season: sNum,
      totalEpisodes: totalEps,
      newEpAdded: ep.episodeNumber,
      rating: data.rating,
      genres: data.category,
    });
    const res = await postToAllChannels({
      caption,
      photoUrl,
      inlineButtons: buttons,
      collection,
      seriesId,
    });
    if (res.posted > 0) posted++;
    if (res.failed > 0) {
      failed++;
      allErrors.push(...res.errors);
    }
    if (pmId) {
      const bar = "▰".repeat(i + 1) + "▱".repeat(eps.length - i - 1);
      await tgEdit(
        chatId,
        pmId,
        `📤 <b>Posting...</b>\n${bar} ${i + 1}/${eps.length}\n✅ ${posted} · ❌ ${failed}`,
      );
    }
  }
  if (pmId) await tgDeleteMsg(chatId, pmId);
  if (allErrors.length > 0) {
    await tgSend(
      chatId,
      `⚠️ <b>Failed:</b>\n<code>${escapeHtml(allErrors.slice(0, 5).join("\n"))}</code>`,
    );
  }

  await fbDelete(`telegramAdminBulk/${chatId}`);
  await clearSession(chatId);

  await tgSend(
    chatId,
    `<b>✅ Bulk Import Complete</b>\n` +
      `<b>━━━━━━━━━━━━━━━</b>\n` +
      `💾 Saved: <b>${eps.length}</b> episodes\n` +
      `📤 Posted: <b>${posted}</b>\n` +
      (failed > 0 ? `❌ Failed posts: <b>${failed}</b>\n` : "") +
      `\n<i>Open the season to verify.</i>`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📺 Open Season", callback_data: `season:${collection}:${seriesId}:${seasonIdx}` }],
          [{ text: "🏠 Home", callback_data: "act:home" }],
        ],
      },
    },
  );
}

// ---------- Episode edit view ----------
async function showEpisode(
  chatId: number,
  collection: string,
  id: string,
  seasonIdx: number,
  epIdx: number,
) {
  const data = await fbGet(`${collection}/${id}`);
  const season = data?.seasons?.[seasonIdx];
  const ep = season?.episodes?.[epIdx];
  if (!ep) {
    await tgSend(chatId, "❌ Episode not found.");
    return;
  }
  const epNum = ep.episodeNumber || epIdx + 1;
  const fmt = (l: string) => (l ? "✅" : "—");
  const text =
    `<b>🎞 ${escapeHtml(data.title)} — S${season.seasonNumber} EP${epNum}</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    `<b>Default :</b> ${fmt(ep.link)}\n` +
    `<b>480p    :</b> ${fmt(ep.link480)}\n` +
    `<b>720p    :</b> ${fmt(ep.link720)}\n` +
    `<b>1080p   :</b> ${fmt(ep.link1080)}\n` +
    `<b>4K      :</b> ${fmt(ep.link4k)}\n\n` +
    `<i>Choose a quality to edit, or delete this episode.</i>`;

  // Seed session links from current
  await setSession(chatId, {
    step: "edit_links",
    seriesId: id,
    collection: collection as any,
    seasonIdx,
    episodeIdx: epIdx,
    newEpisodeNumber: epNum,
    links: {
      default: ep.link || "",
      "480": ep.link480 || "",
      "720": ep.link720 || "",
      "1080": ep.link1080 || "",
      "4k": ep.link4k || "",
    },
  });

  const rows = [
    [
      { text: "📺 Default", callback_data: `q:default` },
      { text: "480p", callback_data: `q:480` },
    ],
    [
      { text: "720p", callback_data: `q:720` },
      { text: "1080p", callback_data: `q:1080` },
    ],
    [
      { text: "4K", callback_data: `q:4k` },
      { text: "✅ Finish", callback_data: `q:finish` },
    ],
    [
      { text: "📤 Resend to Telegram", callback_data: `resend:${collection}:${id}:${seasonIdx}:${epIdx}` },
    ],
    [
      { text: "🗑 Delete EP", callback_data: `delep:${collection}:${id}:${seasonIdx}:${epIdx}` },
    ],
    [
      { text: "⬅ Back", callback_data: `season:${collection}:${id}:${seasonIdx}` },
      { text: "🏠 Home", callback_data: "act:home" },
    ],
  ];
  await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
}

// ---------- Add episode flow ----------
async function startAddEpisode(
  chatId: number,
  collection: string,
  id: string,
  seasonIdx: number,
) {
  const data = await fbGet(`${collection}/${id}`);
  const season = data?.seasons?.[seasonIdx];
  const eps = Array.isArray(season?.episodes) ? season.episodes : [];
  const nextNum =
    eps.length > 0
      ? Math.max(...eps.map((e: any) => Number(e?.episodeNumber || 0))) + 1
      : 1;
  await setSession(chatId, {
    step: "add_links",
    seriesId: id,
    collection: collection as any,
    seasonIdx,
    newEpisodeNumber: nextNum,
    links: { default: "", "480": "", "720": "", "1080": "", "4k": "" },
  });
  const text =
    `<b>➕ Add Episode ${nextNum}</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    `<i>Pick a quality, send the link, then tap next quality. When done tap ✅ Finish.</i>`;
  const rows = [
    [
      { text: "📺 Default", callback_data: `q:default` },
      { text: "480p", callback_data: `q:480` },
    ],
    [
      { text: "720p", callback_data: `q:720` },
      { text: "1080p", callback_data: `q:1080` },
    ],
    [
      { text: "4K", callback_data: `q:4k` },
      { text: "✅ Finish", callback_data: `q:finish` },
    ],
    [
      { text: "❌ Cancel", callback_data: `season:${collection}:${id}:${seasonIdx}` },
    ],
  ];
  await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
}

// ---------- Quality buttons inside add/edit ----------
async function promptQualityLink(chatId: number, q: string) {
  const s = await getSession(chatId);
  s.pendingQuality = q;
  s.step = s.step === "edit_links" ? "edit_wait_link" : "add_wait_link";
  await setSession(chatId, s);
  const cur = s.links?.[q] || "";
  const label =
    q === "default" ? "Default" : q === "4k" ? "4K" : `${q}p`;
  await tgSend(
    chatId,
    `📥 Send the <b>${label}</b> link now.\n\n` +
      (cur ? `<i>Current:</i> <code>${escapeHtml(cur)}</code>\n\n` : "") +
      `Type <code>skip</code> to leave empty.`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: "⬅ Back to Qualities", callback_data: "back:qualities" }]],
      },
    },
  );
}

// ---------- Link verification ----------
async function verifyLink(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (r.ok) return true;
    if (r.status === 405) {
      const r2 = await fetch(url, { method: "GET", headers: { Range: "bytes=0-512" } });
      return r2.ok || r2.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

async function showFinishVerify(chatId: number) {
  const s = await getSession(chatId);
  if (!s.links) return;
  const qualities = ["default", "480", "720", "1080", "4k"];
  const present = qualities.filter((q) => s.links?.[q]);
  if (present.length === 0) {
    await tgSend(chatId, "⚠️ No links provided. Add at least one quality.");
    return;
  }
  const progressMsg = await tgSend(
    chatId,
    `🔄 <b>Verifying links...</b>\n<i>Please wait</i>`,
  );
  const msgId = progressMsg?.result?.message_id;
  const results: Record<string, boolean> = {};
  let i = 0;
  for (const q of present) {
    results[q] = await verifyLink(s.links[q]);
    i++;
    if (msgId) {
      const bar =
        "▰".repeat(i) + "▱".repeat(present.length - i);
      await tgEdit(
        chatId,
        msgId,
        `🔄 <b>Verifying links...</b>\n${bar} ${i}/${present.length}`,
      );
    }
  }
  if (msgId) await tgDeleteMsg(chatId, msgId);

  const broken = Object.entries(results).filter(([_, ok]) => !ok).map(([q]) => q);
  const okList = Object.entries(results).filter(([_, ok]) => ok).map(([q]) => q);

  const fmt = (q: string) => (q === "default" ? "Default" : q === "4k" ? "4K" : `${q}p`);
  let text =
    `<b>🔍 Link Check Result</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n`;
  for (const q of present) {
    text += `${results[q] ? "✅" : "❌"} <b>${fmt(q)}</b>\n`;
  }

  if (broken.length === 0) {
    text += `\n<b>All links OK.</b> Tap below to preview & confirm.`;
    await tgSend(chatId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "👁 Preview & Confirm", callback_data: "preview" }]],
      },
    });
  } else {
    text += `\n⚠️ <b>${broken.length} broken.</b> Re-add or skip them.`;
    const rows: any[][] = broken.map((q) => [
      { text: `✏️ Re-add ${fmt(q)}`, callback_data: `q:${q}` },
      { text: `⏭ Skip ${fmt(q)}`, callback_data: `skipq:${q}` },
    ]);
    rows.push([{ text: "👁 Preview Anyway", callback_data: "preview" }]);
    await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
  }
}

// ---------- Preview & confirm ----------
async function showPreview(chatId: number) {
  const s = await getSession(chatId);
  if (!s.seriesId || !s.collection) return;
  const data = await fbGet(`${s.collection}/${s.seriesId}`);
  if (!data) return;
  const season = data.seasons?.[s.seasonIdx ?? 0];
  const epNum = s.newEpisodeNumber || 1;
  const sNum = season?.seasonNumber || (s.seasonIdx ?? 0) + 1;
  const title = data.title || "Untitled";

  // Build button list (visual only — no real inline keyboard yet)
  const buttons: Array<{ text: string; url: string }> = [];
  buttons.push({
    text: `▶️ Watch S${sNum} EP${epNum}`,
    url: `https://rsanime03.lovable.app/?anime=${s.seriesId}&season=${sNum}&episode=${epNum}`,
  });
  // Permanent custom buttons
  const permanent = (await fbGet(`animeCustomButtons/${s.seriesId}`)) as Array<any> || [];
  if (Array.isArray(permanent)) {
    for (const b of permanent) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
  }
  // One-time buttons
  if (Array.isArray(s.oneTimeButtons)) {
    for (const b of s.oneTimeButtons) if (b?.text && b?.url) buttons.push(b);
  }

  let btnList = "";
  buttons.forEach((b, i) => {
    btnList += `\n  ${i + 1}. <b>${escapeHtml(b.text)}</b>\n     <code>${escapeHtml(b.url)}</code>`;
  });

  const caption =
    `<b>🎬 ${escapeHtml(title)}</b>\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    `📚 Season <b>${sNum}</b> • 🎞 Episode <b>${epNum}</b>\n` +
    (data.rating ? `⭐ ${data.rating}\n` : "") +
    (data.category ? `📂 ${data.category}\n` : "") +
    `\n<b>📌 Buttons in this post:</b>${btnList || "\n  (none)"}\n\n` +
    `<i>Tap Confirm to save the episode and send the post.</i>`;

  const poster = data.backdrop || data.poster || FALLBACK_POSTER;
  await tgSendPhoto(chatId, poster, caption, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Confirm & Send", callback_data: "confirm_send" }],
        [{ text: "➕ Add Custom Button", callback_data: "addbtn" }],
        [{ text: "❌ Cancel", callback_data: "act:home" }],
      ],
    },
  });
}

// ---------- Save episode + send post ----------
async function confirmAndSend(chatId: number) {
  const s = await getSession(chatId);
  if (!s.seriesId || !s.collection || s.seasonIdx === undefined) return;
  const data = await fbGet(`${s.collection}/${s.seriesId}`);
  if (!data) return;
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const season = seasons[s.seasonIdx];
  if (!season) return;
  const eps = Array.isArray(season.episodes) ? season.episodes : [];
  const epNum = s.newEpisodeNumber || 1;

  const epObj: any = {
    episodeNumber: epNum,
    title: `Episode ${epNum}`,
    link: s.links?.default || "",
    link480: s.links?.["480"] || "",
    link720: s.links?.["720"] || "",
    link1080: s.links?.["1080"] || "",
    link4k: s.links?.["4k"] || "",
  };

  // Find existing index by ep number
  const existingIdx = eps.findIndex((e: any) => Number(e?.episodeNumber) === Number(epNum));
  if (existingIdx >= 0) {
    eps[existingIdx] = { ...eps[existingIdx], ...epObj };
  } else {
    eps.push(epObj);
    eps.sort((a: any, b: any) => Number(a.episodeNumber) - Number(b.episodeNumber));
  }
  season.episodes = eps;
  seasons[s.seasonIdx] = season;
  await fbPatch(`${s.collection}/${s.seriesId}`, {
    seasons,
    updatedAt: Date.now(),
  });

  // Build buttons for the actual telegram post
  const sNum = season.seasonNumber || (s.seasonIdx ?? 0) + 1;
  const buttons: Array<{ text: string; url: string }> = [
    {
      text: `▶️ Watch S${sNum} EP${epNum}`,
      url: `https://rsanime03.lovable.app/?anime=${s.seriesId}&season=${sNum}&episode=${epNum}`,
    },
  ];
  const permanent = (await fbGet(`animeCustomButtons/${s.seriesId}`)) as Array<any> || [];
  if (Array.isArray(permanent)) {
    for (const b of permanent) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
  }
  if (Array.isArray(s.oneTimeButtons)) {
    for (const b of s.oneTimeButtons) if (b?.text && b?.url) buttons.push(b);
  }

  const title = data.title || "Untitled";
  const totalEps = (season.episodes || []).length;
  const caption = await buildWebsiteCaption({
    title,
    season: sNum,
    totalEpisodes: totalEps,
    newEpAdded: epNum,
    rating: data.rating,
    genres: data.category,
  });

  const photoUrl = data.backdrop || data.poster || FALLBACK_POSTER;
  const res = await postToAllChannels({
    caption,
    photoUrl,
    inlineButtons: buttons,
    collection: s.collection,
    seriesId: s.seriesId,
  });

  await clearSession(chatId);

  if (res.posted > 0 && res.failed === 0) {
    await tgSend(
      chatId,
      `✅ <b>Episode saved & posted to ${res.posted} channel(s)!</b>\n\n` +
        `🎬 ${escapeHtml(title)}\n📚 S${sNum} EP${epNum}`,
      { reply_markup: startKeyboard() },
    );
  } else if (res.posted > 0) {
    await tgSend(
      chatId,
      `⚠️ <b>Posted to ${res.posted}, failed ${res.failed}</b>\n\n` +
        `<code>${escapeHtml(res.errors.slice(0, 3).join("\n"))}</code>`,
      { reply_markup: startKeyboard() },
    );
  } else {
    await tgSend(
      chatId,
      `⚠️ <b>Episode saved</b> but Telegram post failed.\n\n` +
        `<code>${escapeHtml(res.errors.slice(0, 3).join("\n") || "unknown")}</code>\n\n` +
        `<i>Configure channels in website Admin → Telegram Post.</i>`,
      { reply_markup: startKeyboard() },
    );
  }
}

// ---------- Add New Anime (TMDB) ----------
async function showTmdbPreview(chatId: number, mediaType: string, tmdbId: number) {
  const d = await tmdbDetails(mediaType, tmdbId);
  if (!d) {
    await tgSend(chatId, "❌ TMDB ডেটা পাওয়া যায়নি।", {
      reply_markup: { inline_keyboard: [[{ text: "⬅ Back", callback_data: "act:home" }]] },
    });
    return;
  }
  const title = d.name || d.title || "Untitled";
  const year = (d.first_air_date || d.release_date || "").slice(0, 4);
  const rating = d.vote_average ? Number(d.vote_average).toFixed(1) : "";
  const genres = (d.genres || []).map((g: any) => g.name).join(", ");
  const overview = (d.overview || "").slice(0, 300);
  const poster = d.backdrop_path
    ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
    : d.poster_path
      ? `https://image.tmdb.org/t/p/original${d.poster_path}`
      : FALLBACK_POSTER;

  // Save preview data in session
  const s = await getSession(chatId);
  s.step = "addnew_dub";
  s.customButton = undefined;
  // store TMDB data as a temp blob in session via fbPut path
  await fbPut(`telegramAdminTemp/${chatId}`, {
    mediaType,
    tmdbId,
    title,
    year,
    rating,
    genres,
    overview,
    poster:
      d.backdrop_path
        ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
        : d.poster_path
          ? `https://image.tmdb.org/t/p/w500${d.poster_path}`
          : "",
    backdrop:
      d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : "",
    language: (d.original_language || "").toUpperCase(),
  });
  await setSession(chatId, s);

  const caption =
    `<b>🎬 ${escapeHtml(title)}</b>${year ? ` (${year})` : ""}\n` +
    `<b>━━━━━━━━━━━━━━━</b>\n` +
    (rating ? `⭐ <b>${rating}</b>\n` : "") +
    (genres ? `📂 ${escapeHtml(genres)}\n` : "") +
    (overview ? `\n📝 <i>${escapeHtml(overview)}</i>\n` : "") +
    `\n<b>🗣 Dub type select করুন:</b>`;

  await tgSendPhoto(chatId, poster, caption, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🎙 Hindi Dub", callback_data: "dub:Hindi Dub" },
          { text: "🎙 English Dub", callback_data: "dub:English Dub" },
        ],
        [
          { text: "📝 Subbed", callback_data: "dub:Subbed" },
          { text: "🎙 Multi Audio", callback_data: "dub:Multi Audio" },
        ],
        [{ text: "⬅ Back", callback_data: "act:addnew" }],
      ],
    },
  });
}

async function saveNewAnime(chatId: number, dubType: string) {
  const tmp: any = await fbGet(`telegramAdminTemp/${chatId}`);
  if (!tmp) {
    await tgSend(chatId, "❌ Session expired. আবার শুরু করুন।");
    return;
  }
  const collection = tmp.mediaType === "movie" ? "movies" : "webseries";
  // Generate Firebase push id
  const pushRes = await fetch(`${FIREBASE_DB}/${collection}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: tmp.title,
      year: tmp.year,
      rating: tmp.rating,
      category: tmp.genres,
      poster: tmp.poster,
      backdrop: tmp.backdrop || tmp.poster,
      language: tmp.language,
      dubType,
      tmdbId: tmp.tmdbId,
      type: collection === "movies" ? "movie" : "series",
      visibility: "public",
      seasons: [],
      storyline: tmp.overview,
      updatedAt: Date.now(),
    }),
  });
  const pushData = await pushRes.json().catch(() => ({}));
  const newId = pushData?.name;
  await fbDelete(`telegramAdminTemp/${chatId}`);
  await clearSession(chatId);

  if (!newId) {
    await tgSend(chatId, "❌ সেভ করা যায়নি। আবার চেষ্টা করুন।", {
      reply_markup: startKeyboard(),
    });
    return;
  }
  await tgSend(
    chatId,
    `✅ <b>${escapeHtml(tmp.title)}</b> যুক্ত হয়েছে (${dubType})!\n\n<i>এবার Add Season → Add Episode করুন।</i>`,
  );
  await showAnime(chatId, collection, newId);
}


async function startAddButton(chatId: number) {
  const s = await getSession(chatId);
  s.step = "btn_text";
  s.customButton = {};
  await setSession(chatId, s);
  await tgSend(
    chatId,
    `✏️ <b>Add Custom Button</b>\n\nSend the <b>button label</b> (e.g. <code>Telegram Channel</code>):`,
  );
}

// ---------- Handle text messages ----------
async function handleText(chatId: number, text: string) {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (lower === "/start" || lower === "/home") {
    await clearSession(chatId);
    await sendStart(chatId);
    return;
  }
  if (lower === "/help") {
    await sendHelp(chatId);
    return;
  }
  if (lower === "/cancel") {
    await clearSession(chatId);
    await tgSend(chatId, "❌ Cancelled.", { reply_markup: startKeyboard() });
    return;
  }
  if (lower.startsWith("/setchatid")) {
    // helper to set the post chatId to current chat
    await fbPut("settings/telegramChatId", chatId);
    await tgSend(chatId, `✅ Saved this chat as Telegram post target.\n<code>${chatId}</code>`);
    return;
  }
  if (lower === "/search") {
    const s: Session = { step: "search_query" };
    await setSession(chatId, s);
    await tgSend(chatId, "🔎 Type the anime name:");
    return;
  }

  const s = await getSession(chatId);

  // --- Search query ---
  if (s.step === "search_query") {
    const results = await searchAnime(t);
    if (results.length === 0) {
      await tgSend(
        chatId,
        `❌ No matches for "<b>${escapeHtml(t)}</b>".\n\n<i>Try a shorter or different name.</i>`,
      );
      return;
    }
    if (results.length === 1) {
      const r = results[0];
      await clearSession(chatId);
      await showAnime(chatId, r.collection, r.id);
      return;
    }
    // multiple — show list
    const rows = results.map((r) => [
      { text: r.title.slice(0, 60), callback_data: `pick:${r.collection}:${r.id}` },
    ]);
    rows.push([{ text: "❌ Cancel", callback_data: "act:home" }]);
    await tgSendPhoto(
      chatId,
      results[0].poster || FALLBACK_POSTER,
      `🔎 Found <b>${results.length}</b> matches. Pick one:`,
      { reply_markup: { inline_keyboard: rows } },
    );
    await clearSession(chatId);
    return;
  }

  // --- Add new anime: TMDB search ---
  if (s.step === "addnew_query") {
    const results = await tmdbSearch(t);
    if (results.length === 0) {
      await tgSend(
        chatId,
        `❌ TMDB এ "<b>${escapeHtml(t)}</b>" পাওয়া যায়নি। অন্য নাম try করুন।`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "⬅ Back", callback_data: "act:home" }]],
          },
        },
      );
      return;
    }
    // Save tmdb candidates in session for picking
    s.lastResults = results.map((r: any) => ({
      id: String(r.id),
      collection: r.media_type === "movie" ? "movies" : "webseries",
      title: r.name || r.title || "",
    }));
    await setSession(chatId, s);
    if (results.length === 1) {
      await showTmdbPreview(chatId, results[0].media_type, results[0].id);
      return;
    }
    const rows = results.map((r: any) => [
      {
        text: `${r.media_type === "tv" ? "📺" : "🎬"} ${(r.name || r.title || "").slice(0, 50)} ${r.first_air_date || r.release_date ? `(${(r.first_air_date || r.release_date || "").slice(0, 4)})` : ""}`,
        callback_data: `tmdbpick:${r.media_type}:${r.id}`,
      },
    ]);
    rows.push([{ text: "⬅ Back", callback_data: "act:home" }]);
    await tgSend(chatId, `🔎 TMDB তে <b>${results.length}</b>টি ফলাফল। একটা select করুন:`, {
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  // --- Quality link input ---
  if (s.step === "add_wait_link" || s.step === "edit_wait_link") {
    const q = s.pendingQuality || "default";
    const url = lower === "skip" ? "" : t;
    s.links = s.links || {};
    s.links[q] = url;
    s.step = s.step === "add_wait_link" ? "add_links" : "edit_links";
    s.pendingQuality = undefined;
    await setSession(chatId, s);
    const fmt = q === "default" ? "Default" : q === "4k" ? "4K" : `${q}p`;
    const text =
      `${url ? "✅" : "⏭"} <b>${fmt}</b> ${url ? "saved" : "skipped"}.\n\n` +
      `<i>Pick another quality or tap ✅ Finish.</i>`;
    const rows = [
      [
        { text: `📺 Default ${s.links.default ? "✅" : ""}`, callback_data: `q:default` },
        { text: `480p ${s.links["480"] ? "✅" : ""}`, callback_data: `q:480` },
      ],
      [
        { text: `720p ${s.links["720"] ? "✅" : ""}`, callback_data: `q:720` },
        { text: `1080p ${s.links["1080"] ? "✅" : ""}`, callback_data: `q:1080` },
      ],
      [
        { text: `4K ${s.links["4k"] ? "✅" : ""}`, callback_data: `q:4k` },
        { text: "✅ Finish", callback_data: `q:finish` },
      ],
    ];
    await tgSend(chatId, text, { reply_markup: { inline_keyboard: rows } });
    return;
  }

  // --- Add season name ---
  if (s.step === "add_season_name" && s.seriesId && s.collection) {
    const data = await fbGet(`${s.collection}/${s.seriesId}`);
    const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
    const nextNum = seasons.length + 1;
    seasons.push({
      seasonNumber: nextNum,
      name: t || `Season ${nextNum}`,
      episodes: [],
    });
    await fbPatch(`${s.collection}/${s.seriesId}`, { seasons, updatedAt: Date.now() });
    await tgSend(chatId, `✅ Season ${nextNum} added.`);
    await clearSession(chatId);
    await showAnime(chatId, s.collection, s.seriesId);
    return;
  }

  // --- Bulk import: paste text/JSON ---
  if (s.step === "bulk_wait") {
    const eps = parseBulkInput(t);
    await processBulkParsed(chatId, eps);
    return;
  }

  // --- Bulk edit: replace one episode's links ---
  if (s.step === "bulk_edit_input" && (s as any).bulkEditEpNum !== undefined) {
    const epNum = (s as any).bulkEditEpNum as number;
    const eps = parseBulkInput(t);
    if (eps.length === 0) {
      await tgSend(chatId, "❌ Couldn't parse. Try again.");
      return;
    }
    const blob: any = await fbGet(`telegramAdminBulk/${chatId}`);
    if (blob?.episodes) {
      const newEp = eps[0];
      newEp.episodeNumber = epNum;
      const idx = blob.episodes.findIndex((e: any) => Number(e.episodeNumber) === epNum);
      if (idx >= 0) blob.episodes[idx] = newEp;
      else blob.episodes.push(newEp);
      await fbPut(`telegramAdminBulk/${chatId}`, blob);
      // restore step to bulk_wait so re-verify works
      s.step = "bulk_wait";
      (s as any).bulkEditEpNum = undefined;
      await setSession(chatId, s);
      await tgSend(chatId, `✅ Updated EP${epNum}. Re-verifying all...`);
      await processBulkParsed(chatId, blob.episodes);
    }
    return;
  }

  // --- Custom button text ---
  if (s.step === "btn_text") {
    s.customButton = { text: t };
    s.step = "btn_url";
    await setSession(chatId, s);
    await tgSend(chatId, `🔗 Now send the <b>button URL</b>:`);
    return;
  }
  if (s.step === "btn_url") {
    if (!/^https?:\/\//i.test(t)) {
      await tgSend(chatId, "❌ Invalid URL. Must start with http:// or https://");
      return;
    }
    s.customButton = { ...(s.customButton || {}), url: t };
    s.step = "btn_mode";
    await setSession(chatId, s);
    await tgSend(chatId, `Choose mode:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💾 Permanent", callback_data: "btnmode:permanent" },
            { text: "1️⃣ One-time", callback_data: "btnmode:onetime" },
          ],
          [{ text: "❌ Cancel", callback_data: "btnmode:cancel" }],
        ],
      },
    });
    return;
  }

  // Default fallback
  await tgSend(
    chatId,
    `<i>Unknown input. Tap /start to return home or /search to find an anime.</i>`,
    { reply_markup: startKeyboard() },
  );
}

// ---------- Handle callback queries ----------
async function handleCallback(chatId: number, data: string, cbId: string, messageId?: number) {
  await tgAnswerCb(cbId);

  if (data === "act:home") {
    await clearSession(chatId);
    await sendStart(chatId);
    return;
  }
  if (data === "act:help") {
    await sendHelp(chatId);
    return;
  }
  if (data === "act:menu") {
    await sendStart(chatId);
    return;
  }
  if (data === "act:search") {
    await setSession(chatId, { step: "search_query" });
    await tgSend(chatId, "🔎 Type the anime name:", {
      reply_markup: { inline_keyboard: [[{ text: "⬅ Back", callback_data: "act:home" }]] },
    });
    return;
  }
  if (data === "act:addnew") {
    await setSession(chatId, { step: "addnew_query" });
    await tgSend(
      chatId,
      "🆕 <b>Add New Anime</b>\n\nTMDB থেকে fetch করতে anime/movie এর নাম পাঠান:",
      {
        reply_markup: { inline_keyboard: [[{ text: "⬅ Back", callback_data: "act:home" }]] },
      },
    );
    return;
  }

  // tmdbpick:mediaType:tmdbId
  if (data.startsWith("tmdbpick:")) {
    const [, mt, id] = data.split(":");
    await showTmdbPreview(chatId, mt, Number(id));
    return;
  }

  // dub:<dubType>
  if (data.startsWith("dub:")) {
    const dub = data.slice(4);
    await tgSend(chatId, "⏳ Saving...");
    await saveNewAnime(chatId, dub);
    return;
  }

  // back:qualities — return to quality picker during link entry
  if (data === "back:qualities") {
    const s = await getSession(chatId);
    if (!s.links) {
      await sendStart(chatId);
      return;
    }
    s.step = s.step === "edit_wait_link" ? "edit_links" : "add_links";
    s.pendingQuality = undefined;
    await setSession(chatId, s);
    const rows = [
      [
        { text: `📺 Default ${s.links.default ? "✅" : ""}`, callback_data: `q:default` },
        { text: `480p ${s.links["480"] ? "✅" : ""}`, callback_data: `q:480` },
      ],
      [
        { text: `720p ${s.links["720"] ? "✅" : ""}`, callback_data: `q:720` },
        { text: `1080p ${s.links["1080"] ? "✅" : ""}`, callback_data: `q:1080` },
      ],
      [
        { text: `4K ${s.links["4k"] ? "✅" : ""}`, callback_data: `q:4k` },
        { text: "✅ Finish", callback_data: `q:finish` },
      ],
      [
        { text: "⬅ Back",
          callback_data:
            s.collection && s.seriesId && s.seasonIdx !== undefined
              ? `season:${s.collection}:${s.seriesId}:${s.seasonIdx}`
              : "act:home",
        },
      ],
    ];
    await tgSend(chatId, "<i>Pick a quality to add/edit, or ✅ Finish.</i>", {
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  // pick:collection:id
  if (data.startsWith("pick:")) {
    const [, col, id] = data.split(":");
    await showAnime(chatId, col, id);
    return;
  }

  // back:collection:id  →  show anime
  if (data.startsWith("back:")) {
    const [, col, id] = data.split(":");
    await showAnime(chatId, col, id);
    return;
  }

  // season:collection:id:idx
  if (data.startsWith("season:")) {
    const [, col, id, idx] = data.split(":");
    await showSeason(chatId, col, id, Number(idx));
    return;
  }

  // ep:collection:id:sIdx:eIdx
  if (data.startsWith("ep:")) {
    const [, col, id, sIdx, eIdx] = data.split(":");
    await showEpisode(chatId, col, id, Number(sIdx), Number(eIdx));
    return;
  }

  // addep:collection:id:sIdx
  if (data.startsWith("addep:")) {
    const [, col, id, sIdx] = data.split(":");
    await startAddEpisode(chatId, col, id, Number(sIdx));
    return;
  }

  // addseason:collection:id
  if (data.startsWith("addseason:")) {
    const [, col, id] = data.split(":");
    await setSession(chatId, {
      step: "add_season_name",
      collection: col as any,
      seriesId: id,
    });
    await tgSend(chatId, "📝 Send the <b>season name</b> (or send <code>-</code> for default):");
    return;
  }

  // delseason_pick:collection:id
  if (data.startsWith("delseason_pick:")) {
    const [, col, id] = data.split(":");
    const d = await fbGet(`${col}/${id}`);
    const seasons = Array.isArray(d?.seasons) ? d.seasons : [];
    if (seasons.length === 0) {
      await tgSend(chatId, "No seasons.");
      return;
    }
    const rows = seasons.map((s: any, i: number) => [
      { text: `🗑 S${s.seasonNumber || i + 1}`, callback_data: `delseason:${col}:${id}:${i}` },
    ]);
    rows.push([{ text: "❌ Cancel", callback_data: `back:${col}:${id}` }]);
    await tgSend(chatId, "Pick a season to delete:", {
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  // delseason:collection:id:idx
  if (data.startsWith("delseason:")) {
    const [, col, id, idx] = data.split(":");
    const d = await fbGet(`${col}/${id}`);
    const seasons = Array.isArray(d?.seasons) ? d.seasons : [];
    seasons.splice(Number(idx), 1);
    await fbPatch(`${col}/${id}`, { seasons, updatedAt: Date.now() });
    await tgSend(chatId, "✅ Season deleted.");
    await showAnime(chatId, col, id);
    return;
  }

  // resend:collection:id:sIdx:eIdx → resend a specific episode post
  if (data.startsWith("resend:")) {
    const [, col, id, sIdx, eIdx] = data.split(":");
    await tgSend(chatId, "⏳ Resending episode post...");
    const d = await fbGet(`${col}/${id}`);
    const season = d?.seasons?.[Number(sIdx)];
    const ep = season?.episodes?.[Number(eIdx)];
    if (!d || !season || !ep) {
      await tgSend(chatId, "❌ Episode not found.");
      return;
    }
    const sNum = season.seasonNumber || Number(sIdx) + 1;
    const epNum = ep.episodeNumber || Number(eIdx) + 1;
    const photoUrl = d.backdrop || d.poster || FALLBACK_POSTER;
    const buttons: Array<{ text: string; url: string }> = [
      {
        text: `▶️ Watch S${sNum} EP${epNum}`,
        url: `https://rsanime03.lovable.app/?anime=${id}&season=${sNum}&episode=${epNum}`,
      },
    ];
    const permanent = ((await fbGet(`animeCustomButtons/${id}`)) as any[]) || [];
    if (Array.isArray(permanent)) {
      for (const b of permanent) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
    }
    const totalEps = (season.episodes || []).length;
    const caption = await buildWebsiteCaption({
      title: d.title || "Untitled",
      season: sNum,
      totalEpisodes: totalEps,
      newEpAdded: epNum,
      rating: d.rating,
      genres: d.category,
    });
    const res = await postToAllChannels({
      caption,
      photoUrl,
      inlineButtons: buttons,
      collection: col,
      seriesId: id,
    });
    if (res.posted > 0 && res.failed === 0) {
      await tgSend(
        chatId,
        `✅ <b>Resent to ${res.posted} channel(s)!</b>\n🎬 ${escapeHtml(d.title)} — S${sNum} EP${epNum}`,
      );
    } else if (res.posted > 0) {
      await tgSend(
        chatId,
        `⚠️ <b>Posted ${res.posted}, failed ${res.failed}</b>\n<code>${escapeHtml(res.errors.slice(0, 3).join("\n"))}</code>`,
      );
    } else {
      await tgSend(
        chatId,
        `❌ Resend failed:\n<code>${escapeHtml(res.errors.slice(0, 3).join("\n") || "unknown")}</code>\n\n<i>Configure channels in website Admin → Telegram Post.</i>`,
      );
    }
    return;
  }

  // delep:collection:id:sIdx:eIdx
  if (data.startsWith("delep:")) {
    const [, col, id, sIdx, eIdx] = data.split(":");
    const d = await fbGet(`${col}/${id}`);
    const seasons = Array.isArray(d?.seasons) ? d.seasons : [];
    const season = seasons[Number(sIdx)];
    if (season?.episodes) {
      season.episodes.splice(Number(eIdx), 1);
      seasons[Number(sIdx)] = season;
      await fbPatch(`${col}/${id}`, { seasons, updatedAt: Date.now() });
    }
    await tgSend(chatId, "✅ Episode deleted.");
    await showSeason(chatId, col, id, Number(sIdx));
    return;
  }

  // q:default | q:480 | q:720 | q:1080 | q:4k | q:finish
  if (data.startsWith("q:")) {
    const q = data.slice(2);
    if (q === "finish") {
      await showFinishVerify(chatId);
    } else {
      await promptQualityLink(chatId, q);
    }
    return;
  }

  // skipq:quality
  if (data.startsWith("skipq:")) {
    const q = data.split(":")[1];
    const s = await getSession(chatId);
    if (s.links) s.links[q] = "";
    await setSession(chatId, s);
    await tgSend(chatId, `⏭ Skipped ${q}.`);
    await showFinishVerify(chatId);
    return;
  }

  // preview
  if (data === "preview") {
    await showPreview(chatId);
    return;
  }

  // confirm_send
  if (data === "confirm_send") {
    await tgSend(chatId, "⏳ Saving and sending post...");
    await confirmAndSend(chatId);
    return;
  }

  // addbtn
  if (data === "addbtn") {
    await startAddButton(chatId);
    return;
  }

  // btnmode:permanent | onetime | cancel
  if (data.startsWith("btnmode:")) {
    const mode = data.split(":")[1];
    const s = await getSession(chatId);
    const btn = s.customButton;
    if (mode === "cancel" || !btn?.text || !btn?.url) {
      s.step = undefined;
      s.customButton = undefined;
      await setSession(chatId, s);
      await tgSend(chatId, "❌ Custom button cancelled.");
      await showPreview(chatId);
      return;
    }
    if (mode === "permanent" && s.seriesId) {
      const existing = ((await fbGet(`animeCustomButtons/${s.seriesId}`)) as any[]) || [];
      const arr = Array.isArray(existing) ? existing : [];
      arr.push({ text: btn.text, url: btn.url });
      await fbPut(`animeCustomButtons/${s.seriesId}`, arr);
      await tgSend(chatId, "💾 Saved as <b>permanent</b> button.");
    } else if (mode === "onetime") {
      s.oneTimeButtons = s.oneTimeButtons || [];
      s.oneTimeButtons.push({ text: btn.text!, url: btn.url! });
      await tgSend(chatId, "✅ Added as <b>one-time</b> button.");
    }
    s.step = undefined;
    s.customButton = undefined;
    await setSession(chatId, s);
    await showPreview(chatId);
    return;
  }

  // post:collection:id::  → quick post existing anime
  if (data.startsWith("post:")) {
    const [, col, id] = data.split(":");
    await tgSend(chatId, "⏳ Sending post...");
    const d = await fbGet(`${col}/${id}`);
    if (!d) {
      await tgSend(chatId, "❌ Not found.");
      return;
    }
    const photoUrl = d.backdrop || d.poster || FALLBACK_POSTER;
    const buttons: Array<{ text: string; url: string }> = [
      { text: `▶️ Watch ${d.title}`, url: `https://rsanime03.lovable.app/?anime=${id}` },
    ];
    const permanent = ((await fbGet(`animeCustomButtons/${id}`)) as any[]) || [];
    if (Array.isArray(permanent)) {
      for (const b of permanent) if (b?.text && b?.url) buttons.push({ text: b.text, url: b.url });
    }
    const caption = await buildWebsiteCaption({
      title: d.title || "Untitled",
      season: d?.seasons?.[0]?.seasonNumber || 1,
      totalEpisodes: (d?.seasons?.[0]?.episodes || []).length || "—",
      newEpAdded: (d?.seasons?.[0]?.episodes || []).length || 1,
      rating: d.rating,
      genres: d.category,
    });
    const res = await postToAllChannels({
      caption,
      photoUrl,
      inlineButtons: buttons,
      collection: col,
      seriesId: id,
    });
    if (res.posted > 0)
      await tgSend(chatId, `✅ Posted to ${res.posted} channel(s).${res.failed ? ` (${res.failed} failed)` : ""}`);
    else
      await tgSend(
        chatId,
        `❌ Post failed:\n<code>${escapeHtml(res.errors.slice(0, 3).join("\n") || "unknown")}</code>\n\n<i>Configure channels in website Admin → Telegram Post.</i>`,
      );
    return;
  }

  // bulk:collection:id:sIdx → start bulk import flow
  if (data.startsWith("bulk:")) {
    const [, col, id, sIdx] = data.split(":");
    await startBulkImport(chatId, col, id, Number(sIdx));
    return;
  }

  // bulkedit:<epNum>
  if (data.startsWith("bulkedit:")) {
    const epNum = Number(data.split(":")[1]);
    const s = await getSession(chatId);
    s.step = "bulk_edit_input";
    (s as any).bulkEditEpNum = epNum;
    await setSession(chatId, s);
    await tgSend(
      chatId,
      `✏️ <b>Re-add EP${epNum}</b>\n\nSend the corrected links. Examples:\n\n` +
        `<code>EP${epNum} | default=URL | 720=URL</code>\n\nor JSON:\n` +
        `<code>[{"episodeNumber":${epNum},"link":"URL","link720":"URL"}]</code>`,
    );
    return;
  }

  if (data === "bulk_confirm_all") {
    await tgSend(chatId, "⏳ Saving and posting all...");
    await bulkConfirmAndPost(chatId, false);
    return;
  }
  if (data === "bulk_confirm_ok") {
    await tgSend(chatId, "⏳ Saving and posting OK ones only...");
    await bulkConfirmAndPost(chatId, true);
    return;
  }
  if (data === "bulk_cancel") {
    await fbDelete(`telegramAdminBulk/${chatId}`);
    await clearSession(chatId);
    await tgSend(chatId, "❌ Bulk import cancelled.", { reply_markup: startKeyboard() });
    return;
  }
}

// ---------- Webhook handler ----------
async function handleUpdate(update: any) {
  // Callback query
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const fromId = cq.from?.id;
    if (!chatId || fromId !== ADMIN_TG_ID) {
      await tgAnswerCb(cq.id, "Not authorized.");
      return;
    }
    await handleCallback(chatId, cq.data || "", cq.id, cq.message?.message_id);
    return;
  }

  // Message
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  if (!chatId) return;
  if (fromId !== ADMIN_TG_ID) {
    await tgSend(chatId, "🚫 This bot is admin-only.");
    return;
  }

  // Document upload (.json / .txt) for bulk import
  if (msg.document) {
    const sess = await getSession(chatId);
    if (sess.step === "bulk_wait") {
      const fname = String(msg.document.file_name || "").toLowerCase();
      const mime = String(msg.document.mime_type || "").toLowerCase();
      const isJson = fname.endsWith(".json") || mime.includes("json");
      const isTxt = fname.endsWith(".txt") || mime.startsWith("text/");
      if (!isJson && !isTxt) {
        await tgSend(chatId, "❌ Only .json or .txt files supported.");
        return;
      }
      await tgSend(chatId, "⏳ Downloading file...");
      const content = await tgDownloadFile(msg.document.file_id);
      if (!content) {
        await tgSend(chatId, "❌ Failed to download file.");
        return;
      }
      const eps = parseBulkInput(content);
      await processBulkParsed(chatId, eps);
      return;
    } else {
      await tgSend(
        chatId,
        "📄 Got a file, but I'm not in bulk-import mode.\n\n<i>Open a season → 📥 Bulk Import.</i>",
      );
      return;
    }
  }

  const text = String(msg.text || "");
  if (!text) return;
  await handleText(chatId, text);
}

// ---------- HTTP entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET")
    return json({ ok: true, service: "telegram-admin-bot", version: "v3-manual" });

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.test === true) return json({ ok: true });

    // set-webhook helper
    if (body?.action === "set-webhook") {
      const url = String(body.webhookUrl || "").trim();
      if (!url) return json({ error: "webhookUrl required" }, 400);
      const r = await fetch(tgApi("setWebhook"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, allowed_updates: ["message", "callback_query"] }),
      });
      return json(await r.json());
    }

    // Treat as Telegram update
    await handleUpdate(body);
    return json({ ok: true });
  } catch (e: any) {
    console.error("admin-bot error", e);
    return json({ error: e?.message || "internal" }, 500);
  }
});
