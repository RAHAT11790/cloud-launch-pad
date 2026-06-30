// Resolve AN playback from short-lived Firebase + localStorage cache first,
// then refresh through the fetch API only when the signed links expire.
import { animeSaltApi } from "@/lib/animeSaltApi";
import type { AnimeItem, AudioTrack, Episode, Season } from "@/data/animeData";
import { db, ref, get, set, remove } from "@/lib/firebase";

type ApiStream = { url: string; height?: number | string; label?: string; resolution?: string; filename?: string; bandwidth?: number };
type ApiAudio = { language?: string; name?: string; uri?: string; url?: string; link?: string };
type ApiSource = { streams?: ApiStream[]; audio?: ApiAudio[]; master?: string; videoSource?: string; securedLink?: string };

const PLAYBACK_TTL_MS = 150 * 60 * 1000; // safer than AnimeSalt's ~2-3h signed URL window
const SERIES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_THROTTLE_MS = 15 * 60 * 1000;
const mem = new Map<string, { expiresAt: number; data: any }>();
let lastPrune = 0;

const safeKey = (value: string) => String(value || "").replace(/[.#$/\[\]]/g, "_").slice(0, 180);
const localKey = (kind: string, slug: string) => `rs_an_playback:${kind}:${safeKey(slug)}`;
const fbPath = (kind: string, slug: string) => `anPlaybackCache/${kind}/${safeKey(slug)}`;

export async function pruneExpiredPlaybackCache() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_THROTTLE_MS) return;
  lastPrune = now;
  try {
    for (const [key, hit] of Array.from(mem.entries())) if (!hit?.expiresAt || hit.expiresAt <= now) mem.delete(key);
    const snap = await get(ref(db, "anPlaybackCache"));
    const tree = snap.val() || {};
    const jobs: Promise<unknown>[] = [];
    for (const kind of ["episode", "movie", "series"] as const) {
      const bucket = tree?.[kind] || {};
      Object.entries(bucket).forEach(([slugKey, row]: [string, any]) => {
        if (!row?.expiresAt || row.expiresAt <= now) jobs.push(remove(ref(db, `anPlaybackCache/${kind}/${slugKey}`)).catch(() => null));
      });
    }
    await Promise.all(jobs);
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
  try {
    const snap = await get(ref(db, fbPath(kind, slug)));
    const row = snap.val();
    if (row?.expiresAt > now && row?.data) {
      mem.set(key, { expiresAt: row.expiresAt, data: row.data });
      try { localStorage.setItem(localKey(kind, slug), JSON.stringify({ expiresAt: row.expiresAt, data: row.data })); } catch {}
      return row.data as T;
    }
    if (row) await remove(ref(db, fbPath(kind, slug))).catch(() => {});
  } catch {}
  return null;
}

async function writePlaybackCache(kind: "episode" | "movie" | "series", slug: string, data: any, ttl = PLAYBACK_TTL_MS) {
  void pruneExpiredPlaybackCache();
  const expiresAt = Date.now() + ttl;
  const key = `${kind}:${slug}`;
  mem.set(key, { expiresAt, data });
  try { localStorage.setItem(localKey(kind, slug), JSON.stringify({ expiresAt, data })); } catch {}
  try { await set(ref(db, fbPath(kind, slug)), { slug, kind, savedAt: Date.now(), expiresAt, data }); } catch {}
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
  const find = (h: number) => streams.find((s) => streamHeight(s) === h)?.url;
  const link1080 = find(1080);
  const link720 = find(720);
  const link480 = find(480);
  const link4k = find(2160);
  return {
    link480,
    link720,
    link1080,
    link4k,
    link: link1080 || link720 || link480 || streams.find((s) => streamHeight(s) > 0)?.url || streams[0]?.url || "",
  };
};

const pickPayload = (r: any) => r?.data || r;

export async function resolveAnEpisodePlayback(slug: string): Promise<Partial<Episode> | null> {
  if (!slug) return null;
  try {
    const cached = await readPlaybackCache<Partial<Episode>>("episode", slug);
    if (cached?.link) return cached;
    const r: any = await animeSaltApi.getEpisode(slug);
    const data = pickPayload(r);
    const streams = collectPlaybackStreams(data);
    if (!streams.length) return null;
    const audio = collectPlaybackAudio(data).map(toAudioTrack);
    const resolved = { ...streamFields(streams), audioTracks: audio };
    await writePlaybackCache("episode", slug, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function resolveAnMoviePlayback(
  slug: string,
): Promise<{ fields: Partial<AnimeItem>; audioTracks: AudioTrack[] } | null> {
  if (!slug) return null;
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

export function warmAnSeriesPlaybackCache(_seriesSlug: string, seasons: Season[]) {
  const slugs = seasons.flatMap((s) => s.episodes || []).map((ep) => slugFromSentinel(ep.link)).filter((slug): slug is string => Boolean(slug));
  const unique = Array.from(new Set(slugs));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, unique.length) }, async () => {
    while (cursor < unique.length) {
      const next = unique[cursor++];
      await resolveAnEpisodePlayback(next).catch(() => null);
    }
  });
  Promise.all(workers).catch(() => {});
}

export const isAnimeSaltSentinel = (link?: string | null) =>
  !!link && String(link).startsWith("animesalt://");

export const slugFromSentinel = (link?: string | null) =>
  String(link || "").replace(/^animesalt:\/\//, "");

/** Resolve playback for a single episode in-place inside a Seasons array.
 *  Returns the (possibly enriched) Episode. */
export async function enrichEpisodeInPlace(
  seasons: Season[],
  sIdx: number,
  eIdx: number,
): Promise<Episode | null> {
  const ep = seasons?.[sIdx]?.episodes?.[eIdx];
  if (!ep) return null;
  if (!isAnimeSaltSentinel(ep.link)) return ep;
  const resolved = await resolveAnEpisodePlayback(slugFromSentinel(ep.link));
  if (!resolved) return null;
  Object.assign(ep, resolved);
  return ep;
}
