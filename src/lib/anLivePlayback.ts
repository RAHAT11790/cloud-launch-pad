// Resolve AN playback from short-lived memory/localStorage cache first,
// then refresh through the fetch API only when the signed links expire.
import { animeSaltApi } from "@/lib/animeSaltApi";
import type { AnimeItem, AudioTrack, Episode, Season } from "@/data/animeData";
import { refreshAnPlaybackRoute } from "@/lib/anPlaybackProxy";

type ApiStream = { url: string; height?: number | string; label?: string; resolution?: string; filename?: string; bandwidth?: number; codecs?: string };
type ApiAudio = { language?: string; name?: string; uri?: string; url?: string; link?: string };
type ApiSource = { streams?: ApiStream[]; audio?: ApiAudio[]; master?: string; videoSource?: string; securedLink?: string };

const PLAYBACK_TTL_MS = 150 * 60 * 1000; // safer than AnimeSalt's ~2-3h signed URL window
const SERIES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_THROTTLE_MS = 15 * 60 * 1000;
const mem = new Map<string, { expiresAt: number; data: any }>();
let lastPrune = 0;

const safeKey = (value: string) => String(value || "").replace(/[.#$/\[\]]/g, "_").slice(0, 180);
const localKey = (kind: string, slug: string) => `rs_an_playback_v9_codecs:${kind}:${safeKey(slug)}`;
// Playback URLs are short-lived and sensitive. Keep them client-local only;
// never mirror raw media URLs through the realtime database/network payload.

export async function pruneExpiredPlaybackCache() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_THROTTLE_MS) return;
  lastPrune = now;
  try {
    for (const [key, hit] of Array.from(mem.entries())) if (!hit?.expiresAt || hit.expiresAt <= now) mem.delete(key);
  } catch {}
}

async function readPlaybackCache<T>(kind: "episode" | "movie" | "series", slug: string): Promise<T | null> {
  const key = `${kind}:${slug}`;
  const now = Date.now();
  void pruneExpiredPlaybackCache();
  const hit = mem.get(key);
  if (hit && hit.expiresAt > now) return hit.data as T;
  try {
    const raw = localStorage.getItem(localKey(kind, slug));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.expiresAt > now && parsed?.data) {
        mem.set(key, { expiresAt: parsed.expiresAt, data: parsed.data });
        return parsed.data as T;
      }
      localStorage.removeItem(localKey(kind, slug));
    }
  } catch {}
  return null;
}

async function writePlaybackCache(kind: "episode" | "movie" | "series", slug: string, data: any, ttl = PLAYBACK_TTL_MS) {
  void pruneExpiredPlaybackCache();
  const expiresAt = Date.now() + ttl;
  const key = `${kind}:${slug}`;
  mem.set(key, { expiresAt, data });
  try { localStorage.setItem(localKey(kind, slug), JSON.stringify({ expiresAt, data })); } catch {}
}

const isHindi = (a: ApiAudio) =>
  /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${a?.language || ""} ${a?.name || ""}`);

const toAudioTrack = (a: ApiAudio, idx: number): AudioTrack => {
  const label = String(a?.name || a?.language || `Audio ${idx + 1}`).trim();
  const language = String(a?.language || label).trim();
  const uri = String(a?.uri || a?.url || a?.link || "").trim();
  return {
    language,
    label,
    link: uri,
    audioUrl: uri,
    rawAudioUrl: uri,
    isDefault: isHindi(a),
  };
};

const streamHeight = (s: ApiStream) => {
  const raw = `${s?.height ?? ""} ${s?.label || ""} ${s?.resolution || ""} ${s?.filename || ""} ${s?.url || ""}`;
  const direct = Number(s?.height);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const m = raw.match(/(?:^|[^0-9])(2160|1080|720|480|360|240)p?(?:[^0-9]|$)/i) || raw.match(/x(2160|1080|720|480|360|240)(?:[^0-9]|$)/i);
  return m ? Number(m[1]) : 0;
};

const collectPlaybackStreams = (data: any): ApiStream[] => {
  const list: ApiStream[] = [];
  const seen = new Set<string>();
  const push = (stream: any, fallbackLabel = "Auto") => {
    const url = String(stream?.url || stream?.src || stream || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    list.push({
      url,
      height: stream?.height,
      label: stream?.label || stream?.quality || fallbackLabel,
      resolution: stream?.resolution,
      filename: stream?.filename,
      bandwidth: stream?.bandwidth,
      codecs: stream?.codecs,
    });
  };

  if (Array.isArray(data?.streams)) data.streams.forEach((s: any) => push(s));
  if (Array.isArray(data?.sources)) {
    (data.sources as ApiSource[]).forEach((source: any) => {
      if (Array.isArray(source?.streams)) source.streams.forEach((s: any) => push(s));
      push(source?.master, "Auto");
      push(source?.videoSource, "Auto");
      push(source?.securedLink, "Auto");
    });
  }
  push(data?.directUrl, "Auto");
  push(data?.videoSource, "Auto");
  push(data?.securedLink, "Auto");
  return list;
};

const collectPlaybackAudio = (data: any): ApiAudio[] => {
  const list: ApiAudio[] = [];
  const seen = new Set<string>();
  const push = (a: any) => {
    const uri = String(a?.uri || a?.url || a?.link || "").trim();
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    list.push(a);
  };
  if (Array.isArray(data?.audio)) data.audio.forEach(push);
  if (Array.isArray(data?.sources)) (data.sources as ApiSource[]).forEach((source: any) => Array.isArray(source?.audio) && source.audio.forEach(push));
  return list;
};

const streamFields = (streams: ApiStream[]) => {
  const find = (h: number) => streams.find((s) => streamHeight(s) === h);
  const s1080 = find(1080);
  const s720 = find(720);
  const s480 = find(480);
  const s4k = find(2160);
  const primary = s1080 || s720 || s480 || streams.find((s) => streamHeight(s) > 0) || streams[0];
  return {
    link480: s480?.url,
    link720: s720?.url,
    link1080: s1080?.url,
    link4k: s4k?.url,
    link: primary?.url || "",
    anStreamMeta: streams.map((s) => ({
      url: s.url,
      height: streamHeight(s),
      label: s.label,
      resolution: s.resolution,
      bandwidth: s.bandwidth,
      codecs: s.codecs,
    })),
  };
};

const pickPayload = (r: any) => r?.data || r;

// ============================================================================
// SERIES BUNDLE CACHE
// ----------------------------------------------------------------------------
// One client-local bundle per series maps { episodeSlug -> playback }. On
// series open we load memory/localStorage, then background-fill any missing
// episodes with high concurrency. All later episode/season clicks become
// pure in-memory lookups — zero latency without leaking URLs through DB reads.
// ============================================================================

type EpisodePlayback = Partial<Episode>;
type SeriesBundle = { expiresAt: number; episodes: Record<string, EpisodePlayback> };
const BUNDLE_TTL_MS = 180 * 60 * 1000; // 3h — matches AnimeSalt signed-URL window
const bundleMem = new Map<string, SeriesBundle>();
const bundleLoadInflight = new Map<string, Promise<SeriesBundle>>();
const bundleLsKey = (slug: string) => `rs_an_bundle_v10_codecs:${safeKey(slug)}`;

const pendingBundleSaves = new Set<string>();
let bundleSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBundleSave(seriesSlug: string) {
  pendingBundleSaves.add(seriesSlug);
  if (bundleSaveTimer) return;
  bundleSaveTimer = setTimeout(async () => {
    bundleSaveTimer = null;
    const slugs = Array.from(pendingBundleSaves);
    pendingBundleSaves.clear();
    for (const slug of slugs) {
      const bundle = bundleMem.get(slug);
      if (!bundle) continue;
      try { localStorage.setItem(bundleLsKey(slug), JSON.stringify(bundle)); } catch {}
    }
  }, 1500);
}

function upsertBundleEpisode(seriesSlug: string, epSlug: string, payload: EpisodePlayback) {
  if (!seriesSlug || !epSlug || !payload?.link) return;
  const now = Date.now();
  const existing = bundleMem.get(seriesSlug);
  const bundle: SeriesBundle = existing && existing.expiresAt > now
    ? existing
    : { expiresAt: now + BUNDLE_TTL_MS, episodes: {} };
  bundle.episodes[epSlug] = payload;
  bundleMem.set(seriesSlug, bundle);
  scheduleBundleSave(seriesSlug);
}

export function getEpisodeFromBundle(seriesSlug: string, epSlug: string): EpisodePlayback | null {
  if (!seriesSlug || !epSlug) return null;
  const bundle = bundleMem.get(seriesSlug);
  if (!bundle || bundle.expiresAt <= Date.now()) return null;
  const ep = bundle.episodes[epSlug];
  return ep?.link ? ep : null;
}

/** Load a series bundle from mem → localStorage only. */
export async function loadAnSeriesBundle(seriesSlug: string): Promise<SeriesBundle> {
  const now = Date.now();
  if (!seriesSlug) return { expiresAt: now + BUNDLE_TTL_MS, episodes: {} };
  const hit = bundleMem.get(seriesSlug);
  if (hit && hit.expiresAt > now) return hit;
  const running = bundleLoadInflight.get(seriesSlug);
  if (running) return running;
  const task = (async () => {
    try {
      const raw = localStorage.getItem(bundleLsKey(seriesSlug));
      if (raw) {
        const parsed = JSON.parse(raw) as SeriesBundle;
        if (parsed?.expiresAt > now) { bundleMem.set(seriesSlug, parsed); return parsed; }
        localStorage.removeItem(bundleLsKey(seriesSlug));
      }
    } catch {}
    const empty: SeriesBundle = { expiresAt: now + BUNDLE_TTL_MS, episodes: {} };
    bundleMem.set(seriesSlug, empty);
    return empty;
  })().finally(() => { bundleLoadInflight.delete(seriesSlug); });
  bundleLoadInflight.set(seriesSlug, task);
  return task;
}

export async function resolveAnEpisodePlayback(
  slug: string,
  opts?: { seriesSlug?: string },
): Promise<EpisodePlayback | null> {
  if (!slug) return null;
  await refreshAnPlaybackRoute();
  const seriesSlug = opts?.seriesSlug || "";
  // 1) Series bundle — in-memory hit → zero latency.
  if (seriesSlug) {
    const fromBundle = getEpisodeFromBundle(seriesSlug, slug);
    if (fromBundle) return fromBundle;
  }
  try {
    // 2) Legacy per-episode cache (mem → LS → Firebase).
    const cached = await readPlaybackCache<EpisodePlayback>("episode", slug);
    if (cached?.link) {
      if (seriesSlug) upsertBundleEpisode(seriesSlug, slug, cached);
      return cached;
    }
    // 3) Live API fetch — last resort.
    const r: any = await animeSaltApi.getEpisode(slug);
    const data = pickPayload(r);
    const streams = collectPlaybackStreams(data);
    if (!streams.length) return null;
    const audio = collectPlaybackAudio(data).map(toAudioTrack);
    const resolved: EpisodePlayback = { ...streamFields(streams), audioTracks: audio };
    await writePlaybackCache("episode", slug, resolved);
    if (seriesSlug) upsertBundleEpisode(seriesSlug, slug, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function resolveAnMoviePlayback(
  slug: string,
): Promise<{ fields: Partial<AnimeItem>; audioTracks: AudioTrack[] } | null> {
  if (!slug) return null;
  await refreshAnPlaybackRoute();
  try {
    const cached = await readPlaybackCache<{ fields: Partial<AnimeItem>; audioTracks: AudioTrack[] }>("movie", slug);
    if (cached?.fields?.movieLink) return cached;
    const r: any = await animeSaltApi.getMovie(slug);
    const data = pickPayload(r);
    const streams = collectPlaybackStreams(data);
    if (!streams.length) return null;
    const audioTracks = collectPlaybackAudio(data).map(toAudioTrack);
    const sf = streamFields(streams);
    const resolved = {
      fields: {
        movieLink: sf.link,
        movieLink480: sf.link480,
        movieLink720: sf.link720,
        movieLink1080: sf.link1080,
        movieLink4k: sf.link4k,
        audioTracks,
      },
      audioTracks,
    };
    await writePlaybackCache("movie", slug, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function resolveAnSeriesSeasons(slug: string): Promise<Season[]> {
  if (!slug) return [];
  try {
    // Warm the series bundle in parallel so first-episode click is instant.
    void loadAnSeriesBundle(slug);
    const cached = await readPlaybackCache<Season[]>("series", slug);
    if (cached?.length) return cached;
    const r: any = await animeSaltApi.getSeries(slug);
    const data = pickPayload(r);
    const seasons = (data?.seasons || []) as any[];
    const resolved = seasons.map((s, sIdx) => ({
      name: s?.name || `Season ${sIdx + 1}`,
      episodes: (s?.episodes || []).map((e: any, eIdx: number) => ({
        episodeNumber: Number(e?.number || eIdx + 1),
        title: String(e?.title || `Episode ${e?.number || eIdx + 1}`),
        // Slug stored as a sentinel URI; resolved lazily by resolveAnEpisodePlayback.
        link: e?.slug ? `animesalt://${e.slug}` : "",
      })),
    })).filter((s: Season) => s.episodes.length > 0);
    if (resolved.length) await writePlaybackCache("series", slug, resolved, SERIES_TTL_MS);
    return resolved;
  } catch {
    return [];
  }
}

/** Fill the bundle with every episode of a series. Waits for bundle load, then
 *  parallel-fetches only the missing episodes. Non-blocking — fire and forget. */
export async function warmAnSeriesPlaybackCache(seriesSlug: string, seasons: Season[]) {
  if (!seriesSlug || !seasons?.length) return;
  await loadAnSeriesBundle(seriesSlug);
  const slugs = seasons
    .flatMap((s) => s.episodes || [])
    .filter((ep) => isAnimeSaltSentinel(ep.link))
    .map((ep) => slugFromSentinel(ep.link))
    .filter((slug): slug is string => Boolean(slug));
  const unique = Array.from(new Set(slugs));
  const missing = unique.filter((s) => !getEpisodeFromBundle(seriesSlug, s));
  if (!missing.length) return;
  // Keep background warm-up deliberately light. The previous 8-way burst ran
  // while the user had just opened the player, competing with HLS segment loads
  // and causing buffering / edge runtime disconnect noise in preview.
  const CONCURRENCY = 1;
  let cursor = 0;
  await new Promise((resolve) => setTimeout(resolve, 15000));
  const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
    while (cursor < missing.length) {
      const next = missing[cursor++];
      await resolveAnEpisodePlayback(next, { seriesSlug }).catch(() => null);
    }
  });
  await Promise.all(workers).catch(() => {});
}

export const isAnimeSaltSentinel = (link?: string | null) =>
  !!link && String(link).startsWith("animesalt://");

export const slugFromSentinel = (link?: string | null) =>
  isAnimeSaltSentinel(link) ? String(link || "").replace(/^animesalt:\/\//, "") : "";

/** Resolve playback for a single episode in-place inside a Seasons array. */
export async function enrichEpisodeInPlace(
  seasons: Season[],
  sIdx: number,
  eIdx: number,
  seriesSlug?: string,
): Promise<Episode | null> {
  const ep = seasons?.[sIdx]?.episodes?.[eIdx];
  if (!ep) return null;
  if (!isAnimeSaltSentinel(ep.link)) return ep;
  const resolved = await resolveAnEpisodePlayback(slugFromSentinel(ep.link), { seriesSlug });
  if (!resolved) return null;
  Object.assign(ep, resolved);
  return ep;
}
