// =====================================================================
// Telegram Admin Bot — Full admin control for RS Anime via Telegram
// =====================================================================
// • Restricted to ADMIN_TG_ID = 6621572366
// • Two modes: AI Mode (chat → admin-ai → Allow/Disallow) and Manual Mode
//   (button-driven episode add/edit/delete + post-to-telegram)
// • Persistent AI history at Firebase telegramAiHistory/{chatId}
// • Auto-parses pasted episode posts (Title / Episode / Quality / URL)
// • Weekly reminders: pushed by external cron at 21:00 Asia/Dhaka,
//   ONLY for running anime (full-season anime are skipped)
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
async function tgEdit(chatId: number | string, messageId: number, text: string, extra: any = {}) {
  await fetch(tgApi("editMessageText"), {
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
}
async function tgAnswerCb(cbId: string, text = "") {
  await fetch(tgApi("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}

const kb = (rows: { text: string; data?: string; url?: string }[][]) => ({
  inline_keyboard: rows.map((r) =>
    r.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })),
  ),
});

// ---------- Session state per chat ----------
// Stored at Firebase: telegramBotSessions/{chatId}
type Session = {
  mode?: "ai" | "manual" | null;
  awaiting?:
    | "search_anime"
    | "ai_chat"
    | "paste_links"
    | "edit_episode_link"
    | "new_anime_tmdb"
    | null;
  selectedCollection?: "webseries" | "movies" | "animesalt";
  selectedSeriesId?: string;
  selectedSeasonNumber?: number;
  editingEpisodeNumber?: number;
  pendingOps?: any[]; // proposed by AI awaiting Allow
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

// ---------- Episode link parser ----------
// Accepts the user's posted-style block and tries to extract title, episode, quality, url.
function parseEpisodeBlock(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: { title?: string; episode?: number; quality?: string; size?: string; url?: string } = {};

  for (const ln of lines) {
    const titleM = ln.match(/^(?:Title|টাইটেল)\s*[:\-]\s*(.+)$/i);
    if (titleM && !out.title) out.title = titleM[1].replace(/[━─]+/g, "").trim();

    // Heading "Title : ZERO"
    const headerTitleM = ln.match(/^(?:Re\s*:\s*)?Title\s*[:\-]\s*(.+)$/i);
    if (headerTitleM && !out.title) out.title = headerTitleM[1].trim();

    const epM = ln.match(/(?:Episode|EP|এপিসোড)\s*[:\-#]?\s*(\d+)/i);
    if (epM && out.episode === undefined) out.episode = Number(epM[1]);

    const qM = ln.match(/(?:Quality|কোয়ালিটি)\s*[:\-]\s*([0-9a-zA-Z]+)/i);
    if (qM && !out.quality) out.quality = qM[1].toLowerCase();

    const sM = ln.match(/(?:Size|সাইজ)\s*[:\-]\s*([0-9.]+\s*(?:MB|GB|KB))/i);
    if (sM && !out.size) out.size = sM[1];

    const urlM = ln.match(/https?:\/\/\S+/);
    if (urlM && !out.url) out.url = urlM[0];
  }

  // Fallbacks: detect quality from URL text
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

// Map quality token to link field
function qualityField(q?: string): "link480" | "link720" | "link1080" | "link4k" | "link" {
  if (!q) return "link";
  const s = q.toLowerCase();
  if (s.includes("2160") || s.includes("4k")) return "link4k";
  if (s.includes("1080")) return "link1080";
  if (s.includes("720")) return "link720";
  if (s.includes("480")) return "link480";
  return "link";
}

// ---------- Search anime by title ----------
async function searchAnime(q: string) {
  const needle = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  const results: { collection: string; id: string; title: string }[] = [];
  for (const collection of ["webseries", "movies", "animesalt"] as const) {
    const all: any = await fbGet(collection === "animesalt" ? "animesaltSelected" : collection);
    if (!all || typeof all !== "object") continue;
    for (const [id, v] of Object.entries(all) as [string, any][]) {
      const title = String(v?.title || v?.name || id);
      const norm = title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (norm.includes(needle) || needle.includes(norm)) {
        results.push({ collection, id, title });
        if (results.length >= 12) return results;
      }
    }
  }
  return results;
}

async function getSeriesEpisodes(collection: string, seriesId: string, seasonNumber: number) {
  const cPath = collection === "animesalt" ? "animesaltSelected" : collection;
  const seasons: any = (await fbGet(`${cPath}/${seriesId}/seasons`)) || [];
  const arr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  const s = arr.find((x: any) => x?.seasonNumber === seasonNumber);
  if (!s) return { eps: [], seasonsCount: arr.length };
  const eps = Array.isArray(s.episodes) ? s.episodes : Object.values(s.episodes || {});
  return { eps, seasonsCount: arr.length };
}

// ---------- Save episode (manual mode) ----------
async function saveEpisode(
  collection: string,
  seriesId: string,
  seasonNumber: number,
  episodeNumber: number,
  url: string,
  quality?: string,
  title?: string,
) {
  const cPath = collection === "animesalt" ? "animesaltSelected" : collection;
  const seasonsPath = `${cPath}/${seriesId}/seasons`;
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
  const field = qualityField(quality);
  const existing = epList.findIndex((e: any) => e?.episodeNumber === episodeNumber);
  if (existing >= 0) {
    epList[existing] = {
      ...epList[existing],
      [field]: url,
      title: title || epList[existing].title || `Episode ${episodeNumber}`,
    };
  } else {
    const ep: any = { episodeNumber, title: title || `Episode ${episodeNumber}`, [field]: url };
    epList.push(ep);
  }
  epList.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
  await fbPut(epPath, epList);
  return { ok: true, field };
}

async function deleteEpisode(collection: string, seriesId: string, seasonNumber: number, episodeNumber: number) {
  const cPath = collection === "animesalt" ? "animesaltSelected" : collection;
  const seasonsPath = `${cPath}/${seriesId}/seasons`;
  const seasons: any = (await fbGet(seasonsPath)) || [];
  const arr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  const sIdx = arr.findIndex((s: any) => s?.seasonNumber === seasonNumber);
  if (sIdx < 0) return false;
  const eps = Array.isArray(arr[sIdx].episodes) ? arr[sIdx].episodes : Object.values(arr[sIdx].episodes || {});
  const next = eps.filter((e: any) => e?.episodeNumber !== episodeNumber);
  await fbPut(`${seasonsPath}/${sIdx}/episodes`, next);
  return true;
}

// ---------- Telegram channel post for an episode ----------
async function postEpisodeToChannel(collection: string, seriesId: string, seasonNumber: number, episodeNumber: number) {
  const cPath = collection === "animesalt" ? "animesaltSelected" : collection;
  const series: any = await fbGet(`${cPath}/${seriesId}`);
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

// ---------- AI Mode bridge ----------
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

// ---------- UI Builders ----------
function mainMenu() {
  return tgSend.bind(null);
}
async function showMainMenu(chatId: number, prefix = "") {
  const text =
    (prefix ? prefix + "\n\n" : "") +
    `🎬 <b>RS Anime Admin Bot</b>\n` +
    `\n━━━━━━━━━━━━━━━━━━\n` +
    `একটা মোড বেছে নিন:\n` +
    `\n🤖 <b>AI Mode</b> — যা বলবেন AI বুঝে কাজ করবে (Allow দিতে হবে)\n` +
    `🔧 <b>Manual Mode</b> — Search → Anime → Episode add/edit/delete + Post`;
  await tgSend(chatId, text, {
    reply_markup: kb([
      [{ text: "🤖 AI Mode", data: "mode:ai" }, { text: "🔧 Manual Mode", data: "mode:manual" }],
      [{ text: "📺 Weekly Reminder Now", data: "weekly:run" }],
      [{ text: "🧹 Clear AI History", data: "ai:clear" }, { text: "❓ Help", data: "help" }],
    ]),
  });
}

async function showSearchPrompt(chatId: number) {
  await patchSession(chatId, { mode: "manual", awaiting: "search_anime" });
  await tgSend(
    chatId,
    `🔎 <b>Search Anime</b>\n\nএনিমির নাম লিখে পাঠান (যেমন: <code>One Piece</code>)\n\nবা <code>/cancel</code> লিখে বাদ দিন।`,
  );
}

async function showAnimeDetail(chatId: number, collection: string, seriesId: string) {
  const cPath = collection === "animesalt" ? "animesaltSelected" : collection;
  const series: any = await fbGet(`${cPath}/${seriesId}`);
  if (!series) {
    await tgSend(chatId, "❌ Series পাওয়া যায়নি।");
    return;
  }
  const seasons = Array.isArray(series.seasons) ? series.seasons : Object.values(series.seasons || {});
  const totalEps = seasons.reduce((acc: number, s: any) => {
    const e = Array.isArray(s.episodes) ? s.episodes : Object.values(s.episodes || {});
    return acc + e.length;
  }, 0);
  await patchSession(chatId, {
    selectedCollection: collection as any,
    selectedSeriesId: seriesId,
    awaiting: null,
  });
  const text =
    `<b>${series.title || seriesId}</b>\n` +
    `📂 ${collection}\n` +
    `📅 Year: ${series.year || "-"}\n` +
    `⭐ ${series.rating || "-"}\n` +
    `📺 Seasons: ${seasons.length} · Episodes: ${totalEps}\n`;
  const seasonRows = seasons.slice(0, 10).map((s: any) => [{
    text: `📁 Season ${s.seasonNumber} (${(Array.isArray(s.episodes) ? s.episodes : Object.values(s.episodes || {})).length} ep)`,
    data: `season:${collection}:${seriesId}:${s.seasonNumber}`,
  }]);
  await tgSend(chatId, text, {
    reply_markup: kb([
      ...seasonRows,
      [{ text: "➕ Add New Season Episode (paste links)", data: `paste:${collection}:${seriesId}:1` }],
      [{ text: "🔎 Search again", data: "search" }, { text: "🏠 Menu", data: "menu" }],
    ]),
  });
}

async function showSeasonDetail(chatId: number, collection: string, seriesId: string, seasonNumber: number) {
  const { eps } = await getSeriesEpisodes(collection, seriesId, seasonNumber);
  await patchSession(chatId, {
    selectedCollection: collection as any,
    selectedSeriesId: seriesId,
    selectedSeasonNumber: seasonNumber,
    awaiting: null,
  });
  const list = eps.slice(0, 30).map((e: any) => `EP ${e.episodeNumber} — ${e.title || ""}`).join("\n") || "(কোনো episode নেই)";
  const text = `<b>Season ${seasonNumber}</b>\n\n${list}`;
  const epButtons = eps.slice(0, 12).map((e: any) => ({
    text: `EP ${e.episodeNumber}`,
    data: `ep:${collection}:${seriesId}:${seasonNumber}:${e.episodeNumber}`,
  }));
  const rows: any[][] = [];
  for (let i = 0; i < epButtons.length; i += 4) rows.push(epButtons.slice(i, i + 4));
  rows.push([{ text: "➕ Add Episode (paste link)", data: `paste:${collection}:${seriesId}:${seasonNumber}` }]);
  rows.push([{ text: "📢 Post Latest to Telegram", data: `post:${collection}:${seriesId}:${seasonNumber}:${eps[eps.length - 1]?.episodeNumber || 0}` }]);
  rows.push([{ text: "⬅ Back", data: `anime:${collection}:${seriesId}` }, { text: "🏠 Menu", data: "menu" }]);
  await tgSend(chatId, text, { reply_markup: kb(rows) });
}

async function showEpisodeDetail(chatId: number, collection: string, seriesId: string, seasonNumber: number, epNum: number) {
  const { eps } = await getSeriesEpisodes(collection, seriesId, seasonNumber);
  const e = eps.find((x: any) => x?.episodeNumber === epNum);
  if (!e) { await tgSend(chatId, "❌ Episode পাওয়া যায়নি।"); return; }
  const links = ["link", "link480", "link720", "link1080", "link4k"]
    .filter((k) => e[k])
    .map((k) => `<code>${k}</code>: ${e[k]}`).join("\n") || "(no links)";
  await tgSend(chatId, `<b>EP ${epNum}</b> — ${e.title || ""}\n\n${links}`, {
    reply_markup: kb([
      [{ text: "✏️ Replace Link (paste)", data: `paste:${collection}:${seriesId}:${seasonNumber}` }],
      [{ text: "📢 Post to Telegram", data: `post:${collection}:${seriesId}:${seasonNumber}:${epNum}` }],
      [{ text: "🗑 Delete EP", data: `del:${collection}:${seriesId}:${seasonNumber}:${epNum}` }],
      [{ text: "⬅ Back", data: `season:${collection}:${seriesId}:${seasonNumber}` }],
    ]),
  });
}

// ---------- Weekly reminders ----------
async function buildWeeklyReminders() {
  // Pull weeklyPending entries; only those that are NOT marked as full season completed.
  const pending: any = (await fbGet("weeklyPending")) || {};
  const out: any[] = [];
  const now = Date.now();
  for (const [seriesId, e] of Object.entries(pending) as [string, any][]) {
    if (!e) continue;
    if (e.endedAt) continue; // marked as End of Season
    if (e.status === "ended" || e.fullSeason === true) continue;
    // Only items whose nextReleaseAt is today or earlier
    const next = Number(e.nextReleaseAt || 0);
    if (next && next > now + 12 * 3600_000) continue; // not due yet
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
    const collection = item.collection || "webseries";
    const title = item.seriesTitle || item.title || item.seriesId;
    await tgSend(chatId,
      `<b>${title}</b>\n📂 ${collection}\nNext: ${item.nextReleaseAt ? new Date(item.nextReleaseAt).toLocaleDateString() : "today"}`,
      {
        reply_markup: kb([
          [{ text: "➕ Add Episode", data: `paste:${collection}:${item.seriesId}:${item.seasonNumber || 1}` }],
          [{ text: "✅ Mark as Read", data: `weekly:read:${item.seriesId}` }],
          [{ text: "🏁 End of Season", data: `weekly:end:${item.seriesId}` }],
        ]),
      });
  }
}

// ---------- Handlers ----------
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
  if (data === "help") {
    await tgSend(chatId,
      `<b>Help</b>\n\n` +
      `• 🤖 AI Mode: যা বলবেন (Bangla/English) AI Allow চাইবে → Allow চাপলে execute হবে\n` +
      `• 🔧 Manual Mode: Search → Season → Add/Edit/Delete + Post\n` +
      `• Episode add: format paste করুন (Title/Episode/Quality + URL) → অটো parse হবে\n` +
      `• Weekly reminders আজকে যেগুলোর episode আসার কথা সেগুলো রাত ৯টায় পাঠাবে`);
    return;
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
      `এখন আমাকে যা বলবেন AI বুঝে কাজ proposal দিবে। তারপর Allow/Disallow।\n` +
      `History সব সময় Firebase-এ save থাকবে।\n\n` +
      `উদাহরণ: <i>"One Piece এর S1 EP100 add করো এই লিংকে: https://..."</i>\n\n` +
      `<code>/menu</code> = main menu, <code>/cancel</code> = exit`);
    return;
  }
  if (data === "mode:manual") return showSearchPrompt(chatId);
  if (data === "search") return showSearchPrompt(chatId);

  if (data.startsWith("anime:")) {
    const [, collection, seriesId] = data.split(":");
    return showAnimeDetail(chatId, collection, seriesId);
  }
  if (data.startsWith("season:")) {
    const [, collection, seriesId, sn] = data.split(":");
    return showSeasonDetail(chatId, collection, seriesId, Number(sn));
  }
  if (data.startsWith("ep:")) {
    const [, collection, seriesId, sn, en] = data.split(":");
    return showEpisodeDetail(chatId, collection, seriesId, Number(sn), Number(en));
  }
  if (data.startsWith("paste:")) {
    const [, collection, seriesId, sn] = data.split(":");
    await patchSession(chatId, {
      mode: "manual",
      awaiting: "paste_links",
      selectedCollection: collection as any,
      selectedSeriesId: seriesId,
      selectedSeasonNumber: Number(sn),
    });
    await tgSend(chatId,
      `📋 <b>Paste Episode Link(s)</b> — Season ${sn}\n\n` +
      `যেমন format:\n<pre>Title : ZERO\nEpisode : 13\nQuality : 4K\nhttps://link.example/...</pre>\n\n` +
      `একসাথে অনেকগুলো paste করতে পারেন (প্রতিটি block আলাদা ভাবে parse হবে)।\n\n` +
      `<code>/cancel</code> = বাদ`);
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
    // aiop:allow or aiop:deny
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
  if (data.startsWith("pick:")) {
    // pick:<collection>:<seriesId>
    const [, collection, seriesId] = data.split(":");
    return showAnimeDetail(chatId, collection, seriesId);
  }
}

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

  // ---- Search anime ----
  if (sess.awaiting === "search_anime") {
    const results = await searchAnime(text);
    if (results.length === 0) {
      await tgSend(chatId, "❌ কিছু পাওয়া যায়নি। আবার চেষ্টা করুন বা <code>/cancel</code>।");
      return;
    }
    const rows = results.map((r) => [{
      text: `${r.title} (${r.collection})`,
      data: `pick:${r.collection}:${r.id}`,
    }]);
    await tgSend(chatId, `🔎 ${results.length} ফলাফল:`, { reply_markup: kb(rows) });
    return;
  }

  // ---- Paste links ----
  if (sess.awaiting === "paste_links" && sess.selectedCollection && sess.selectedSeriesId && sess.selectedSeasonNumber) {
    // Split into blocks separated by blank lines
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const pieces = blocks.length > 0 ? blocks : [text];
    let done = 0, failed = 0;
    const lines: string[] = [];
    for (const blk of pieces) {
      const p = parseEpisodeBlock(blk);
      if (!p.url || !p.episode) {
        failed++;
        lines.push(`❌ parse failed (need Episode + URL): ${blk.slice(0, 60)}`);
        continue;
      }
      try {
        const r = await saveEpisode(
          sess.selectedCollection!,
          sess.selectedSeriesId!,
          sess.selectedSeasonNumber!,
          p.episode,
          p.url,
          p.quality,
          p.title,
        );
        done++;
        lines.push(`✅ EP ${p.episode} (${r.field}) saved`);
      } catch (e: any) {
        failed++;
        lines.push(`❌ EP ${p.episode}: ${e?.message || e}`);
      }
    }
    await tgSend(chatId,
      `<b>Save result</b> — ${done} ok, ${failed} failed\n\n${lines.join("\n").slice(0, 3500)}`,
      {
        reply_markup: kb([
          [{ text: "📢 Post Latest to Telegram", data: `post:${sess.selectedCollection}:${sess.selectedSeriesId}:${sess.selectedSeasonNumber}:0` }],
          [{ text: "📁 Open Season", data: `season:${sess.selectedCollection}:${sess.selectedSeriesId}:${sess.selectedSeasonNumber}` }],
          [{ text: "🏠 Menu", data: "menu" }],
        ]),
      });
    await patchSession(chatId, { awaiting: null });
    return;
  }

  // ---- AI mode ----
  if (sess.mode === "ai" || sess.awaiting === "ai_chat") {
    await appendHistory(chatId, "user", text);
    const history = await getHistory(chatId);
    const messages = history.slice(-30).map((h: any) => ({ role: h.role, content: h.content }));
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

  // Default: show menu
  return showMainMenu(chatId, "Command বুঝিনি — Menu থেকে বেছে নিন।");
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.test === true) return json({ ok: true, ping: "telegram-admin-bot" });

    // Cron call: action=weekly_push (sends today's reminders to admin)
    if (body?.action === "weekly_push") {
      await sendWeeklyReminderTo(ADMIN_TG_ID);
      return json({ ok: true });
    }

    // Webhook from Telegram
    if (typeof body?.update_id !== "undefined") {
      if (body.callback_query) {
        await handleCallback(body.callback_query);
      } else if (body.message) {
        await handleMessage(body.message);
      }
      return json({ ok: true });
    }

    // Set webhook helper: { action: "set_webhook", url: "https://..." }
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
