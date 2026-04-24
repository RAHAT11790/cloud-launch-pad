// Admin AI Manager — Smart admin assistant with full Firebase RTDB tool-calling
// Uses Lovable AI Gateway (google/gemini-2.5-flash) and Firebase REST API.
// Returns a "plan" of operations the admin must Allow/Disallow before they execute.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const FIREBASE_DB_URL =
  Deno.env.get("FIREBASE_DATABASE_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// ---------------- Firebase REST helpers ----------------
async function fbGet(path: string) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!r.ok) return null;
  return await r.json();
}
async function fbPatch(path: string, data: unknown) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase PATCH ${path} failed: ${r.status}`);
  return await r.json();
}
async function fbPut(path: string, data: unknown) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase PUT ${path} failed: ${r.status}`);
  return await r.json();
}
async function fbDelete(path: string) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Firebase DELETE ${path} failed: ${r.status}`);
  return true;
}
async function fbPush(path: string, data: unknown) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Firebase POST ${path} failed: ${r.status}`);
  return await r.json();
}

// ---------------- Knowledge snapshot (cached 60s) ----------------
let snapshotCache: { ts: number; data: any } | null = null;
async function getKnowledge() {
  if (snapshotCache && Date.now() - snapshotCache.ts < 60_000) return snapshotCache.data;
  const [webseries, movies, animesalt, weeklyPending, bkash, unlock, users, settings] =
    await Promise.all([
      fbGet("webseries"),
      fbGet("movies"),
      fbGet("animesaltSelected"),
      fbGet("weeklyPending"),
      fbGet("bkashPayments"),
      fbGet("unlockRequests"),
      fbGet("users"),
      fbGet("settings"),
    ]);

  const summarize = (obj: any, type: string) => {
    if (!obj) return [];
    return Object.entries(obj).map(([id, v]: [string, any]) => ({
      id,
      type,
      title: v?.title || v?.name || id,
      seasons: v?.seasons ? Object.keys(v.seasons).length : undefined,
      episodes:
        v?.seasons
          ? Object.values(v.seasons).reduce(
              (acc: number, s: any) => acc + (s?.episodes ? Object.keys(s.episodes).length : 0),
              0,
            )
          : undefined,
    }));
  };

  const data = {
    counts: {
      webseries: webseries ? Object.keys(webseries).length : 0,
      movies: movies ? Object.keys(movies).length : 0,
      animesalt: animesalt ? Object.keys(animesalt).length : 0,
      weeklyPending: weeklyPending ? Object.keys(weeklyPending).length : 0,
      pendingBkash: bkash
        ? Object.values(bkash).filter((p: any) => p?.status === "pending").length
        : 0,
      unlockRequests: unlock ? Object.keys(unlock).length : 0,
      users: users ? Object.keys(users).length : 0,
    },
    webseries: summarize(webseries, "webseries").slice(0, 200),
    movies: summarize(movies, "movies").slice(0, 200),
    animesalt: summarize(animesalt, "animesalt").slice(0, 200),
    weeklyPending: weeklyPending
      ? Object.values(weeklyPending).map((e: any) => ({
          seriesId: e.seriesId,
          title: e.seriesTitle,
          nextReleaseAt: e.nextReleaseAt,
          weeklyEveryDays: e.weeklyEveryDays,
        }))
      : [],
    settings: settings || {},
  };
  snapshotCache = { ts: Date.now(), data };
  return data;
}

// ---------------- Tools (admin operations) ----------------
const tools = [
  {
    type: "function",
    function: {
      name: "add_episode",
      description:
        "Add a new episode to an existing series. Provide seriesId, seasonNumber, episodeNumber, optional title, and at least one quality link (link480/link720/link1080/link4k or link).",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies", "animesalt"] },
          seriesId: { type: "string" },
          seasonNumber: { type: "number" },
          episodeNumber: { type: "number" },
          title: { type: "string" },
          link: { type: "string" },
          link480: { type: "string" },
          link720: { type: "string" },
          link1080: { type: "string" },
          link4k: { type: "string" },
        },
        required: ["collection", "seriesId", "seasonNumber", "episodeNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_series",
      description: "Update fields on a series (title, poster, backdrop, description, year, genre, etc.)",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies", "animesalt"] },
          seriesId: { type: "string" },
          patch: { type: "object", description: "Partial object of fields to update" },
        },
        required: ["collection", "seriesId", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_item",
      description: "Delete a Firebase RTDB path (series, episode, user, etc.). DESTRUCTIVE.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Full Firebase path e.g. webseries/<id> or webseries/<id>/seasons/<n>/episodes/<n>" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_notification",
      description: "Send a push/FCM notification to all users.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          link: { type: "string" },
          imageUrl: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_telegram",
      description: "Trigger a Telegram channel post for an item.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies", "animesalt"] },
          seriesId: { type: "string" },
          message: { type: "string" },
        },
        required: ["collection", "seriesId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "release_weekly",
      description: "Mark a weekly-pending series as released (clears the red badge after 5 min).",
      parameters: {
        type: "object",
        properties: { seriesId: { type: "string" } },
        required: ["seriesId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_link",
      description: "HEAD-check a URL for availability (returns status + alive boolean).",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_subscription",
      description: "Approve a bKash subscription request and grant premium access.",
      parameters: {
        type: "object",
        properties: {
          paymentId: { type: "string" },
          days: { type: "number", description: "Premium duration days" },
        },
        required: ["paymentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_firebase_path",
      description: "Generic Firebase write — set/patch any path. Use only when no specific tool fits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          data: {},
          mode: { type: "string", enum: ["patch", "put"] },
        },
        required: ["path", "data"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_anime_from_tmdb",
      description: "Create a brand-new anime/series in Firebase using TMDB ID. Auto-fetches poster, backdrop, title, year, overview, genres. Default audio language = Hindi (Official). After creation, the admin can add episodes via add_episode or bulk_add_episodes.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies"] },
          tmdbId: { type: "string", description: "TMDB ID (movie or tv)" },
          mediaType: { type: "string", enum: ["tv", "movie"] },
          customId: { type: "string", description: "Optional custom Firebase ID. If omitted, uses tmdb_<id>." },
        },
        required: ["collection", "tmdbId", "mediaType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_add_episodes",
      description: "Save MULTIPLE episodes at once to a single season. Also TRIMS the season — only the provided episode numbers are kept; all other episodes are deleted. Use this when admin clicks 'Done' after queuing episodes via the AI chat builder.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies", "animesalt"] },
          seriesId: { type: "string" },
          seasonNumber: { type: "number" },
          trim: { type: "boolean", description: "If true, delete episodes not in this list (default true)" },
          episodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                episodeNumber: { type: "number" },
                title: { type: "string" },
                link: { type: "string" },
                link480: { type: "string" },
                link720: { type: "string" },
                link1080: { type: "string" },
                link4k: { type: "string" },
                audioLanguage: { type: "string", description: "e.g. Hindi, English, Japanese" },
                audioTrack: { type: "string", description: "official/dual/sub" },
              },
              required: ["episodeNumber"],
            },
          },
        },
        required: ["collection", "seriesId", "seasonNumber", "episodes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_and_telegram",
      description: "Single chained action: send FCM push notification AND post to Telegram channel for a series episode. Use when admin says 'send notify and telegram' or 'post everywhere'.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", enum: ["webseries", "movies", "animesalt"] },
          seriesId: { type: "string" },
          seasonNumber: { type: "number" },
          episodeNumber: { type: "number" },
          customMessage: { type: "string", description: "Optional override message" },
        },
        required: ["collection", "seriesId"],
      },
    },
  },
];

// ---------------- Plan executor ----------------
// Resolve a seriesId — accepts an actual Firebase key OR a (partial) title.
// Returns the real Firebase key, or null if nothing matches.
async function resolveSeriesId(
  collection: string,
  rawId: string,
): Promise<{ id: string | null; candidates: { id: string; title: string }[] }> {
  if (!rawId) return { id: null, candidates: [] };
  // 1) Direct hit
  const direct = await fbGet(`${collection}/${rawId}`);
  if (direct) return { id: rawId, candidates: [] };
  // 2) Search whole collection
  const all: any = await fbGet(collection);
  if (!all || typeof all !== "object") return { id: null, candidates: [] };
  const needle = rawId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const list = Object.entries(all).map(([id, v]: [string, any]) => ({
    id,
    title: String(v?.title || v?.name || ""),
    norm: String(v?.title || v?.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  }));
  // exact title
  const exact = list.find((x) => x.norm === needle);
  if (exact) return { id: exact.id, candidates: [] };
  // contains
  const matches = list.filter((x) => x.norm && (x.norm.includes(needle) || needle.includes(x.norm)));
  if (matches.length === 1) return { id: matches[0].id, candidates: [] };
  if (matches.length > 1)
    return { id: null, candidates: matches.slice(0, 5).map((m) => ({ id: m.id, title: m.title })) };
  return { id: null, candidates: [] };
}

async function executeOperation(op: any) {
  const { name, args } = op;
  switch (name) {
    case "add_episode": {
      const { collection, seriesId, seasonNumber, episodeNumber, title, link, link480, link720, link1080, link4k } = args;
      const ep: Record<string, any> = { episodeNumber, title: title || `Episode ${episodeNumber}` };
      if (link) ep.link = link;
      if (link480) ep.link480 = link480;
      if (link720) ep.link720 = link720;
      if (link1080) ep.link1080 = link1080;
      if (link4k) ep.link4k = link4k;
      // Episodes stored as array under seasons/<idx>/episodes
      const seasonsPath = `${collection}/${seriesId}/seasons`;
      const seasons = (await fbGet(seasonsPath)) || [];
      const sIdx = Array.isArray(seasons)
        ? seasons.findIndex((s: any) => s?.seasonNumber === seasonNumber)
        : Object.values(seasons).findIndex((s: any) => s?.seasonNumber === seasonNumber);
      if (sIdx < 0) throw new Error(`Season ${seasonNumber} not found in ${seriesId}`);
      const epPath = `${seasonsPath}/${sIdx}/episodes`;
      const eps = (await fbGet(epPath)) || [];
      const epList = Array.isArray(eps) ? eps : Object.values(eps);
      const existing = epList.findIndex((e: any) => e?.episodeNumber === episodeNumber);
      if (existing >= 0) epList[existing] = { ...epList[existing], ...ep };
      else epList.push(ep);
      await fbPut(epPath, epList);
      return { ok: true, message: `Episode ${episodeNumber} added to ${seriesId} S${seasonNumber}` };
    }
    case "edit_series":
      await fbPatch(`${args.collection}/${args.seriesId}`, args.patch);
      return { ok: true, message: `${args.seriesId} updated` };
    case "delete_item":
      await fbDelete(args.path);
      return { ok: true, message: `Deleted ${args.path}` };
    case "send_notification": {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-fcm`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({
          title: args.title,
          body: args.body,
          link: args.link,
          imageUrl: args.imageUrl,
          target: "all",
        }),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, message: r.ok ? "Notification sent" : `FCM error: ${JSON.stringify(j)}` };
    }
    case "send_telegram": {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-post`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify(args),
      });
      return { ok: r.ok, message: r.ok ? "Telegram posted" : `TG error ${r.status}` };
    }
    case "release_weekly": {
      const e: any = await fbGet(`weeklyPending/${args.seriesId}`);
      if (!e) throw new Error("Weekly entry not found");
      const now = Date.now();
      await fbPatch(`weeklyPending/${args.seriesId}`, {
        lastReleasedAt: now,
        releasedSavedAt: now,
        nextReleaseAt: now + (e.weeklyEveryDays || 7) * 86400000,
      });
      return { ok: true, message: "Weekly cycle reset; badge clears in 5 min" };
    }
    case "check_link": {
      try {
        const r = await fetch(args.url, { method: "HEAD" });
        return { ok: true, message: `Status ${r.status}`, alive: r.ok };
      } catch (e) {
        return { ok: false, message: `Dead: ${(e as Error).message}`, alive: false };
      }
    }
    case "approve_subscription": {
      const p: any = await fbGet(`bkashPayments/${args.paymentId}`);
      if (!p) throw new Error("Payment not found");
      const days = args.days || 30;
      const now = Date.now();
      const expiresAt = now + days * 86400000;
      await fbPatch(`bkashPayments/${args.paymentId}`, { status: "approved", approvedAt: now });
      if (p.uid) await fbPatch(`users/${p.uid}/subscription`, { active: true, expiresAt, plan: p.plan || "monthly" });
      return { ok: true, message: `Approved ${args.paymentId} for ${days}d` };
    }
    case "set_firebase_path": {
      if (args.mode === "put") await fbPut(args.path, args.data);
      else await fbPatch(args.path, args.data);
      return { ok: true, message: `Wrote ${args.path}` };
    }
    case "create_anime_from_tmdb": {
      const TMDB_KEY = Deno.env.get("TMDB_API_KEY") || "8265bd1679663a7ea12ac168da84d2e8";
      const { collection, tmdbId, mediaType, customId } = args;
      const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`;
      const r = await fetch(tmdbUrl);
      if (!r.ok) throw new Error(`TMDB fetch failed: ${r.status}`);
      const t = await r.json();
      const id = customId || `tmdb_${tmdbId}`;
      const title = t.title || t.name || "Untitled";
      const seasons: any[] = [];
      // For TV: pre-create season skeletons (admin will add episodes via add_episode)
      if (mediaType === "tv" && Array.isArray(t.seasons)) {
        t.seasons
          .filter((s: any) => s.season_number > 0)
          .forEach((s: any) => {
            seasons.push({
              seasonNumber: s.season_number,
              name: s.name || `Season ${s.season_number}`,
              episodes: [],
            });
          });
      }
      const series = {
        id,
        title,
        poster: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : "",
        backdrop: t.backdrop_path ? `https://image.tmdb.org/t/p/original${t.backdrop_path}` : "",
        year: String((t.release_date || t.first_air_date || "").slice(0, 4)),
        rating: String(t.vote_average?.toFixed(1) || ""),
        language: "Hindi",
        dubType: "official",
        category: t.genres?.[0]?.name || "Anime",
        type: mediaType === "tv" ? "webseries" : "movie",
        storyline: t.overview || "",
        tmdbId: String(tmdbId),
        seasons: seasons.length > 0 ? seasons : undefined,
        createdAt: Date.now(),
        source: "firebase",
      };
      await fbPut(`${collection}/${id}`, series);
      return { ok: true, message: `Created ${title} (${id}) — Hindi Official, ${seasons.length} season skeleton${seasons.length !== 1 ? "s" : ""}` };
    }
    case "bulk_add_episodes": {
      const { collection, seriesId, seasonNumber, episodes, trim = true } = args;
      const seasonsPath = `${collection}/${seriesId}/seasons`;
      const seasons = (await fbGet(seasonsPath)) || [];
      const seasonsArr = Array.isArray(seasons) ? seasons : Object.values(seasons);
      const sIdx = seasonsArr.findIndex((s: any) => s?.seasonNumber === seasonNumber);
      if (sIdx < 0) throw new Error(`Season ${seasonNumber} not found in ${seriesId}`);
      const newEps = episodes
        .map((e: any) => {
          const out: Record<string, any> = {
            episodeNumber: e.episodeNumber,
            title: e.title || `Episode ${e.episodeNumber}`,
          };
          if (e.link) out.link = e.link;
          if (e.link480) out.link480 = e.link480;
          if (e.link720) out.link720 = e.link720;
          if (e.link1080) out.link1080 = e.link1080;
          if (e.link4k) out.link4k = e.link4k;
          if (e.audioLanguage) out.audioLanguage = e.audioLanguage;
          if (e.audioTrack) out.audioTrack = e.audioTrack;
          return out;
        })
        .sort((a: any, b: any) => a.episodeNumber - b.episodeNumber);
      const finalEps = trim
        ? newEps
        : (() => {
            const existing = seasonsArr[sIdx]?.episodes || [];
            const existingArr = Array.isArray(existing) ? existing : Object.values(existing);
            const map = new Map<number, any>();
            existingArr.forEach((e: any) => e?.episodeNumber && map.set(e.episodeNumber, e));
            newEps.forEach((e: any) => map.set(e.episodeNumber, { ...map.get(e.episodeNumber), ...e }));
            return [...map.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
          })();
      await fbPut(`${seasonsPath}/${sIdx}/episodes`, finalEps);
      return {
        ok: true,
        message: `${finalEps.length} episode${finalEps.length > 1 ? "s" : ""} saved to ${seriesId} S${seasonNumber}${trim ? " (others removed)" : ""}`,
      };
    }
    case "notify_and_telegram": {
      const { collection, seriesId, seasonNumber, episodeNumber, customMessage } = args;
      const series: any = await fbGet(`${collection}/${seriesId}`);
      if (!series) throw new Error(`Series ${seriesId} not found`);
      const title = series.title || series.name || seriesId;
      const epLabel = seasonNumber && episodeNumber ? ` — S${seasonNumber} EP${episodeNumber}` : "";
      const msg = customMessage || `🆕 New episode: ${title}${epLabel}`;
      // 1) FCM
      const fcmUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-fcm`;
      const fcmRes = await fetch(fcmUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({
          title: `${title}${epLabel}`,
          body: msg,
          image: series.poster || series.backdrop,
          data: { url: `${series.id ? `?anime=${series.id}` : ""}`, animeId: seriesId },
        }),
      });
      const fcmJson = await fcmRes.json().catch(() => ({}));
      // 2) Telegram
      const tgUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-post`;
      const tgRes = await fetch(tgUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({ collection, seriesId, message: msg, seasonNumber, episodeNumber }),
      });
      return {
        ok: fcmRes.ok || tgRes.ok,
        message: `📲 FCM: ${fcmJson.success ?? "?"}/${fcmJson.totalTokens ?? "?"} sent · 📢 Telegram: ${tgRes.ok ? "✓" : "✗"}`,
      };
    }
    default:
      throw new Error(`Unknown operation: ${name}`);
  }
}

// ---------------- Main handler ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { mode, messages, operations } = body;

    // ---- EXECUTE: admin clicked "Allow" ----
    if (mode === "execute" && Array.isArray(operations)) {
      const results = [];
      for (const op of operations) {
        try {
          const r = await executeOperation(op);
          results.push({ op: op.name, ...r });
        } catch (e) {
          results.push({ op: op.name, ok: false, message: (e as Error).message });
        }
      }
      snapshotCache = null; // invalidate
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- PLAN: send chat to AI, get back natural reply + proposed operations ----
    const knowledge = await getKnowledge();
    const systemPrompt = `You are the **Admin AI Manager** for an anime streaming platform (RS Anime). The admin chats with you to manage the ENTIRE admin panel.

LANGUAGE: Default reply in **Bangla (Bengali)**. Only switch to English if the admin explicitly says "in English" or writes purely in English. Use respectful, friendly tone with light emoji.

Your knowledge of the database (live snapshot, refreshed every 60s):
${JSON.stringify(knowledge, null, 2).slice(0, 12000)}

CAPABILITIES — you can call these tools:
- create_anime_from_tmdb(collection, tmdbId, mediaType, customId?) — Create NEW series/movie from TMDB. Default audio=Hindi Official.
- add_episode(collection, seriesId, seasonNumber, episodeNumber, title?, link480?, link720?, link1080?, link4k?, link?) — single episode
- bulk_add_episodes(collection, seriesId, seasonNumber, episodes[], trim=true) — multi-episode save in ONE go. **trim=true means episodes NOT in the array are DELETED** — use this when admin gives only a few episode links but TMDB has many.
- notify_and_telegram(collection, seriesId, seasonNumber?, episodeNumber?) — send FCM push + Telegram post in ONE chained action.
- edit_series(collection, seriesId, patch{})
- delete_item(path) — DESTRUCTIVE
- send_notification, send_telegram, release_weekly, check_link, approve_subscription, set_firebase_path

RULES:
1. Default to **Bangla** unless told otherwise.
2. When admin says "add anime X" / "create new anime X" — first try to find it by title in the knowledge. If NOT found, ask for TMDB ID, then call create_anime_from_tmdb. After creation, if the admin gave episode links, call bulk_add_episodes (trim=true) so empty TMDB episodes get cleaned up.
3. **Trim logic** — if admin says "EP1 = link1, EP2 = link2" but the season has 12 episodes from TMDB, ALWAYS use bulk_add_episodes with trim=true so only those 2 stay.
4. Treat link with no quality tag as **1080p** by default. Treat audio as **Hindi Official** by default.
5. **Free-text parsing** — when the admin writes "Naruto S1 EP5 720p https://… 1080p https://…", find the matching seriesId, identify qualities, call add_episode (or bulk_add_episodes if multiple).
6. **Auto-chain** — if admin says "save AND send notify AND telegram" or "post everywhere" — propose bulk_add_episodes FOLLOWED BY notify_and_telegram in the SAME plan.
7. NEVER execute yourself. Just propose tool calls — admin will see preview & click Allow/Disallow.
8. If matching is ambiguous, list top 3 candidates with TITLES (never raw IDs).
9. Always describe in Bangla what you understood: "নারুতো S1 — ২টি episode add করব (S1 EP1 + EP2), বাকি ১০টি delete হবে (trim), তারপর FCM + Telegram পাঠাব।"
10. You can also be a normal chat assistant — if the admin just says "hi" or asks how many series, reply naturally without tool calls.

When you have nothing to do, just chat / give status updates.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        tool_choice: "auto",
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429)
        return new Response(JSON.stringify({ error: "Rate limit — try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (aiResp.status === 402)
        return new Response(JSON.stringify({ error: "AI credits exhausted — top up at Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      return new Response(JSON.stringify({ error: `AI error: ${t.slice(0, 300)}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const choice = data.choices?.[0]?.message;
    const reply = choice?.content || "";
    const toolCalls = choice?.tool_calls || [];
    const proposedOps = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const name = tc.function?.name;
        let args: Record<string, any> = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
        const preview: Record<string, any> = {};
        const collection = args.collection || (typeof args.path === "string" ? args.path.split("/")[0] : undefined);
        const seriesId = args.seriesId || (typeof args.path === "string" ? args.path.split("/")[1] : undefined);
        if (collection && seriesId) {
          try {
            const v: any = await fbGet(`${collection}/${seriesId}`);
            if (v) {
              preview.title = v.title || v.name || seriesId;
              preview.poster = v.poster || v.backdrop || "";
              preview.year = v.year;
              preview.category = v.category;
              preview.collection = collection;
              preview.seriesId = seriesId;
            }
          } catch {}
        }
        if (args.paymentId) {
          try {
            const p: any = await fbGet(`bkashPayments/${args.paymentId}`);
            if (p) {
              preview.title = `bKash payment ৳${p.amount || "?"}`;
              preview.subtitle = `${p.senderNumber || p.phone || "Unknown"} · ${p.plan || "?"}`;
            }
          } catch {}
        }
        return { name, args, preview };
      }),
    );
    return new Response(JSON.stringify({ reply, operations: proposedOps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-ai error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
