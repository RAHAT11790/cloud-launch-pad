// Resolve AN playback live from the AnimeSalt API and convert the response into
// the same Episode/AudioTrack shape the existing `buildAnimeSaltEpisodePlaybackFromFirebase`
// helper consumes. Lets us reuse the full VideoPlayer pipeline without storing
// any short-lived CDN URLs in Firebase.
import { animeSaltApi } from "@/lib/animeSaltApi";
import type { AnimeItem, AudioTrack, Episode, Season } from "@/data/animeData";

type ApiStream = { url: string; height?: number | string; label?: string };
type ApiAudio = { language?: string; name?: string; uri?: string };

const isHindi = (a: ApiAudio) =>
  /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${a?.language || ""} ${a?.name || ""}`);

const toAudioTrack = (a: ApiAudio, idx: number): AudioTrack => {
  const label = String(a?.name || a?.language || `Audio ${idx + 1}`).trim();
  const language = String(a?.language || label).trim();
  const uri = String(a?.uri || "").trim();
  return {
    language,
    label,
    link: uri,
    audioUrl: uri,
    rawAudioUrl: uri,
    isDefault: isHindi(a),
  };
};

const streamFields = (streams: ApiStream[]) => {
  const find = (h: number) => streams.find((s) => Number(s.height) === h)?.url;
  const link1080 = find(1080);
  const link720 = find(720);
  const link480 = find(480);
  const link4k = find(2160);
  return {
    link480,
    link720,
    link1080,
    link4k,
    link: link1080 || link720 || link480 || streams[0]?.url || "",
  };
};

const pickPayload = (r: any) => r?.data || r;

export async function resolveAnEpisodePlayback(slug: string): Promise<Partial<Episode> | null> {
  if (!slug) return null;
  try {
    const r: any = await animeSaltApi.getEpisode(slug);
    const data = pickPayload(r);
    const streams = (data?.streams || []) as ApiStream[];
    if (!streams.length) return null;
    const audio = ((data?.audio || []) as ApiAudio[]).map(toAudioTrack);
    return { ...streamFields(streams), audioTracks: audio };
  } catch {
    return null;
  }
}

export async function resolveAnMoviePlayback(
  slug: string,
): Promise<{ fields: Partial<AnimeItem>; audioTracks: AudioTrack[] } | null> {
  if (!slug) return null;
  try {
    const r: any = await animeSaltApi.getMovie(slug);
    const data = pickPayload(r);
    const streams = (data?.streams || []) as ApiStream[];
    if (!streams.length) return null;
    const audioTracks = ((data?.audio || []) as ApiAudio[]).map(toAudioTrack);
    const sf = streamFields(streams);
    return {
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
  } catch {
    return null;
  }
}

export async function resolveAnSeriesSeasons(slug: string): Promise<Season[]> {
  if (!slug) return [];
  try {
    const r: any = await animeSaltApi.getSeries(slug);
    const data = pickPayload(r);
    const seasons = (data?.seasons || []) as any[];
    return seasons.map((s, sIdx) => ({
      name: s?.name || `Season ${sIdx + 1}`,
      episodes: (s?.episodes || []).map((e: any, eIdx: number) => ({
        episodeNumber: Number(e?.number || eIdx + 1),
        title: String(e?.title || `Episode ${e?.number || eIdx + 1}`),
        // Slug stored as a sentinel URI; resolved lazily by resolveAnEpisodePlayback.
        link: e?.slug ? `animesalt://${e.slug}` : "",
      })),
    })).filter((s: Season) => s.episodes.length > 0);
  } catch {
    return [];
  }
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
