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
];

// ---------------- Plan executor ----------------
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
- add_episode(collection, seriesId, seasonNumber, episodeNumber, title?, link480?, link720?, link1080?, link4k?, link?)
- edit_series(collection, seriesId, patch{})
- delete_item(path) — DESTRUCTIVE, use with care
- send_notification(title, body, link?, imageUrl?) — push to all users
- send_telegram(collection, seriesId, message?)
- release_weekly(seriesId)
- check_link(url)
- approve_subscription(paymentId, days?)
- set_firebase_path(path, data, mode?) — generic fallback

RULES:
1. Default to **Bangla** unless told otherwise.
2. Free-text parsing — when the admin writes "Naruto S1 EP5 720p https://… 1080p https://…", find the matching seriesId from the knowledge (match by title), identify qualities (480p/720p/1080p/4k), and call add_episode with the right links.
3. **Chain workflows automatically**: add_episode → check_link for every link → if all alive, send_notification + send_telegram. If any link is dead, WARN the admin and SKIP notify/telegram.
4. NEVER execute yourself. Just propose the tool calls — the admin will see a preview and click Allow/Disallow.
5. If the matching series is ambiguous, ask the admin to clarify (show the top 3 candidates with their titles, NEVER just IDs).
6. Always describe in Bangla what you understood: "নারুতো S1 EP5 add করব 720p + 1080p দিয়ে, তারপর users-কে notify করব।"
7. You can also be a normal chat assistant — if the admin just says "hi" or asks how many series, reply naturally without tool calls.

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
