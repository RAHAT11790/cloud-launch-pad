// ============================================================
// Embedded track probe (audio + subtitle list of an .mkv episode)
// ============================================================
// Runs in the background while the episode is ALREADY playing natively, so
// opening a video is never slowed down. One small range read (~256 KB) gives
// the full track list; results are cached in memory, localStorage and a shared
// realtime-database node so other viewers see the tracks instantly.

import { db, ref, set } from "@/lib/firebase";
import { firebaseRestUrl } from "@/lib/firebaseRest";
import { getEdgeFunctionUrl } from "@/lib/edgeFunctionRouter";
import { SUPABASE_URL } from "@/lib/siteConfig";
import { toOpaqueUrlToken, fromOpaqueUrlToken } from "@/lib/anPlaybackProxy";
import { buildTrackLabel, isPgsTrack, type MkvCue, type MkvHeader } from "./mkvDemux";
import { HttpRangeSource, openMkv, mseAvailable } from "./mkvEngine";
import { audioMime, videoMime } from "./mkvRemux";
import { isMp4Magic, readMp4Tracks } from "./mp4Probe";

export interface EmbeddedTrack {
  number: number;
  kind: "audio" | "subtitle";
  label: string;
  /** Original track title — internal only, never shown in the player. */
  rawName?: string;
  language: string;
  codec: string;
  isDefault: boolean;
  /** Can this browser play/render it through the engine? */
  playable: boolean;
  bitmap?: boolean;
  /** Forced / signs-only subtitle (only on-screen text, not the dialogue). */
  forced?: boolean;
  /** MSE mime of the audio track (audio only). */
  mime?: string;
}

export interface EmbeddedTrackList {
  audio: EmbeddedTrack[];
  subtitles: EmbeddedTrack[];
  /** Track the browser decodes natively before the engine takes over. */
  nativeAudio: number;
  videoMime?: string;
  /** Real container sniffed from the bytes (file names are often wrong). */
  container?: "mkv" | "mp4" | "none";
}

const LS_KEY = "rs_mkv_tracks_v3";
const LS_TTL = 14 * 24 * 60 * 60 * 1000;
const mem = new Map<string, { list: EmbeddedTrackList; header?: MkvHeader; cues?: MkvCue[]; corsUrl?: string }>();
const inflight = new Map<string, Promise<EmbeddedTrackList | null>>();

/** Unwrap proxy URLs (?src= / ?url=) to the real file URL. */
export const unwrapMediaUrl = (value: string): string => {
  const raw = String(value || "");
  try {
    const u = new URL(raw);
    const inner = u.searchParams.get("url") || fromOpaqueUrlToken(u.searchParams.get("src") || "");
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch { /* not a url */ }
  return raw;
};

export const isLikelyMatroska = (value: string): boolean => {
  const inner = unwrapMediaUrl(value);
  let decoded = inner;
  try { decoded = decodeURIComponent(inner); } catch { /* keep */ }
  return /\.mkv(?:$|[?#&])/i.test(decoded);
};

/**
 * Any direct video file can carry extra tracks. RS uploads named ".mp4" are
 * often Matroska inside (and vice versa), so every direct file is sniffed.
 */
export const isProbeCandidate = (value: string): boolean => {
  const inner = unwrapMediaUrl(value);
  if (!/^https?:\/\//i.test(inner)) return false;
  let decoded = inner;
  try { decoded = decodeURIComponent(inner); } catch { /* keep */ }
  if (/\.(m3u8|mpd|ts)(?:$|[?#&])/i.test(decoded)) return false;
  let path = "";
  try { path = new URL(inner).pathname; } catch { return false; }
  const ext = (path.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  return !ext || ["mkv", "mp4", "m4v", "webm", "mov", "mka"].includes(ext);
};

/** Host-independent key: the same file is served by several RS mirrors. */
export const mediaKey = (value: string): string => {
  const inner = unwrapMediaUrl(value);
  try {
    const u = new URL(inner);
    const hash = u.searchParams.get("hash") || "";
    const path = u.pathname.replace(/^\/watch\//, "/");
    return `${path}|${hash}`;
  } catch {
    return inner;
  }
};

const fbKey = (key: string) => {
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
};

const readLs = (key: string): EmbeddedTrackList | null => {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const hit = all[key];
    if (hit && Date.now() - hit.at < LS_TTL) return hit.list;
  } catch { /* ignore */ }
  return null;
};

const writeLs = (key: string, list: EmbeddedTrackList) => {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    all[key] = { at: Date.now(), list };
    const keys = Object.keys(all);
    if (keys.length > 300) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 300).forEach((k) => delete all[k]);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* quota */ }
};

/** Re-evaluate "playable" for THIS browser (shared cache stores raw facts). */
const relabel = <T extends { label: string; rawName?: string; language: string; kind: "audio" | "subtitle"; forced?: boolean }>(items: T[]): T[] => {
  const seen = new Map<string, number>();
  // Full dialogue subtitles first; signs-only tracks after them.
  const ordered = items.map((t, i) => ({ t, i })).sort((a, b) => Number(!!a.t.forced) - Number(!!b.t.forced) || a.i - b.i);
  return ordered.map(({ t, i }) => {
    const lang = buildTrackLabel(t.kind, t.language, t.rawName || t.label, i);
    const base = t.forced ? `${lang} (Signs)` : lang;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return { ...t, rawName: t.rawName || t.label, label: n > 1 ? `${base} ${n}` : base };
  });
};

const nativeAudioTracks = () => typeof HTMLMediaElement !== "undefined" && "audioTracks" in HTMLMediaElement.prototype;

const applySupport = (list: EmbeddedTrackList): EmbeddedTrackList => {
  if (list.container === "mp4") {
    const ok = nativeAudioTracks();
    return { ...list, audio: relabel(list.audio || []).map((a) => ({ ...a, playable: ok || a.number === list.nativeAudio })), subtitles: relabel(list.subtitles || []) };
  }
  if (list.container === "none") return { ...list, audio: [], subtitles: [] };
  const MS = mseAvailable() ? (window as any).MediaSource : null;
  const videoOk = !!(MS && list.videoMime && MS.isTypeSupported(list.videoMime));
  return {
    ...list,
    audio: relabel(list.audio).map((a) => ({ ...a, playable: videoOk && !!a.mime && MS.isTypeSupported(a.mime) })),
    subtitles: relabel(list.subtitles),
  };
};

const summarize = (header: MkvHeader): EmbeddedTrackList => {
  const native = header.audio.find((a) => a.isDefault) || header.audio[0];
  return applySupport({
    container: "mkv",
    nativeAudio: native?.number ?? -1,
    videoMime: header.video?.route ? videoMime(header.video) : "",
    audio: header.audio.map((a) => ({
      number: a.number, kind: "audio" as const, label: a.label, rawName: a.name, language: a.language, codec: a.codec,
      isDefault: a.number === native?.number, playable: false, mime: a.route ? audioMime(a) : "",
    })),
    subtitles: header.subtitles
      .filter((s) => s.route === "text")
      .map((s) => ({
        number: s.number, kind: "subtitle" as const, label: s.label, rawName: s.name, language: s.language, codec: s.codec,
        isDefault: s.isDefault, playable: true, bitmap: isPgsTrack(s),
        forced: s.isForced || /\b(signs?|songs?|forced)\b/i.test(s.name),
      })),
  });
};

const buildProxyUrl = (base: string, target: string) => {
  const clean = base.replace(/\/+$/, "");
  if (clean.includes("{url}")) return clean.split("{url}").join(encodeURIComponent(target));
  if (/\.workers\.dev$/i.test(clean.replace(/\?.*$/, ""))) return `${clean}?url=${encodeURIComponent(target)}`;
  return `${clean}?src=${encodeURIComponent(toOpaqueUrlToken(target))}`;
};

/** CORS-readable candidates for the file: EGD-routed proxy first, then the default copy. */
export async function corsCandidates(playUrl: string): Promise<string[]> {
  const raw = unwrapMediaUrl(playUrl);
  const out: string[] = [];
  if (raw !== playUrl && /video-proxy/i.test(playUrl)) out.push(playUrl);
  const routed = await getEdgeFunctionUrl("video-proxy").catch(() => "");
  if (routed) out.push(buildProxyUrl(routed, raw));
  if (SUPABASE_URL) out.push(buildProxyUrl(`${String(SUPABASE_URL).replace(/\/+$/, "")}/functions/v1/video-proxy`, raw));
  return Array.from(new Set(out));
}

async function readShared(key: string): Promise<EmbeddedTrackList | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(firebaseRestUrl(`mediaTracks/${fbKey(`${key}|v3`)}`), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    const val = res.ok ? await res.json() : null;
    if (val?.list && Date.now() - Number(val.at || 0) < LS_TTL) {
      const list = val.list as EmbeddedTrackList;
      list.audio = Array.isArray(list.audio) ? list.audio : [];
      list.subtitles = Array.isArray(list.subtitles) ? list.subtitles : [];
      return list;
    }
  } catch { /* offline / blocked */ }
  return null;
}

/** Cached track list without network (for instant UI). */
export function peekEmbeddedTracks(playUrl: string): EmbeddedTrackList | null {
  const key = mediaKey(playUrl);
  const list = mem.get(key)?.list || readLs(key);
  return list ? applySupport(list) : null;
}

const mp4Summary = (tracks: Awaited<ReturnType<typeof readMp4Tracks>>): EmbeddedTrackList => {
  const audio = tracks.filter((t) => t.kind === "audio");
  return applySupport({
    container: "mp4",
    nativeAudio: audio[0]?.id ?? -1,
    audio: audio.map((a, i) => ({
      number: a.id, kind: "audio" as const, label: a.name, rawName: a.name, language: a.language, codec: a.codec,
      isDefault: i === 0, playable: false,
    })),
    // MP4 timed-text never shows up in RS uploads (their "text" tracks are chapter titles).
    subtitles: [],
  });
};

/** Track list for one direct file (MKV or MP4, sniffed from the bytes). */
export async function probeEmbeddedTracks(playUrl: string): Promise<EmbeddedTrackList | null> {
  if (!isProbeCandidate(playUrl)) return null;
  const key = mediaKey(playUrl);
  const hit = mem.get(key);
  if (hit) return hit.list;
  const running = inflight.get(key);
  if (running) return running;
  const task = (async () => {
    const cached = readLs(key) || (await readShared(key));
    if (cached) {
      const list = applySupport(cached);
      mem.set(key, { list });
      writeLs(key, cached);
      return list;
    }
    const remember = (list: EmbeddedTrackList, extra: Partial<{ header: MkvHeader; cues: MkvCue[]; corsUrl: string }> = {}) => {
      mem.set(key, { list, ...extra });
      writeLs(key, list);
      set(ref(db, `mediaTracks/${fbKey(`${key}|v3`)}`), { at: Date.now(), list }).catch(() => undefined);
      return list;
    };
    try {
      const loaded = await loadHeader(playUrl);
      return remember(summarize(loaded.header), loaded);
    } catch (error) {
      const notMkv = error instanceof NotMatroskaError ? error : null;
      if (!notMkv) return null; // network trouble — try again next time
      if (isMp4Magic(notMkv.head)) {
        const source = new HttpRangeSource(notMkv.corsUrl);
        try {
          return remember(mp4Summary(await readMp4Tracks(source, notMkv.head)));
        } catch { return null; } finally { source.abort(); }
      }
      return remember({ container: "none", audio: [], subtitles: [], nativeAudio: -1 });
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export class NotMatroskaError extends Error {
  constructor(readonly corsUrl: string, readonly head: Uint8Array) { super("not a matroska file"); }
}

/** Full header + cues + a working CORS URL (needed before engine hand-over). */
export async function loadHeader(playUrl: string): Promise<{ header: MkvHeader; cues: MkvCue[]; corsUrl: string }> {
  const key = mediaKey(playUrl);
  const hit = mem.get(key);
  if (hit?.header && hit.cues && hit.corsUrl) return { header: hit.header, cues: hit.cues, corsUrl: hit.corsUrl };
  let lastError: unknown = null;
  for (const corsUrl of await corsCandidates(playUrl)) {
    const source = new HttpRangeSource(corsUrl);
    try {
      const { header, cues } = await openMkv(source);
      const list = summarize(header);
      mem.set(key, { list, header, cues, corsUrl });
      return { header, cues, corsUrl };
    } catch (error) {
      lastError = error;
      if (String((error as Error)?.message || "").includes("not a matroska")) {
        const head = await source.read(0, 64 * 1024).catch(() => new Uint8Array(0));
        if (head.length >= 8) { lastError = new NotMatroskaError(corsUrl, head); break; }
      }
    } finally {
      source.abort();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("track probe failed");
}
