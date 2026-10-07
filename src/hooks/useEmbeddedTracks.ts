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
import { isLikelyMatroska, loadHeader, mediaKey, peekEmbeddedTracks, probeEmbeddedTracks, type EmbeddedTrack, type EmbeddedTrackList } from "@/lib/mkv/trackProbe";

const PREF_AUDIO = "rs_mkv_pref_audio_v1";
const PREF_SUB = "rs_mkv_pref_sub_v1";

const readPref = (key: string): string => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const writePref = (key: string, value: string) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* ignore */ } };
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

  const candidate = enabled && !!src && isLikelyMatroska(src) ? src : "";
  const key = useMemo(() => (candidate ? mediaKey(candidate) : ""), [candidate]);

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
  }, [destroyEngine, unfreeze, videoRef]);

  // ---- reset + background probe per source ----
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  useEffect(() => {
    opRef.current += 1;
    destroyEngine();
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
    };
    apply(peekEmbeddedTracks(candidate));
    // Let the first frames load before we spend bandwidth on the probe.
    const timer = setTimeout(() => { probeEmbeddedTracks(candidate).then(apply).catch(() => undefined); }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [candidate, destroyEngine]);

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
      const engine = new MkvEngine(corsUrl, header, cues, audioNumber, {
        onTextCue: (track, cue) => {
          const list = textCues.current.get(track) || [];
          insertSorted(list, cue);
          textCues.current.set(track, list);
        },
        onBitmapCue: (track, cue) => {
          const list = bitmapCues.current.get(track) || [];
          insertSorted(list, cue);
          bitmapCues.current.set(track, list);
        },
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
  }, [backToNative, destroyEngine, freeze, unfreeze, videoRef]);

  const selectAudio = useCallback((number: number) => {
    const list = tracksRef.current;
    const track = list?.audio.find((a) => a.number === number);
    if (!list || !track || busyRef.current) return;
    if (!track.playable && number !== list.nativeAudio) {
      noticeRef.current?.(`${track.label} (${track.codec}) can't play in this browser.`);
      return;
    }
    writePref(PREF_AUDIO, number === list.nativeAudio ? "" : langOf(track));
    if (number === activeAudioRef.current) return;
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
  }, [handOver]);

  const selectSubtitle = useCallback((number: number) => {
    activeSubRef.current = number;
    setActiveSubtitle(number);
    setSubtitleText("");
    setBitmapCue(null);
    const track = tracksRef.current?.subtitles.find((s) => s.number === number);
    writePref(PREF_SUB, number >= 0 ? langOf(track) || "on" : "off");
    if (number < 0) return;
    // Embedded subtitles are read by the engine while it streams.
    if (!engineRef.current && !busyRef.current) {
      const audio = activeAudioRef.current >= 0 ? activeAudioRef.current : tracksRef.current?.nativeAudio ?? -1;
      const audioTrack = tracksRef.current?.audio.find((a) => a.number === audio);
      if (audio >= 0 && audioTrack?.playable) void handOver(audio);
      else noticeRef.current?.("Subtitles from this file can't be shown on this device.");
    }
  }, [handOver]);

  // ---- remembered language choices: apply once the episode is playing ----
  useEffect(() => {
    if (!tracks || !candidate || autoAppliedRef.current === key) return;
    const prefAudio = readPref(PREF_AUDIO);
    const prefSub = readPref(PREF_SUB);
    const audioMatch = prefAudio ? tracks.audio.find((a) => a.playable && langOf(a) === prefAudio && a.number !== tracks.nativeAudio) : undefined;
    const subMatch = prefSub && prefSub !== "off"
      ? tracks.subtitles.find((s) => langOf(s) === prefSub && !/sign|song/i.test(s.label)) || tracks.subtitles.find((s) => langOf(s) === prefSub)
      : undefined;
    if (!audioMatch && !subMatch) { autoAppliedRef.current = key; return; }
    const v = videoRef.current;
    if (!v) return;
    const run = () => {
      if (autoAppliedRef.current === key) return;
      autoAppliedRef.current = key;
      if (subMatch) { activeSubRef.current = subMatch.number; setActiveSubtitle(subMatch.number); }
      if (audioMatch) { activeAudioRef.current = audioMatch.number; setActiveAudio(audioMatch.number); void handOver(audioMatch.number); }
      else if (subMatch) {
        const native = tracks.audio.find((a) => a.number === tracks.nativeAudio);
        if (native?.playable) void handOver(tracks.nativeAudio);
      }
    };
    if (!v.paused && v.readyState >= 3) { run(); return; }
    v.addEventListener("playing", run, { once: true });
    return () => v.removeEventListener("playing", run);
  }, [candidate, handOver, key, tracks, videoRef]);

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

  useEffect(() => () => { destroyEngine(); freezeRef.current?.remove(); }, [destroyEngine]);

  const available = !!tracks && (tracks.audio.length > 1 || tracks.subtitles.length > 0);
  return { available, tracks, activeAudio, activeSubtitle, busy, engineActive, ownsRef, subtitleText, bitmapCue, selectAudio, selectSubtitle };
}
