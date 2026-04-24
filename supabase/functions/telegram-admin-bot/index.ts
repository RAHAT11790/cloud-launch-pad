// =====================================================================
// Telegram Admin Bot v2 — RS Anime only (webseries + movies)
// =====================================================================
// Features:
// • Restricted to ADMIN_TG_ID = 6621572366
// • AI Mode  : full memory of all RS anime (titles + season/ep counts);
//              proposes ops with Allow/Disallow execution
// • Manual Mode: fuzzy search → anime → season → buttons (last 6 episodes
//              + Add Episode). Add flow: Auto / Manual.
//              Manual = Default/480p/720p/1080p/4k buttons + Finish → Allow
//              → optional "Post to Telegram"
// • AnimeSalt is intentionally EXCLUDED from search/edit
// • Persistent AI history at Firebase telegramAiHistory/{chatId}
// • Weekly reminders at 21:00 BD via cron (action=weekly_push)
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_TG_ID = 6621572366;
const FIREBASE_DB =
  Deno.env.get("FIREBASE_DATABASE_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FALLBACK_POSTER =
  "https://i.ibb.co/Yk2DhTk/rs-anime-default.jpg"; // generic fallback

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---------- Firebase REST ----------
async function fbGet(path: string) {
  const r = await fetch(`${FIREBASE_DB}/${path}.json`);
  if (!r.ok) return null;
  return await r.json();
}
async function fbPut(path: string, data: unknown) {
  await fetch(`${FIREBASE_DB}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
async function fbPatch(path: string, data: unknown) {
  await fetch(`${FIREBASE_DB}/${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
async function fbPush(path: string, data: unknown) {
  const r = await fetch(`${FIREBASE_DB}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return await r.json();
}
async function fbDelete(path: string) {
  await fetch(`${FIREBASE_DB}/${path}.json`, { method: "DELETE" });
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
async function tgSendPhoto(chatId: number | string, photo: string, caption: string, extra: any = {}) {
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
async function tgAnswerCb(cbId: string, text = "") {
  await fetch(tgApi("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}
async function tgDeleteMessage(chatId: number | string, messageId: number) {
  await fetch(tgApi("deleteMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
}
async function tgSetCommands() {
  await fetch(tgApi("setMyCommands"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "start", description: "Open main menu" },
        { command: "menu", description: "Show main menu" },
        { command: "help", description: "Manual mode guide" },
        { command: "ai", description: "Switch to AI mode" },
        { command: "manual", description: "Switch to manual search" },
        { command: "search", description: "Search anime by title" },
        { command: "selected", description: "Open selected anime" },
        { command: "season", description: "Open selected season" },
        { command: "ep", description: "Open episode details" },
        { command: "weekly", description: "Run today reminder" },
        { command: "cancel", description: "Cancel current flow" },
      ],
    }),
  });
}

const kb = (rows: { text: string; data?: string; url?: string }[][]) => ({
  inline_keyboard: rows.map((r) =>
    r.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })),
  ),
});

// ---------- Session state ----------
type AddingLinks = { def?: string; "480"?: string; "720"?: string; "1080"?: string; "4k"?: string };
type Session = {
  mode?: "ai" | "manual" | null;
  awaiting?:
    | "search_anime"
    | "ai_chat"
    | "auto_paste"
    | "manual_default"
    | "manual_480"
    | "manual_720"
    | "manual_1080"
    | "manual_4k"
    | "manual_episode_number"
    | "post_after_save"
    | null;
  collection?: "webseries" | "movies"; // RS only
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  addingLinks?: AddingLinks;
  pendingOps?: any[]; // AI proposed
  pendingSave?: { collection: string; seriesId: string; seasonNumber: number; episodeNumber: number; links: AddingLinks }; // manual confirmation pending
};
async function getSession(chatId: number): Promise<Session> {
  return ((await fbGet(`telegramBotSessions/${chatId}`)) as Session) || {};
}
async function setSession(chatId: number, s: Session) {
  await fbPut(`telegramBotSessions/${chatId}`, s);
}
async function patchSession(chatId: number, s: Partial<Session>) {
  const cur = await getSession(chatId);
  await fbPut(`telegramBotSessions/${chatId}`, { ...cur, ...s });
}

// ---------- AI history ----------
async function getHistory(chatId: number): Promise<any[]> {
  const h = await fbGet(`telegramAiHistory/${chatId}`);
  if (!h) return [];
  const arr = Object.values(h);
  return arr.sort((a: any, b: any) => (a.t || 0) - (b.t || 0));
}
async function appendHistory(chatId: number, role: "user" | "assistant", content: string) {
  await fbPush(`telegramAiHistory/${chatId}`, { role, content, t: Date.now() });
}

// ---------- Episode link parser (auto mode) ----------
function parseEpisodeBlock(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: { title?: string; episode?: number; quality?: string; size?: string; url?: string } = {};
  for (const ln of lines) {
    const titleM = ln.match(/^(?:Re\s*:\s*)?Title\s*[:\-]\s*(.+)$/i);
    if (titleM && !out.title) out.title = titleM[1].replace(/[━─]+/g, "").trim();
    const epM = ln.match(/(?:Episode|EP|এপিসোড)\s*[:\-#]?\s*(\d+)/i);
    if (epM && out.episode === undefined) out.episode = Number(epM[1]);
    const qM = ln.match(/(?:Quality|কোয়ালিটি)\s*[:\-]\s*([0-9a-zA-Z]+)/i);
    if (qM && !out.quality) out.quality = qM[1].toLowerCase();
    const sM = ln.match(/(?:Size|সাইজ)\s*[:\-]\s*([0-9.]+\s*(?:MB|GB|KB))/i);
    if (sM && !out.size) out.size = sM[1];
    const urlM = ln.match(/https?:\/\/\S+/);
    if (urlM && !out.url) out.url = urlM[0];
  }
  if (!out.quality && out.url) {
    const q = out.url.match(/(2160p|1080p|720p|480p|4k)/i);
    if (q) out.quality = q[1].toLowerCase();
  }
  if (!out.episode && out.url) {
    const e = out.url.match(/Episode[_\s%20:]*[:\-#]?\s*(\d+)/i);
    if (e) out.episode = Number(e[1]);
  }
  return out;
}
function qualityField(q?: string): "link480" | "link720" | "link1080" | "link4k" | "link" {
  if (!q) return "link";
  const s = q.toLowerCase();
  if (s.includes("2160") || s.includes("4k")) return "link4k";
  if (s.includes("1080")) return "link1080";
  if (s.includes("720")) return "link720";
  if (s.includes("480")) return "link480";
  return "link";
}

// ---------- Fuzzy normalization & scoring ----------
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, "");
}
// Levenshtein
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}
function fuzzyScore(query: string, candidate: string): number {
  const q = norm(query), c = norm(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1;
  if (c.includes(q)) return 0.9 + Math.min(0.09, q.length / c.length * 0.09);
  if (q.includes(c)) return 0.85;
  // word overlap
  const qw = query.toLowerCase().split(/\s+/).filter(Boolean);
  const cw = candidate.toLowerCase().split(/\s+/).filter(Boolean);
  const overlap = qw.filter((w) => cw.some((x) => x.startsWith(w) || w.startsWith(x))).length;
  const wScore = qw.length ? overlap / qw.length : 0;
  // edit distance ratio
  const d = lev(q, c);
  const eScore = 1 - d / Math.max(q.length, c.length);
  return Math.max(wScore * 0.85, eScore);
}

// ---------- RS-only search (webseries + movies, NO animesalt) ----------
type Hit = { collection: "webseries" | "movies"; id: string; title: string; score: number };
function cleanSearchQuery(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^[\-_a-z0-9]{12,}$/i.test(line));
  const merged = (lines[0] || raw || "")
    .replace(/^\/(search|find)\s+/i, "")
    .replace(/(?:এনিমিটা|এনিমে|animeটা|anime)\s*(?:টা)?\s*(find|search|খুঁজে|ফাইন্ড)\s*(করো|কর|দাও)?/gi, "")
    .replace(/(?:find|search|খুঁজে|ফাইন্ড)\s*(করো|কর|দাও)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return merged;
}

function extractSearchIntentQuery(text: string): string | null {
  const cmd = text.match(/^\/(search|find)\s+(.+)$/i);
  if (cmd?.[2]) return cleanSearchQuery(cmd[2]);

  const patterns = [
    /(.+?)\s+(?:এনিমিটা|এনিমে|animeটা|anime)?\s*(?:find|search|খুঁজে|ফাইন্ড)\s*(?:করো|কর|দাও)?$/i,
    /(?:find|search|খুঁজে|ফাইন্ড)\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? cleanSearchQuery(match[1]) : "";
    if (value) return value;
  }
  return null;
}

function isManualIntent(text: string): boolean {
  return /(manual|ম্যানুয়াল|button|বাটন|manual add|button based|বাটন ভিত্তিক)/i.test(text);
}

function isInfoIntent(text: string): boolean {
  return /(কয়টা এপিসোড|কত এপিসোড|episodes? (ache|আছে|count)|ডিটেইল|details|info|তথ্য|episode count)/i.test(text);
}

async function searchAnimeRS(qRaw: string): Promise<Hit[]> {
  const q = cleanSearchQuery(qRaw);
  const qNorm = norm(q);
  if (!qNorm) return [];
  const hits: Hit[] = [];
  for (const collection of ["webseries", "movies"] as const) {
    const all: any = await fbGet(collection);
    if (!all || typeof all !== "object") continue;
    for (const [id, v] of Object.entries(all) as [string, any][]) {
      const title = String(v?.title || v?.name || id);
      const slug = String(v?.slug || "");
      const titleScore = fuzzyScore(q, title);
      const idScore = fuzzyScore(q, id);
      const slugScore = slug ? fuzzyScore(q, slug) : 0;
      const tokenHit = q.toLowerCase().split(/\s+/).filter(Boolean)
        .every((word) => title.toLowerCase().includes(word));
      const score = Math.max(titleScore, idScore * 0.95, slugScore * 0.9, tokenHit ? 0.93 : 0);
      if (score >= (qNorm.length <= 4 ? 0.52 : 0.34)) hits.push({ collection, id, title, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 10);
}

function extractEpisodeLinks(e: any): AddingLinks {
  return {
    def: e?.link || undefined,
    "480": e?.link480 || undefined,
    "720": e?.link720 || undefined,
    "1080": e?.link1080 || undefined,
    "4k": e?.link4k || undefined,
  };
}

function getSeriesNextEpisode(series: any): { seasonNumber: number; episodeNumber: number; totalEpisodes: number; totalSeasons: number } {
  const seasons = Array.isArray(series?.seasons) ? series.seasons : Object.values(series?.seasons || {});
  const totalEpisodes = seasons.reduce((acc: number, s: any) => {
    const e = Array.isArray(s?.episodes) ? s.episodes : Object.values(s?.episodes || {});
    return acc + e.length;
  }, 0);
  if (seasons.length === 0) return { seasonNumber: 1, episodeNumber: 1, totalEpisodes, totalSeasons: 0 };

  const sortedSeasons = [...seasons].sort((a: any, b: any) => (a?.seasonNumber || 0) - (b?.seasonNumber || 0));
  const lastSeason = sortedSeasons[sortedSeasons.length - 1];
  const episodes = Array.isArray(lastSeason?.episodes) ? lastSeason.episodes : Object.values(lastSeason?.episodes || {});
  const maxEpisode = episodes.reduce((acc: number, ep: any) => Math.max(acc, Number(ep?.episodeNumber || 0)), 0);
  return {
    seasonNumber: Number(lastSeason?.seasonNumber || 1),
    episodeNumber: maxEpisode + 1,
    totalEpisodes,
    totalSeasons: seasons.length,
  };
}

async function getRSAnimeBrief(): Promise<string> {
  // Build an AI memory: list every RS anime title + season/ep count
  const lines: string[] = [];
  for (const collection of ["webseries", "movies"] as const) {
    const all: any = await fbGet(collection);
    if (!all || typeof all !== "object") continue;
    for (const [id, v] of Object.entries(all) as [string, any][]) {
      const title = String(v?.title || id);
      if (collection === "movies") {
        lines.push(`• [${id}] ${title} (movie)`);
      } else {
        const seasons = Array.isArray(v?.seasons) ? v.seasons : Object.values(v?.seasons || {});
        const sumEps = seasons.reduce((acc: number, s: any) => {
          const e = Array.isArray(s?.episodes) ? s.episodes : Object.values(s?.episodes || {});
          return acc + e.length;
        }, 0);
        lines.push(`• [${id}] ${title} — ${seasons.length} season(s), ${sumEps} ep`);
      }
    }
  }
  return lines.join("\n");
}

async function getSeriesEpisodes(collection: string, seriesId: string, seasonNumber: number) {
  const seasons: any = (await fbGet(`${collection}/${seriesId}/seasons`)) || [];
  const arr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  const s = arr.find((x: any) => x?.seasonNumber === seasonNumber);
  if (!s) return { eps: [], seasonsCount: arr.length };
  const eps = Array.isArray(s.episodes) ? s.episodes : Object.values(s.episodes || {});
  return { eps, seasonsCount: arr.length };
}

// ---------- Save episode (multi-quality at once) ----------
async function saveEpisodeMulti(
  collection: string,
  seriesId: string,
  seasonNumber: number,
  episodeNumber: number,
  links: AddingLinks,
  title?: string,
) {
  const seasonsPath = `${collection}/${seriesId}/seasons`;
  let seasons: any = (await fbGet(seasonsPath)) || [];
  let seasonsArr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  let sIdx = seasonsArr.findIndex((s: any) => s?.seasonNumber === seasonNumber);
  if (sIdx < 0) {
    seasonsArr.push({ seasonNumber, name: `Season ${seasonNumber}`, episodes: [] });
    sIdx = seasonsArr.length - 1;
    await fbPut(seasonsPath, seasonsArr);
  }
  const epPath = `${seasonsPath}/${sIdx}/episodes`;
  const eps: any[] = (await fbGet(epPath)) || [];
  const epList = Array.isArray(eps) ? eps : Object.values(eps);
  const idx = epList.findIndex((e: any) => e?.episodeNumber === episodeNumber);
  const merged: any = idx >= 0 ? { ...epList[idx] } : { episodeNumber, title: title || `Episode ${episodeNumber}` };
  if (links.def) merged.link = links.def;
  if (links["480"]) merged.link480 = links["480"];
  if (links["720"]) merged.link720 = links["720"];
  if (links["1080"]) merged.link1080 = links["1080"];
  if (links["4k"]) merged.link4k = links["4k"];
  if (idx >= 0) epList[idx] = merged; else epList.push(merged);
  epList.sort((a: any, b: any) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
  await fbPut(epPath, epList);
  return true;
}

async function deleteEpisode(collection: string, seriesId: string, seasonNumber: number, episodeNumber: number) {
  const seasonsPath = `${collection}/${seriesId}/seasons`;
  const seasons: any = (await fbGet(seasonsPath)) || [];
  const arr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  const sIdx = arr.findIndex((s: any) => s?.seasonNumber === seasonNumber);
  if (sIdx < 0) return false;
  const eps = Array.isArray(arr[sIdx].episodes) ? arr[sIdx].episodes : Object.values(arr[sIdx].episodes || {});
  const next = eps.filter((e: any) => e?.episodeNumber !== episodeNumber);
  await fbPut(`${seasonsPath}/${sIdx}/episodes`, next);
  return true;
}

// ---------- Telegram channel post ----------
async function postEpisodeToChannel(collection: string, seriesId: string, seasonNumber: number, episodeNumber: number) {
  const series: any = await fbGet(`${collection}/${seriesId}`);
  if (!series) return { ok: false, error: "series not found" };
  const url = `${SUPABASE_URL}/functions/v1/telegram-post`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      collection,
      seriesId,
      caption:
        `<b>${series.title || seriesId}</b>\n` +
        (seasonNumber ? `Season: ${seasonNumber}\n` : "") +
        (episodeNumber ? `Episode: ${episodeNumber}\n` : "") +
        `\n🔗 <a href="https://rsanime03.lovable.app/?anime=${encodeURIComponent(seriesId)}">Watch Now</a>`,
      photoUrl: series.poster || series.backdrop,
    }),
  });
  return await r.json();
}

// ---------- AI bridge ----------
async function callAdminAi(messages: any[]) {
  const url = `${SUPABASE_URL}/functions/v1/admin-ai`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ messages }),
  });
  return await r.json();
}
async function executeAdminAi(operations: any[]) {
  const url = `${SUPABASE_URL}/functions/v1/admin-ai`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ mode: "execute", operations }),
  });
  return await r.json();
}

// ---------- UI ----------
async function showMainMenu(chatId: number, prefix = "") {
  const text =
    (prefix ? prefix + "\n\n" : "") +
    `🎬 <b>RS Anime Admin Bot</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `একটা মোড বেছে নিন:\n\n` +
    `🤖 <b>AI Mode</b> — সব RS anime মুখস্ত, কাজ proposal দিবে\n` +
    `🔧 <b>Manual Mode</b> — Search → Anime → Episode add/edit/delete\n\n` +
    `<i>Note: শুধু RS Anime (webseries + movies)। AnimeSalt বাদ।</i>`;
  await tgSend(chatId, text, {
    reply_markup: kb([
      [{ text: "🤖 AI Mode", data: "mode:ai" }, { text: "🔧 Manual Mode", data: "mode:manual" }],
      [{ text: "📺 Weekly Reminder Now", data: "weekly:run" }],
      [{ text: "🧹 Clear AI History", data: "ai:clear" }, { text: "❓ Help", data: "help" }],
    ]),
  });
}

async function showManualHelp(chatId: number, prefix = "") {
  const text =
    (prefix ? prefix + "\n\n" : "") +
    `<b>📘 Manual Mode Guide</b>\n\n` +
    `Slash commands (BotFather style):\n` +
    `• <code>/manual</code> — manual mode open\n` +
    `• <code>/search Re Zero</code> — title search\n` +
    `• <code>/selected</code> — selected anime খুলবে\n` +
    `• <code>/season 1</code> — selected season খুলবে\n` +
    `• <code>/ep 13</code> — selected season/episode details\n` +
    `• <code>/weekly</code> — আজকের reminder\n` +
    `• <code>/cancel</code> — current flow cancel\n\n` +
    `ম্যানুয়াল ফ্লো:\n` +
    `1. Search করুন\n` +
    `2. Anime poster/card খুলুন\n` +
    `3. Season চাপুন\n` +
    `4. <b>Add Episode</b> বা next EP button চাপুন\n` +
    `5. <b>Manual</b> নিলে quality button-by-button link দিন\n` +
    `6. <b>Finish → Allow & Save</b>\n` +
    `7. শেষে <b>Post to Telegram</b> চাইলে Yes চাপুন\n\n` +
    `সার্চ টিপস:\n` +
    `• Plain title: <code>The Ramparts Of Ice</code>\n` +
    `• Banglish/Bangla: <code>ramparts of ice</code>, <code>র‍্যাম্পার্টস অফ আইস</code>\n` +
    `• AI mode থেকেও লিখতে পারেন: <code>Re Zero find koro</code> বা <code>/search Re Zero</code>`;
  await tgSend(chatId, text, {
    reply_markup: kb([
      [{ text: "🔎 Search Anime", data: "search" }, { text: "🏠 Menu", data: "menu" }],
    ]),
  });
}

async function runAnimeSearch(
  chatId: number,
  rawQuery: string,
  opts: { fromAi?: boolean } = {},
) {
  const query = cleanSearchQuery(rawQuery);
  if (!query) {
    await tgSend(chatId, `❌ Search title দিন। যেমন: <code>/search Re Zero</code>`);
    return;
  }

  const results = await searchAnimeRS(query);
  if (results.length === 0) {
    await tgSendPhoto(
      chatId,
      FALLBACK_POSTER,
      `❌ "<b>${query}</b>" এর কাছাকাছি কিছু পাওয়া যায়নি।\n\n` +
        `আবার চেষ্টা করুন:\n` +
        `• <code>/search Re Zero</code>\n` +
        `• <code>/search The Ramparts Of Ice</code>\n` +
        `• title plain text হিসেবেও পাঠাতে পারেন`,
      { reply_markup: kb([[{ text: "🔁 Try Again", data: "search" }, { text: "❓ Help", data: "help" }]]) },
    );
    return;
  }

  await patchSession(chatId, { mode: opts.fromAi ? "ai" : "manual", awaiting: null });

  if (results.length === 1 || results[0].score >= 0.92) {
    await showAnimeDetail(chatId, results[0].collection, results[0].id);
    await showAnimeAssistantHint(chatId, results[0].collection, results[0].id, {
      manualPreferred: isManualIntent(rawQuery),
      infoPreferred: isInfoIntent(rawQuery),
    });
    return;
  }

  const rows = results.slice(0, 6).map((r) => [{
    text: `${r.title} (${r.collection}) ${Math.round(r.score * 100)}%`,
    data: `pick:${r.collection}:${r.id}`,
  }]);
  rows.push([{ text: "🔎 Search Again", data: "search" }, { text: "🏠 Menu", data: "menu" }]);
  await tgSendPhoto(
    chatId,
    FALLBACK_POSTER,
    `🔎 "<b>${query}</b>" এর জন্য <b>${results.length}</b>টা কাছাকাছি match পাওয়া গেছে।\nনিচ থেকে সঠিকটা বেছে নিন:`,
    { reply_markup: kb(rows) },
  );
}

async function showAnimeAssistantHint(
  chatId: number,
  collection: string,
  seriesId: string,
  opts: { manualPreferred?: boolean; infoPreferred?: boolean } = {},
) {
  const series: any = await fbGet(`${collection}/${seriesId}`);
  if (!series || collection === "movies") return;
  const next = getSeriesNextEpisode(series);
  const lead = opts.manualPreferred
    ? `আপনি button-based manual add করতে চেয়েছেন। নিচের button থেকে next episode add করতে পারবেন।`
    : opts.infoPreferred
    ? `এই anime-তে এখন ${next.totalEpisodes} episode add আছে। next logical episode হলো EP ${next.episodeNumber}.`
    : `এই anime-তে এখন ${next.totalEpisodes} episode add আছে। চাইলে next episode এখনই add করতে পারেন।`;

  await tgSend(
    chatId,
    `<b>${series.title || seriesId}</b>\nID: <code>${seriesId}</code>\n\n${lead}`,
    {
      reply_markup: kb([
        [
          { text: `✋ Manual EP ${next.episodeNumber}`, data: `quickadd:manual:${collection}:${seriesId}:${next.seasonNumber}:${next.episodeNumber}` },
          { text: `⚡ Auto EP ${next.episodeNumber}`, data: `quickadd:auto:${collection}:${seriesId}:${next.seasonNumber}:${next.episodeNumber}` },
        ],
        [{ text: `📁 Open Season ${next.seasonNumber}`, data: `season:${collection}:${seriesId}:${next.seasonNumber}` }],
        [{ text: "📘 Manual Guide", data: "guide:manual" }],
      ]),
    },
  );
}

async function showSearchPrompt(chatId: number) {
  await patchSession(chatId, { mode: "manual", awaiting: "search_anime" });
  await tgSend(
    chatId,
    `🔎 <b>Search Anime</b>\n\n` +
      `এনিমির নাম লিখুন (একটু বানান ভুল হলেও খুঁজে পাবে)।\n` +
      `যেমন: <code>One Piece</code>, <code>Dr Stone</code>, <code>The Ramparts Of Ice</code>\n\n` +
      `BotFather style:\n` +
      `• <code>/search Re Zero</code>\n` +
      `• শুধু title পাঠালেও search হবে\n\n` +
      `<code>/cancel</code> = বাদ`,
  );
}

async function showAnimeDetail(chatId: number, collection: string, seriesId: string) {
  const series: any = await fbGet(`${collection}/${seriesId}`);
  if (!series) {
    await tgSend(chatId, "❌ Series পাওয়া যায়নি।");
    return;
  }
  const seasons = Array.isArray(series.seasons) ? series.seasons : Object.values(series.seasons || {});
  const next = getSeriesNextEpisode(series);
  const totalEps = seasons.reduce((acc: number, s: any) => {
    const e = Array.isArray(s?.episodes) ? s.episodes : Object.values(s?.episodes || {});
    return acc + e.length;
  }, 0);
  await patchSession(chatId, {
    collection: collection as any,
    seriesId,
    awaiting: null,
  });
  const caption =
    `<b>${series.title || seriesId}</b>\n` +
    `🆔 <code>${seriesId}</code>\n` +
    `📂 ${collection}\n` +
    `📅 Year: ${series.year || "-"}\n` +
    `⭐ ${series.rating || "-"}\n` +
    `📺 Seasons: ${seasons.length} · Episodes: ${totalEps}\n` +
    (collection === "webseries" ? `🆕 Next EP suggestion: S${next.seasonNumber} · EP ${next.episodeNumber}\n\n` : `\n`) +
    `কোন season এ কাজ করবেন?`;
  const seasonRows: any[][] = [];
  if (collection === "webseries") {
    seasonRows.push([
      { text: `✋ Manual EP ${next.episodeNumber}`, data: `quickadd:manual:${collection}:${seriesId}:${next.seasonNumber}:${next.episodeNumber}` },
      { text: `⚡ Auto EP ${next.episodeNumber}`, data: `quickadd:auto:${collection}:${seriesId}:${next.seasonNumber}:${next.episodeNumber}` },
    ]);
  }
  if (seasons.length === 0 && collection === "webseries") {
    seasonRows.push([{ text: "➕ Add Episode (Season 1)", data: `addep:${collection}:${seriesId}:1` }]);
  } else {
    seasons.forEach((s: any) => {
      const epCount = (Array.isArray(s?.episodes) ? s.episodes : Object.values(s?.episodes || {})).length;
      seasonRows.push([{
        text: `📁 Season ${s.seasonNumber} (${epCount} ep)`,
        data: `season:${collection}:${seriesId}:${s.seasonNumber}`,
      }]);
    });
  }
  if (collection === "movies") {
    seasonRows.push([{ text: "🎬 Set Movie Link", data: `movie:${collection}:${seriesId}` }]);
  }
  seasonRows.push([{ text: "📘 Manual Guide", data: "guide:manual" }]);
  seasonRows.push([{ text: "🔎 Search again", data: "search" }, { text: "🏠 Menu", data: "menu" }]);

  const photo = series.poster || series.backdrop || FALLBACK_POSTER;
  await tgSendPhoto(chatId, photo, caption, { reply_markup: kb(seasonRows) });
}

async function showSeasonDetail(chatId: number, collection: string, seriesId: string, seasonNumber: number) {
  const { eps } = await getSeriesEpisodes(collection, seriesId, seasonNumber);
  await patchSession(chatId, {
    collection: collection as any,
    seriesId,
    seasonNumber,
    awaiting: null,
  });
  const total = eps.length;
  const last6 = eps.slice(-6); // last 6 from bottom
  const nextEp = eps.reduce((acc: number, e: any) => Math.max(acc, Number(e?.episodeNumber || 0)), 0) + 1;
  const list = last6.map((e: any) => `EP ${e.episodeNumber} — ${e.title || ""}`).join("\n") || "(কোনো episode নেই)";
  const text =
    `<b>Season ${seasonNumber}</b> (${total} episodes)\n\n` +
    `Last ${last6.length} episodes:\n${list}\n\n` +
    `Next suggested episode: <b>${nextEp}</b>`;
  const epButtons = last6.map((e: any) => ({
    text: `EP ${e.episodeNumber}`,
    data: `ep:${collection}:${seriesId}:${seasonNumber}:${e.episodeNumber}`,
  }));
  const rows: any[][] = [];
  for (let i = 0; i < epButtons.length; i += 3) rows.push(epButtons.slice(i, i + 3));
  rows.push([
    { text: `✋ Manual EP ${nextEp}`, data: `quickadd:manual:${collection}:${seriesId}:${seasonNumber}:${nextEp}` },
    { text: `⚡ Auto EP ${nextEp}`, data: `quickadd:auto:${collection}:${seriesId}:${seasonNumber}:${nextEp}` },
  ]);
  rows.push([{ text: "➕ Add Episode", data: `addep:${collection}:${seriesId}:${seasonNumber}` }]);
  if (total > 0) {
    const latestEp = eps[eps.length - 1].episodeNumber;
    rows.push([{ text: `📢 Post EP ${latestEp} to Telegram`, data: `post:${collection}:${seriesId}:${seasonNumber}:${latestEp}` }]);
  }
  rows.push([{ text: "📘 Manual Guide", data: "guide:manual" }]);
  rows.push([{ text: "⬅ Back", data: `anime:${collection}:${seriesId}` }, { text: "🏠 Menu", data: "menu" }]);
  await tgSend(chatId, text, { reply_markup: kb(rows) });
}

async function showEpisodeDetail(chatId: number, collection: string, seriesId: string, seasonNumber: number, epNum: number) {
  const { eps } = await getSeriesEpisodes(collection, seriesId, seasonNumber);
  const e = eps.find((x: any) => x?.episodeNumber === epNum);
  if (!e) { await tgSend(chatId, "❌ Episode পাওয়া যায়নি।"); return; }
  const linkLines = [
    ["Default", e.link],
    ["480p", e.link480],
    ["720p", e.link720],
    ["1080p", e.link1080],
    ["4K", e.link4k],
  ].map(([label, value]) => `${value ? "✅" : "—"} <b>${label}</b>${value ? `\n<code>${String(value).slice(0, 90)}</code>` : ""}`).join("\n\n");
  await tgSend(chatId, `<b>EP ${epNum}</b> — ${e.title || `Episode ${epNum}`}\n\n${linkLines}`, {
    reply_markup: kb([
      [{ text: "✏️ Edit", data: `addep:${collection}:${seriesId}:${seasonNumber}:${epNum}` }, { text: "❌ Close", data: "close" }],
      [{ text: "📢 Post to Telegram", data: `post:${collection}:${seriesId}:${seasonNumber}:${epNum}` }, { text: "🗑 Delete EP", data: `del:${collection}:${seriesId}:${seasonNumber}:${epNum}` }],
      [{ text: "⬅ Back", data: `season:${collection}:${seriesId}:${seasonNumber}` }],
    ]),
  });
}

// ---------- Add Episode flow (Auto / Manual) ----------
async function startAddEpisode(chatId: number, collection: string, seriesId: string, seasonNumber: number, presetEp?: number) {
  let existingLinks: AddingLinks = {};
  if (presetEp) {
    const { eps } = await getSeriesEpisodes(collection, seriesId, seasonNumber);
    const existing = eps.find((e: any) => e?.episodeNumber === presetEp);
    if (existing) existingLinks = extractEpisodeLinks(existing);
  }
  await patchSession(chatId, {
    collection: collection as any,
    seriesId,
    seasonNumber,
    episodeNumber: presetEp,
    addingLinks: existingLinks,
    pendingSave: undefined,
    awaiting: null,
  });
  await tgSend(chatId, `<b>${presetEp ? "✏️ Edit Episode" : "➕ Add Episode"}</b> — Season ${seasonNumber}${presetEp ? ` · EP ${presetEp}` : ""}\n\nকোন মোডে যোগ করবেন?`, {
    reply_markup: kb([[
      { text: "⚡ Auto (paste post)", data: `mode_add:auto` },
      { text: "✋ Manual (button-by-button)", data: `mode_add:manual` },
    ], [{ text: "⬅ Back to Season", data: `season:${collection}:${seriesId}:${seasonNumber}` }]]),
  });
}

async function showManualLinkPanel(chatId: number) {
  const sess = await getSession(chatId);
  const links = sess.addingLinks || {};
  const status = (k: keyof AddingLinks, label: string) => (links[k] ? `✅ ${label}` : label);
  const epLabel = sess.episodeNumber ? `EP ${sess.episodeNumber}` : "EP ?";
  const existingStatus = [
    `Default: ${links.def ? "✅" : "—"}`,
    `480p: ${links["480"] ? "✅" : "—"}`,
    `720p: ${links["720"] ? "✅" : "—"}`,
    `1080p: ${links["1080"] ? "✅" : "—"}`,
    `4K: ${links["4k"] ? "✅" : "—"}`,
  ].join("\n");
  const text =
    `<b>✋ Manual Mode</b> — Season ${sess.seasonNumber}, ${epLabel}\n\n` +
    (sess.episodeNumber ? "" : `প্রথমে EP number সেট করুন।\n\n`) +
    `যে quality এর link দিতে চান সেই button চাপুন। শেষে Finish।\n\n` +
    `<b>Current status</b>\n${existingStatus}`;
  const rows: any[][] = [];
  if (!sess.episodeNumber) {
    rows.push([{ text: "🔢 Set Episode Number", data: "manual:setep" }]);
  } else {
    rows.push([{ text: "🔢 Change Episode Number", data: "manual:setep" }]);
    rows.push([
      { text: status("def", "Default"), data: "manual:def" },
      { text: status("480", "480p"), data: "manual:480" },
    ]);
    rows.push([
      { text: status("720", "720p"), data: "manual:720" },
      { text: status("1080", "1080p"), data: "manual:1080" },
    ]);
    rows.push([{ text: status("4k", "4K"), data: "manual:4k" }]);
    rows.push([{ text: "✅ Finish", data: "manual:finish" }, { text: "✏️ Continue Edit", data: "manual:back" }]);
    if (sess.collection && sess.seriesId && sess.seasonNumber) {
      rows.push([{ text: "⬅ Back to Season", data: `season:${sess.collection}:${sess.seriesId}:${sess.seasonNumber}` }, { text: "🏠 Menu", data: "menu" }]);
    }
  }
  await tgSend(chatId, text, { reply_markup: kb(rows) });
}

async function showFinishPreview(chatId: number) {
  const sess = await getSession(chatId);
  if (!sess.collection || !sess.seriesId || !sess.seasonNumber || !sess.episodeNumber) {
    await tgSend(chatId, "❌ Incomplete data."); return;
  }
  const series: any = await fbGet(`${sess.collection}/${sess.seriesId}`);
  const links = sess.addingLinks || {};
  if (!Object.values(links).some(Boolean)) {
    await tgSend(chatId, "❌ কমপক্ষে ১টা quality link দিন, তারপর Finish চাপুন।");
    await showManualLinkPanel(chatId);
    return;
  }
  const linkSummary = Object.entries(links)
    .map(([k, v]) => `<code>${k}</code>: ${v ? "✅" : "—"}`)
    .join("\n");
  await patchSession(chatId, {
    pendingSave: {
      collection: sess.collection,
      seriesId: sess.seriesId,
      seasonNumber: sess.seasonNumber,
      episodeNumber: sess.episodeNumber,
      links,
    },
  });
  const caption =
    `<b>${series?.title || sess.seriesId}</b>\n` +
    `Season ${sess.seasonNumber} — EP ${sess.episodeNumber}\n\n` +
    `${linkSummary}\n\n` +
    `আপনি এই episode টি add করতে চান?`;
  const photo = series?.poster || series?.backdrop || FALLBACK_POSTER;
  await tgSendPhoto(chatId, photo, caption, {
    reply_markup: kb([
      [
        { text: "✅ Allow & Save", data: "save:allow" },
        { text: "✏️ Back to Edit", data: "manual:back" },
      ],
      [{ text: "❌ Disallow", data: "save:deny" }],
    ]),
  });
}

// ---------- Weekly reminders ----------
async function buildWeeklyReminders() {
  const pending: any = (await fbGet("weeklyPending")) || {};
  const out: any[] = [];
  const now = Date.now();
  for (const [seriesId, e] of Object.entries(pending) as [string, any][]) {
    if (!e) continue;
    if (e.endedAt) continue;
    if (e.status === "ended" || e.fullSeason === true) continue;
    const next = Number(e.nextReleaseAt || 0);
    if (next && next > now + 12 * 3600_000) continue;
    out.push({ seriesId, ...e });
  }
  return out;
}
async function sendWeeklyReminderTo(chatId: number) {
  const list = await buildWeeklyReminders();
  if (list.length === 0) {
    await tgSend(chatId, "✅ আজ কোনো running anime episode pending নেই।");
    return;
  }
  await tgSend(chatId, `📅 <b>Today's Episode Reminder</b>\n${list.length} টি running anime এর episode আসার কথা:`);
  for (const item of list) {
    const collection = item.collection === "movies" ? "movies" : "webseries";
    const title = item.seriesTitle || item.title || item.seriesId;
    await tgSend(chatId,
      `<b>${title}</b>\n📂 ${collection}\nNext: ${item.nextReleaseAt ? new Date(item.nextReleaseAt).toLocaleDateString() : "today"}`,
      {
        reply_markup: kb([
          [{ text: "➕ Add Episode", data: `addep:${collection}:${item.seriesId}:${item.seasonNumber || 1}` }],
          [{ text: "✅ Mark as Read", data: `weekly:read:${item.seriesId}` }],
          [{ text: "🏁 End of Season", data: `weekly:end:${item.seriesId}` }],
        ]),
      });
  }
}

// ---------- Callback handler ----------
async function handleCallback(cb: any) {
  const chatId = cb.message?.chat?.id;
  const data: string = cb.data || "";
  const cbId = cb.id;
  if (cb.from?.id !== ADMIN_TG_ID) {
    await tgAnswerCb(cbId, "❌ Unauthorized");
    return;
  }
  await tgAnswerCb(cbId);

  if (data === "menu") return showMainMenu(chatId);
  if (data === "close") {
    if (cb.message?.message_id) await tgDeleteMessage(chatId, cb.message.message_id);
    return;
  }
  if (data === "guide:manual") return showManualHelp(chatId);
  if (data === "help") {
    return showManualHelp(chatId);
  }
  if (data === "ai:clear") {
    await fbDelete(`telegramAiHistory/${chatId}`);
    await tgSend(chatId, "🧹 AI history cleared.");
    return;
  }
  if (data === "weekly:run") return sendWeeklyReminderTo(chatId);

  if (data === "mode:ai") {
    await patchSession(chatId, { mode: "ai", awaiting: "ai_chat", pendingOps: [] });
    await tgSend(chatId,
      `🤖 <b>AI Mode</b>\n\n` +
      `সব RS anime এর title আমি মুখস্ত রাখি।\n` +
      `যেকোনো ভাষায় যা বলবেন proposal দিবো → Allow/Disallow।\n\n` +
      `<code>/menu</code> = main menu, <code>/cancel</code> = exit`);
    return;
  }
  if (data === "mode:manual" || data === "search") return showSearchPrompt(chatId);

  if (data.startsWith("anime:") || data.startsWith("pick:")) {
    const [, collection, seriesId] = data.split(":");
    return showAnimeDetail(chatId, collection, seriesId);
  }
  if (data.startsWith("quickadd:")) {
    const [, mode, collection, seriesId, sn, en] = data.split(":");
    if (mode === "manual") {
      await startAddEpisode(chatId, collection, seriesId, Number(sn), Number(en));
      return showManualLinkPanel(chatId);
    }
    await startAddEpisode(chatId, collection, seriesId, Number(sn), Number(en));
    await patchSession(chatId, { awaiting: "auto_paste" });
    await tgSend(chatId,
      `⚡ <b>Auto Mode</b> — S${sn} EP ${en}\n\n` +
      `এখন episode post/paste পাঠান। Title/Episode/Quality/URL থাকলে auto detect করবে।`);
    return;
  }
  if (data.startsWith("season:")) {
    const [, collection, seriesId, sn] = data.split(":");
    return showSeasonDetail(chatId, collection, seriesId, Number(sn));
  }
  if (data.startsWith("ep:")) {
    const [, collection, seriesId, sn, en] = data.split(":");
    return showEpisodeDetail(chatId, collection, seriesId, Number(sn), Number(en));
  }
  if (data.startsWith("addep:")) {
    const parts = data.split(":");
    const collection = parts[1], seriesId = parts[2], sn = Number(parts[3]);
    const presetEp = parts[4] ? Number(parts[4]) : undefined;
    return startAddEpisode(chatId, collection, seriesId, sn, presetEp);
  }
  if (data === "mode_add:auto") {
    await patchSession(chatId, { awaiting: "auto_paste" });
    await tgSend(chatId,
      `⚡ <b>Auto Mode</b>\n\n` +
      `Episode post টা paste করুন (Title/Episode/Quality + URL)।\n` +
      `একসাথে অনেকগুলো block দিতে পারেন (blank line দিয়ে আলাদা)।\n\n` +
      `<code>/cancel</code> = বাদ`);
    return;
  }
  if (data === "mode_add:manual") {
    return showManualLinkPanel(chatId);
  }
  if (data === "manual:setep") {
    await patchSession(chatId, { awaiting: "manual_episode_number" });
    await tgSend(chatId, "🔢 Episode number লিখুন (যেমন: <code>13</code>):");
    return;
  }
  if (data.startsWith("manual:") && ["def","480","720","1080","4k"].includes(data.split(":")[1])) {
    const q = data.split(":")[1];
    const map: Record<string, Session["awaiting"]> = {
      def: "manual_default",
      "480": "manual_480",
      "720": "manual_720",
      "1080": "manual_1080",
      "4k": "manual_4k",
    };
    await patchSession(chatId, { awaiting: map[q] });
    await tgSend(chatId, `🔗 <b>${q === "def" ? "Default" : q + (q === "4k" ? "" : "p")} link</b> পাঠান:`);
    return;
  }
  if (data === "manual:finish") {
    return showFinishPreview(chatId);
  }
  if (data === "manual:back") return showManualLinkPanel(chatId);
  if (data === "save:allow") {
    const sess = await getSession(chatId);
    if (!sess.pendingSave) { await tgSend(chatId, "❌ কিছু pending নেই।"); return; }
    const ps = sess.pendingSave;
    await saveEpisodeMulti(ps.collection, ps.seriesId, ps.seasonNumber, ps.episodeNumber, ps.links);
    await patchSession(chatId, { addingLinks: {}, episodeNumber: undefined, awaiting: "post_after_save" });
    await tgSend(chatId, `✅ EP ${ps.episodeNumber} saved!\n\nএখন Telegram channel এ post করতে চান?`, {
      reply_markup: kb([[
        { text: "✅ Yes, Post", data: `post:${ps.collection}:${ps.seriesId}:${ps.seasonNumber}:${ps.episodeNumber}` },
        { text: "❌ No", data: "menu" },
      ]]),
    });
    return;
  }
  if (data === "save:deny") {
    await patchSession(chatId, { pendingSave: undefined });
    await tgSend(chatId, "❌ Cancelled. কিছু save হয়নি।");
    return;
  }
  if (data.startsWith("post:")) {
    const [, collection, seriesId, sn, en] = data.split(":");
    const r = await postEpisodeToChannel(collection, seriesId, Number(sn), Number(en));
    await tgSend(chatId, r?.ok ? "✅ Posted to Telegram channel." : `❌ Post failed: ${JSON.stringify(r).slice(0, 200)}`);
    return;
  }
  if (data.startsWith("del:")) {
    const [, collection, seriesId, sn, en] = data.split(":");
    const ok = await deleteEpisode(collection, seriesId, Number(sn), Number(en));
    await tgSend(chatId, ok ? `🗑 EP ${en} deleted.` : "❌ Delete failed.");
    return;
  }
  if (data.startsWith("weekly:read:")) {
    const seriesId = data.split(":")[2];
    const e: any = await fbGet(`weeklyPending/${seriesId}`);
    if (e) {
      const now = Date.now();
      await fbPatch(`weeklyPending/${seriesId}`, {
        lastReleasedAt: now,
        releasedSavedAt: now,
        nextReleaseAt: now + (e.weeklyEveryDays || 7) * 86400000,
      });
    }
    await tgSend(chatId, "✅ Marked as released.");
    return;
  }
  if (data.startsWith("weekly:end:")) {
    const seriesId = data.split(":")[2];
    await fbPatch(`weeklyPending/${seriesId}`, { endedAt: Date.now(), status: "ended", fullSeason: true });
    await tgSend(chatId, "🏁 Marked End of Season — আর reminder পাবেন না।");
    return;
  }
  if (data.startsWith("aiop:")) {
    const action = data.split(":")[1];
    const sess = await getSession(chatId);
    if (action === "allow" && Array.isArray(sess.pendingOps) && sess.pendingOps.length > 0) {
      const r = await executeAdminAi(sess.pendingOps);
      const summary = (r?.results || []).map((x: any) => `${x.ok ? "✅" : "❌"} ${x.op}: ${x.message || ""}`).join("\n");
      await tgSend(chatId, `<b>Execution result:</b>\n${summary || "(empty)"}`);
    } else {
      await tgSend(chatId, "❌ Disallowed — কিছু execute হয়নি।");
    }
    await patchSession(chatId, { pendingOps: [] });
    return;
  }
}

// ---------- Message handler ----------
async function handleMessage(msg: any) {
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();
  if (msg.from?.id !== ADMIN_TG_ID) {
    await tgSend(chatId, "❌ Unauthorized. This bot is private.");
    return;
  }

  if (text === "/start" || text === "/menu") return showMainMenu(chatId);
  if (text === "/cancel") {
    await setSession(chatId, {});
    return showMainMenu(chatId, "✖ Cancelled.");
  }
  if (text === "/weekly") return sendWeeklyReminderTo(chatId);

  const sess = await getSession(chatId);

  // ---- Search anime (RS only, fuzzy) ----
  if (sess.awaiting === "search_anime") {
    const results = await searchAnimeRS(text);
    if (results.length === 0) {
      await tgSendPhoto(chatId, FALLBACK_POSTER,
        `❌ "<b>${text}</b>" এর কাছাকাছি কিছু পাওয়া যায়নি।\n\nআবার চেষ্টা করুন বা <code>/cancel</code>।`);
      return;
    }
    if (results.length === 1) {
      // direct open
      return showAnimeDetail(chatId, results[0].collection, results[0].id);
    }
    const rows = results.map((r) => [{
      text: `${r.title} (${r.collection}) ${Math.round(r.score * 100)}%`,
      data: `pick:${r.collection}:${r.id}`,
    }]);
    await tgSendPhoto(chatId, FALLBACK_POSTER,
      `🔎 <b>${results.length}</b> ফলাফল "<i>${text}</i>" — সঠিকটি বেছে নিন:`,
      { reply_markup: kb(rows) });
    return;
  }

  // ---- Manual: episode number ----
  if (sess.awaiting === "manual_episode_number") {
    const n = parseInt(text, 10);
    if (!n || n < 1) { await tgSend(chatId, "❌ Valid episode number লিখুন।"); return; }
    await patchSession(chatId, { episodeNumber: n, awaiting: null });
    return showManualLinkPanel(chatId);
  }

  // ---- Manual: link inputs ----
  const linkMap: Record<string, keyof AddingLinks> = {
    manual_default: "def",
    manual_480: "480",
    manual_720: "720",
    manual_1080: "1080",
    manual_4k: "4k",
  };
  if (sess.awaiting && linkMap[sess.awaiting]) {
    if (!/^https?:\/\//i.test(text)) {
      await tgSend(chatId, "❌ Valid URL দিন (https://...)।"); return;
    }
    const key = linkMap[sess.awaiting];
    const links = { ...(sess.addingLinks || {}), [key]: text };
    await patchSession(chatId, { addingLinks: links, awaiting: null });
    return showManualLinkPanel(chatId);
  }

  // ---- Auto paste ----
  if (sess.awaiting === "auto_paste" && sess.collection && sess.seriesId && sess.seasonNumber) {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const pieces = blocks.length > 0 ? blocks : [text];
    const aggregated: Record<number, AddingLinks> = {};
    const titlesSeen: Record<number, string | undefined> = {};
    let failed = 0;
    const lines: string[] = [];
    for (const blk of pieces) {
      const p = parseEpisodeBlock(blk);
      if (!p.url || !p.episode) {
        failed++;
        lines.push(`❌ parse failed: ${blk.slice(0, 60)}`);
        continue;
      }
      const k = qualityField(p.quality);
      const ql: keyof AddingLinks =
        k === "link480" ? "480" :
        k === "link720" ? "720" :
        k === "link1080" ? "1080" :
        k === "link4k" ? "4k" : "def";
      aggregated[p.episode] = { ...(aggregated[p.episode] || {}), [ql]: p.url };
      titlesSeen[p.episode] = p.title;
      lines.push(`✅ EP ${p.episode} (${ql}) ready`);
    }
    let saved = 0;
    for (const [epStr, links] of Object.entries(aggregated)) {
      const ep = Number(epStr);
      try {
        await saveEpisodeMulti(sess.collection, sess.seriesId, sess.seasonNumber, ep, links, titlesSeen[ep]);
        saved++;
      } catch (e: any) {
        failed++;
        lines.push(`❌ EP ${ep} save: ${e?.message || e}`);
      }
    }
    const epList = Object.keys(aggregated).map(Number).sort((a, b) => a - b);
    const series: any = await fbGet(`${sess.collection}/${sess.seriesId}`);
    await tgSendPhoto(chatId, series?.poster || FALLBACK_POSTER,
      `<b>${series?.title || sess.seriesId}</b>\nSeason ${sess.seasonNumber}\n\n` +
      `আপনি EP <b>${epList.join(", ") || "?"}</b> add করেছেন (${saved} saved, ${failed} failed)।\n\nTelegram এ post করতে চান?`,
      {
        reply_markup: kb([
          ...(epList.length > 0 ? [[
            { text: `✅ Post EP ${epList[epList.length - 1]}`, data: `post:${sess.collection}:${sess.seriesId}:${sess.seasonNumber}:${epList[epList.length - 1]}` },
          ]] : []),
          [{ text: "❌ No", data: "menu" }],
        ]),
      });
    await patchSession(chatId, { awaiting: null });
    return;
  }

  // ---- AI mode ----
  if (sess.mode === "ai" || sess.awaiting === "ai_chat") {
    await appendHistory(chatId, "user", text);
    const history = await getHistory(chatId);
    // Build a system memory of all RS anime so AI never says "not found"
    const brief = await getRSAnimeBrief();
    const systemMsg = {
      role: "system",
      content:
        `You are the RS Anime Telegram admin assistant.\n` +
        `IMPORTANT: Below is the FULL list of every RS anime (with id, title, season/episode counts). ` +
        `Always match the user's query (even with typos / Banglish) to one of these by fuzzy matching. ` +
        `Never say "not found" — if uncertain, propose the closest match and ask to confirm.\n\n` +
        `RS ANIME CATALOG:\n${brief.slice(0, 8000)}`,
    };
    const messages = [systemMsg, ...history.slice(-30).map((h: any) => ({ role: h.role, content: h.content }))];
    const r = await callAdminAi(messages);
    const reply = r?.reply || "(empty)";
    await appendHistory(chatId, "assistant", reply);
    const ops = Array.isArray(r?.operations) ? r.operations : [];
    await patchSession(chatId, { pendingOps: ops });

    let out = reply.slice(0, 3500);
    if (ops.length > 0) {
      out += `\n\n<b>Proposed ${ops.length} operation(s):</b>\n` +
        ops.map((o: any, i: number) => `${i + 1}. <code>${o.name}</code> ${JSON.stringify(o.args).slice(0, 200)}`).join("\n");
      await tgSend(chatId, out, {
        reply_markup: kb([[
          { text: "✅ Allow & Execute", data: "aiop:allow" },
          { text: "❌ Disallow", data: "aiop:deny" },
        ]]),
      });
    } else {
      await tgSend(chatId, out);
    }
    return;
  }

  // Default
  return showMainMenu(chatId, "Command বুঝিনি — Menu থেকে বেছে নিন।");
}

// ---------- Entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.test === true) return json({ ok: true, ping: "telegram-admin-bot v2" });

    if (body?.action === "weekly_push") {
      await sendWeeklyReminderTo(ADMIN_TG_ID);
      return json({ ok: true });
    }

    if (typeof body?.update_id !== "undefined") {
      if (body.callback_query) await handleCallback(body.callback_query);
      else if (body.message) await handleMessage(body.message);
      return json({ ok: true });
    }

    if (body?.action === "set_webhook" && body?.url) {
      const t = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const r = await fetch(`https://api.telegram.org/bot${t}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: body.url, allowed_updates: ["message", "callback_query"] }),
      });
      return json(await r.json());
    }

    return json({ ok: true, hint: "send Telegram update or {action:'weekly_push'|'set_webhook'}" });
  } catch (e: any) {
    console.error("telegram-admin-bot error:", e);
    return json({ error: e?.message || "Unknown" }, 500);
  }
});
