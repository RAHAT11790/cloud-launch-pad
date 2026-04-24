// weekly-auto-detect — scans Firebase webseries and auto-flags series whose
// last episode was added 7+ days ago (or matches their custom cycle) by
// inserting/updating a /weeklyPending entry in Firebase RTDB. The Weekly EP
// admin panel + Notification bell already render these automatically.
//
// Run on a daily cron (see SQL migration / pg_cron note in chat).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIREBASE_DB_URL =
  Deno.env.get("FIREBASE_DATABASE_URL") ||
  "https://rs-anime-default-rtdb.firebaseio.com";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CYCLE_DAYS = 7;

async function fbGet(path: string) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
  if (!r.ok) return null;
  return await r.json();
}

async function fbPut(path: string, data: unknown) {
  const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.ok;
}

/** Find the latest createdAt/updatedAt timestamp of any episode inside a series. */
function getLastEpisodeTimestamp(series: any): number {
  const seasons = series?.seasons;
  if (!seasons) return 0;
  const seasonsArr = Array.isArray(seasons) ? seasons : Object.values(seasons);
  let max = 0;
  for (const s of seasonsArr) {
    const eps = (s as any)?.episodes;
    if (!eps) continue;
    const epsArr = Array.isArray(eps) ? eps : Object.values(eps);
    for (const ep of epsArr) {
      const t = Number((ep as any)?.updatedAt || (ep as any)?.createdAt || 0);
      if (t > max) max = t;
    }
  }
  // Fallback: series-level updatedAt
  if (max === 0) max = Number(series?.updatedAt || series?.createdAt || 0);
  return max;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const [webseries, animesalt, weeklyPending] = await Promise.all([
      fbGet("webseries"),
      fbGet("animesaltSelected"),
      fbGet("weeklyPending"),
    ]);

    const existing: Record<string, any> = weeklyPending || {};
    const now = Date.now();
    const summary: any[] = [];
    let added = 0;
    let updated = 0;

    const processCollection = async (
      collection: string,
      data: Record<string, any> | null,
    ) => {
      if (!data) return;
      for (const [id, raw] of Object.entries(data)) {
        const series: any = raw;
        // Only auto-track series that are public webseries (movies don't get weekly cycles)
        if (series?.type === "movie") continue;
        if (series?.visibility === "private") continue;

        const lastTs = getLastEpisodeTimestamp(series);
        if (!lastTs) continue;

        const cycleDays = Math.max(
          1,
          Number(series?.weeklyEveryDays) || DEFAULT_CYCLE_DAYS,
        );
        const ageDays = Math.floor((now - lastTs) / ONE_DAY_MS);
        const isOverdue = ageDays >= cycleDays;
        if (!isOverdue) continue;

        const entry = existing[id];
        // Skip if already pending (admin already notified)
        if (entry?.releasedSavedAt) continue;
        if (entry && entry.nextReleaseAt <= now) continue;

        const lastReleasedAt = lastTs;
        const nextReleaseAt = lastReleasedAt + cycleDays * ONE_DAY_MS;
        const newEntry = {
          seriesId: id,
          seriesTitle: series?.title || series?.name || id,
          poster: series?.poster || series?.backdrop || "",
          weeklyEveryDays: cycleDays,
          missingDays: ageDays,
          lastReleasedAt,
          nextReleaseAt,
          createdAt: entry?.createdAt || now,
          autoDetected: true,
          collection,
        };
        const ok = await fbPut(`weeklyPending/${id}`, newEntry);
        if (ok) {
          if (entry) updated++;
          else added++;
          summary.push({
            id,
            title: newEntry.seriesTitle,
            ageDays,
            cycleDays,
            collection,
          });
        }
      }
    };

    await processCollection("webseries", webseries);
    await processCollection("animesalt", animesalt);

    return new Response(
      JSON.stringify({
        ok: true,
        added,
        updated,
        scanned:
          (webseries ? Object.keys(webseries).length : 0) +
          (animesalt ? Object.keys(animesalt).length : 0),
        flaggedSeries: summary.slice(0, 50),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("weekly-auto-detect error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
