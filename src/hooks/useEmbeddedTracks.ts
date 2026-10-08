// ============================================================
// useEmbeddedTracks — multi-audio + embedded subtitles for RS .mkv files
// ============================================================
// Flow (zero start-up cost):
//   1. The episode starts natively in <video> exactly like before.
//   2. In the background the track list is read (cache → 256 KB range read).
//   3. Only when the viewer picks ANOTHER audio language, or turns on an
//      embedded subtitle, the element is handed to MkvEngine at the current
//      position. The last frame is frozen on screen during the swap so the
//      picture never flashes black. Any failure returns to native playback.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MkvEngine, type TextCue } from "@/lib/mkv/mkvEngine";
import type { PgsBitmapCue } from "@/lib/mkv/pgs";
import { MkvSubtitleReader } from "@/lib/mkv/subtitleReader";
import { isProbeCandidate, loadHeader, mediaKey, peekEmbeddedTracks, probeEmbeddedTracks, type EmbeddedTrack, type EmbeddedTrackList } from "@/lib/mkv/trackProbe";

const PREF_AUDIO = "rs_mkv_pref_audio_v1";
const PREF_SUB = "rs_mkv_pref_sub_v1";

const readPref = (key: string): string => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const writePref = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* ignore */ } };
const PREF_BY_MEDIA = "rs_mkv_pref_by_media_v1";
const readMediaPref = (k: string): { a?: string; s?: string } => {
  try { return (JSON.parse(localStorage.getItem(PREF_BY_MEDIA) || "{}") || {})[k] || {}; } catch { return {}; }
};
const writeMediaPref = (k: string, patch: { a?: string; s?: string }) => {
  if (!k) return;
  try {
    const all = JSON.parse(localStorage.getItem(PREF_BY_MEDIA) || "{}") || {};
    all[k] = { ...(all[k] || {}), ...patch, t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 400) keys.sort((x, y) => (all[x].t || 0) - (all[y].t || 0)).slice(0, keys.length - 400).forEach((x) => delete all[x]);
    localStorage.setItem(PREF_BY_MEDIA, JSON.stringify(all));
  } catch { /* ignore */ }
};
const langOf = (t?: EmbeddedTrack | null) => String(t?.language || "").toLowerCase().split(/[-_]/)[0];

const insertSorted = <T extends { start: number }>(list: T[], item: T) => {
  let i = list.length;
  while (i > 0 && list[i - 1].start > item.start) i -= 1;
  list.splice(i, 0, item);
};

const findActive = <T extends { start: number; end: number }>(list: T[] | undefined, t: number): T[] => {
  if (!list?.length) return [];
  let lo = 0; let hi = list.length - 1; let idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const out: T[] = [];
  for (let i = idx; i >= 0 && i > idx - 8; i -= 1) if (list[i].start <= t && list[i].end > t) out.unshift(list[i]);
  return out;
};

export interface EmbeddedTracksState {
  available: boolean;
  tracks: EmbeddedTrackList | null;
  activeAudio: number;
  activeSubtitle: number;
  busy: boolean;
  engineActive: boolean;
  ownsRef: RefObject<boolean>;
  subtitleText: string;
  bitmapCue: PgsBitmapCue | null;
  selectAudio: (number: number) => void;
  selectSubtitle: (number: number) => void;
}

export function useEmbeddedTracks({ videoRef, src, enabled, onNotice }: {
  videoRef: RefObject<HTMLVideoElement>;
  src: string;
  enabled: boolean;
  onNotice?: (message: string) => void;
}): EmbeddedTracksState {
  const [tracks, setTracks] = useState<EmbeddedTrackList | null>(null);
  const [activeAudio, setActiveAudio] = useState(-1);
  const [activeSubtitle, setActiveSubtitle] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [engineActive, setEngineActive] = useState(false);
  const [subtitleText, setSubtitleText] = useState("");
  const [bitmapCue, setBitmapCue] = useState<PgsBitmapCue | null>(null);
  const engineRef = useRef<MkvEngine | null>(null);
  const ownsRef = useRef(false);
  const srcRef = useRef(src);
  const textCues = useRef(new Map<number, TextCue[]>());
  const bitmapCues = useRef(new Map<number, PgsBitmapCue[]>());
  const activeSubRef = useRef(-1);
  const activeAudioRef = useRef(-1);
  const tracksRef = useRef<EmbeddedTrackList | null>(null);
  const opRef = useRef(0);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const autoAppliedRef = useRef("");
  const busyRef = useRef(false);
  const setBusyBoth = (value: boolean) => { busyRef.current = value; setBusy(value); };

  const candidate = enabled && !!src && isProbeCandidate(src) ? src : "";
  const key = useMemo(() => (candidate ? mediaKey(candidate) : ""), [candidate]);
  const keyRef = useRef(key);
  keyRef.current = key;

  // ---- freeze frame (keeps the last picture while the element is swapped) ----
  const freezeRef = useRef<HTMLCanvasElement | null>(null);
  const freeze = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.parentElement || !v.videoWidth) return;
    try {
      const c = freezeRef.current || document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      c.className = v.className;
      c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${getComputedStyle(v).objectFit || "contain"};pointer-events:none;z-index:1;filter:${v.style.filter || "none"}`;
      if (!c.parentElement) v.insertAdjacentElement("afterend", c);
      freezeRef.current = c;
    } catch { /* tainted canvases still draw; ignore anything else */ }
  }, [videoRef]);
  const unfreeze = useCallback(() => {
    const c = freezeRef.current;
    if (c?.parentElement) {
      c.style.transition = "opacity 180ms ease";
      c.style.opacity = "0";
      setTimeout(() => { c.remove(); c.style.opacity = "1"; c.style.transition = ""; }, 200);
    }
  }, []);

  const cueCallbacks = useRef({
    onTextCue: (track: number, cue: TextCue) => {
      const list = textCues.current.get(track) || [];
      if (list.some((c) => c.start === cue.start && c.text === cue.text)) return;
      insertSorted(list, cue);
      textCues.current.set(track, list);
    },
    onBitmapCue: (track: number, cue: PgsBitmapCue) => {
      const list = bitmapCues.current.get(track) || [];
      if (list.some((c) => c.start === cue.start)) return;
      insertSorted(list, cue);
      bitmapCues.current.set(track, list);
    },
  }).current;

  // ---- subtitle side-reader: CC while the original audio keeps playing natively ----
  const subReaderRef = useRef<MkvSubtitleReader | null>(null);
  const subOpRef = useRef(0);
  const stopSubReader = useCallback(() => {
    subOpRef.current += 1;
    subReaderRef.current?.destroy();
    subReaderRef.current = null;
  }, []);
  const startSubReader = useCallback(async () => {
    if (engineRef.current || subReaderRef.current) return;
    const playUrl = srcRef.current;
    if (!playUrl || tracksRef.current?.container === "mp4") return;
    const op = ++subOpRef.current;
    try {
      const { header, cues, corsUrl } = await loadHeader(playUrl);
      if (op !== subOpRef.current || engineRef.current || activeSubRef.current < 0 || srcRef.current !== playUrl) return;
      const reader = new MkvSubtitleReader(corsUrl, header, cues, () => videoRef.current?.currentTime || 0, cueCallbacks);
      subReaderRef.current = reader;
      reader.start();
    } catch (error) {
      if (op === subOpRef.current) {
        console.warn("[mkv] subtitle reader failed:", (error as Error)?.message);
        noticeRef.current?.("Couldn't load subtitles right now.");
      }
    }
  }, [cueCallbacks, videoRef]);

  const destroyEngine = useCallback(() => {
    const e = engineRef.current;
    engineRef.current = null;
    ownsRef.current = false;
    setEngineActive(false);
    if (e) { try { e.destroy(); } catch { /* ignore */ } }
  }, []);

  const backToNative = useCallback((time: number, play: boolean) => {
    destroyEngine();
    const v = videoRef.current;
    const nativeSrc = srcRef.current;
    if (!v || !nativeSrc) { unfreeze(); return; }
    try {
      v.src = nativeSrc;
      v.load();
      const restore = () => {
        try { if (time > 0.5) v.currentTime = time; } catch { /* ignore */ }
        if (play) v.play().catch(() => undefined);
        unfreeze();
      };
      v.addEventListener("loadedmetadata", restore, { once: true });
    } catch { unfreeze(); }
    const native = tracksRef.current?.nativeAudio ?? -1;
    activeAudioRef.current = native;
    setActiveAudio(native);
    if (activeSubRef.current >= 0) void startSubReader();
  }, [destroyEngine, startSubReader, unfreeze, videoRef]);

  // ---- reset + background probe per source ----
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  useEffect(() => {
    opRef.current += 1;
    destroyEngine();
    stopSubReader();
    textCues.current = new Map();
    bitmapCues.current = new Map();
    setSubtitleText("");
    setBitmapCue(null);
    setBusy(false);
    activeSubRef.current = -1;
    setActiveSubtitle(-1);
    tracksRef.current = null;
    setTracks(null);
    activeAudioRef.current = -1;
    setActiveAudio(-1);
    autoAppliedRef.current = "";
    if (!candidate) return;
    let cancelled = false;
    const apply = (list: EmbeddedTrackList | null) => {
      if (cancelled || !list) return;
      tracksRef.current = list;
      setTracks(list);
      if (activeAudioRef.current < 0) { activeAudioRef.current = list.nativeAudio; setActiveAudio(list.nativeAudio); }
      // Pre-read the full header + cues in the background so a later language
      // switch skips that round-trip and starts in about a second.
      if (list.container !== "mp4" && (list.audio.length > 1 || list.subtitles.length > 0) && !warmTimer) {
        warmTimer = setTimeout(() => { if (!cancelled) loadHeader(candidate).catch(() => undefined); }, 2500);
      }
    };
    let warmTimer: ReturnType<typeof setTimeout> | null = null;
    apply(peekEmbeddedTracks(candidate));
    // Let the first frames load before we spend bandwidth on the probe.
    const timer = setTimeout(() => { probeEmbeddedTracks(candidate).then(apply).catch(() => undefined); }, 600);
    return () => { cancelled = true; clearTimeout(timer); if (warmTimer) clearTimeout(warmTimer); };
  }, [candidate, destroyEngine, stopSubReader]);

  // If anything else (server/quality switch, retry) replaces the element's
  // source, the engine silently steps aside.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoadStart = () => {
      const e = engineRef.current;
      if (e && !e.ownsElement(v) && !busyRef.current) {
        destroyEngine();
        const native = tracksRef.current?.nativeAudio ?? -1;
        activeAudioRef.current = native;
        setActiveAudio(native);
      }
    };
    v.addEventListener("loadstart", onLoadStart);
    return () => v.removeEventListener("loadstart", onLoadStart);
  }, [destroyEngine, videoRef]);


  /** Hand the element to the engine with `audioNumber` at the current time. */
  const handOver = useCallback(async (audioNumber: number) => {
    const v = videoRef.current;
    const playUrl = srcRef.current;
    if (!v || !playUrl) return false;
    const op = ++opRef.current;
    const time = v.currentTime || 0;
    const wasPlaying = !v.paused;
    setBusyBoth(true);
    try {
      const { header, cues, corsUrl } = await loadHeader(playUrl);
      if (op !== opRef.current) return false;
      freeze();
      destroyEngine();
      stopSubReader(); // the engine reads subtitles itself
      const engine = new MkvEngine(corsUrl, header, cues, audioNumber, {
        ...cueCallbacks,
        onFatal: (error) => {
          if (engineRef.current !== engine) return;
          console.warn("[mkv] engine stopped:", error.message);
          const t = videoRef.current?.currentTime || time;
          const playing = videoRef.current ? !videoRef.current.paused : wasPlaying;
          freeze();
          backToNative(t, playing);
          noticeRef.current?.("This audio track couldn't play here — switched back to the original audio.");
        },
      });
      engineRef.current = engine;
      ownsRef.current = true;
      setEngineActive(true);
      if (wasPlaying) v.pause();
      await engine.attach(v, time);
      if (op !== opRef.current || engineRef.current !== engine) return false;
      if (wasPlaying) await v.play().catch(() => undefined);
      unfreeze();
      return true;
    } catch (error) {
      if (op === opRef.current) {
        console.warn("[mkv] hand-over failed:", (error as Error)?.message);
        backToNative(time, wasPlaying);
        noticeRef.current?.("Couldn't switch audio on this device right now.");
      }
      return false;
    } finally {
      if (op === opRef.current) setBusyBoth(false);
    }
  }, [backToNative, cueCallbacks, destroyEngine, freeze, stopSubReader, unfreeze, videoRef]);

  const selectAudio = useCallback((number: number) => {
    const list = tracksRef.current;
    const track = list?.audio.find((a) => a.number === number);
    if (!list || !track || busyRef.current) return;
    if (!track.playable && number !== list.nativeAudio) {
      noticeRef.current?.(`${track.label} (${track.codec}) can't play in this browser.`);
      return;
    }
    writePref(PREF_AUDIO, number === list.nativeAudio ? "" : langOf(track));
    writeMediaPref(keyRef.current, { a: number === list.nativeAudio ? "native" : langOf(track) });
    if (number === activeAudioRef.current) return;
    if (list.container === "mp4") {
      // Real MP4: the browser decodes every track itself — just flip which one is enabled.
      const native = (videoRef.current as any)?.audioTracks;
      const index = list.audio.findIndex((a) => a.number === number);
      if (native && index >= 0 && native.length > index) {
        for (let i = 0; i < native.length; i += 1) native[i].enabled = i === index;
        activeAudioRef.current = number;
        setActiveAudio(number);
      } else noticeRef.current?.("This browser can't switch audio in this file.");
      return;
    }
    activeAudioRef.current = number;
    setActiveAudio(number);
    const engine = engineRef.current;
    if (engine && !engine.isDestroyed) {
      setBusyBoth(true);
      const op = ++opRef.current;
      engine.switchAudio(number)
        .catch(async () => { if (op === opRef.current) { setBusyBoth(false); await handOver(number); } })
        .finally(() => { if (op === opRef.current) setBusyBoth(false); });
      return;
    }
    if (number === list.nativeAudio) return; // native already plays it
    void handOver(number);
  }, [handOver, videoRef]);

  const selectSubtitle = useCallback((number: number) => {
    activeSubRef.current = number;
    setActiveSubtitle(number);
    setSubtitleText("");
    setBitmapCue(null);
    const track = tracksRef.current?.subtitles.find((s) => s.number === number);
    writePref(PREF_SUB, number >= 0 ? langOf(track) || "on" : "off");
    writeMediaPref(keyRef.current, { s: number >= 0 ? langOf(track) || "on" : "off" });
    if (number < 0) { stopSubReader(); return; }
    // With another language playing the engine already streams every subtitle;
    // otherwise a light side-reader fetches them while native playback continues.
    if (!engineRef.current) void startSubReader();
  }, [startSubReader, stopSubReader]);

  // ---- remembered language choices: apply once the episode is playing ----
  useEffect(() => {
    if (!tracks || !candidate || autoAppliedRef.current === key) return;
    const media = readMediaPref(key);
    const prefAudio = media.a ? (media.a === "native" ? "" : media.a) : readPref(PREF_AUDIO);
    const prefSub = media.s || readPref(PREF_SUB);
    const audioMatch = prefAudio ? tracks.audio.find((a) => a.playable && langOf(a) === prefAudio && a.number !== tracks.nativeAudio) : undefined;
    const subMatch = prefSub && prefSub !== "off"
      ? tracks.subtitles.find((s) => langOf(s) === prefSub && !s.forced && !/sign|song/i.test(`${s.rawName || ""} ${s.label}`)) || tracks.subtitles.find((s) => langOf(s) === prefSub)
      : undefined;
    if (!audioMatch && !subMatch) { autoAppliedRef.current = key; return; }
    const v = videoRef.current;
    if (!v) return;
    let settleTimer = 0;
    const run = () => {
      if (autoAppliedRef.current === key) return;
      // Continue-watching seeks right after start; hand over only once the
      // resume position is applied so the chosen audio starts from there.
      if (v.seeking || (v.currentTime < 1 && v.readyState < 3)) {
        v.addEventListener("seeked", run, { once: true });
        return;
      }
      autoAppliedRef.current = key;
      if (subMatch) { activeSubRef.current = subMatch.number; setActiveSubtitle(subMatch.number); }
      if (audioMatch) { activeAudioRef.current = audioMatch.number; setActiveAudio(audioMatch.number); void handOver(audioMatch.number); }
      else if (subMatch) void startSubReader();
    };
    const start = () => { settleTimer = window.setTimeout(run, 350); };
    if (!v.paused && v.readyState >= 3) start();
    else v.addEventListener("playing", start, { once: true });
    return () => { clearTimeout(settleTimer); v.removeEventListener("playing", start); v.removeEventListener("seeked", run); };
  }, [candidate, handOver, key, startSubReader, tracks, videoRef]);

  // ---- subtitle clock ----
  useEffect(() => {
    if (activeSubtitle < 0) return;
    let raf = 0; let last = -1;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        if (Math.abs(t - last) > 0.08) {
          last = t;
          const text = findActive(textCues.current.get(activeSubtitle), t).map((c) => c.text).join("\n");
          setSubtitleText((prev) => (prev === text ? prev : text));
          const bmp = findActive(bitmapCues.current.get(activeSubtitle), t);
          const cue = bmp.length ? bmp[bmp.length - 1] : null;
          setBitmapCue((prev) => (prev === cue ? prev : cue));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeSubtitle, videoRef]);

  useEffect(() => () => { destroyEngine(); stopSubReader(); freezeRef.current?.remove(); }, [destroyEngine, stopSubReader]);

  const available = !!tracks && (tracks.audio.length > 1 || tracks.subtitles.length > 0);
  return { available, tracks, activeAudio, activeSubtitle, busy, engineActive, ownsRef, subtitleText, bitmapCue, selectAudio, selectSubtitle };
}
