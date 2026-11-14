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
import { MkvEngine, canPlayAudioTrack, canPlayTrackCombo, type TextCue } from "@/lib/mkv/mkvEngine";
import { pictureDecodingPossible, prewarmPictureDecoder } from "@/lib/mkv/pictureDecoder";
import { prepareIsolatedDecoder } from "@/lib/mkv/isolatedDecoder";
import { videoFamily } from "@/lib/mkv/videoCodec";
import { AudioSidecar } from "@/lib/mkv/audioSidecar";
import type { MkvHeader } from "@/lib/mkv/mkvDemux";
import { videoMime } from "@/lib/mkv/mkvRemux";
import type { PgsBitmapCue } from "@/lib/mkv/pgs";
import { MkvSubtitleReader } from "@/lib/mkv/subtitleReader";
import { detectSubtitleLanguage } from "@/lib/mkv/subtitleLanguage";
import { isProbeCandidate, loadHeader, mediaKey, peekEmbeddedTracks, probeEmbeddedTracks, refineSubtitleLabels, type EmbeddedTrack, type EmbeddedTrackList } from "@/lib/mkv/trackProbe";
import { pickDefaultAudio } from "@/lib/mkv/audioDefault";
import { warmTrackProxy } from "@/lib/trackProxy";
import { canDecodeTrack, prewarmAudioDecoder } from "@/lib/mkv/audioDecode";
import { uniqueLines } from "@/lib/subtitleFormats";

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
// Video formats whose Media Source path has shown a black picture on this
// device: those files switch audio through the sidecar (video stays native).
const BROKEN_MSE = "rs_mse_video_broken_v1";
const brokenMse = (): string[] => { try { return JSON.parse(localStorage.getItem(BROKEN_MSE) || "[]"); } catch { return []; } };
const markBrokenMse = (mime: string) => { try { const l = brokenMse(); if (!l.includes(mime)) localStorage.setItem(BROKEN_MSE, JSON.stringify([...l, mime].slice(-20))); } catch { /* ignore */ } };
/** Full re-mux only for video the browser reliably decodes via Media Source; HEVC never (black screen on many phones). */
const wantsFullEngine = (header: MkvHeader, audioNumber: number): boolean => {
  const v = header.video; const a = header.audio.find((x) => x.number === audioNumber) || null;
  if (!v || !canPlayTrackCombo(v, a)) return false;
  const mime = videoMime(v);
  if (/hvc1|hev1/i.test(mime)) return false;
  return !brokenMse().includes(mime);
};
/** A black-screen file the phone can still decode itself once re-packed for Media Source. */
const wantsNativeRemux = (header: MkvHeader, audioNumber: number): boolean => {
  const v = header.video; const a = header.audio.find((x) => x.number === audioNumber) || header.audio[0] || null;
  if (!v || !v.route || !canPlayTrackCombo(v, a)) return false;
  return !brokenMse().includes(videoMime(v));
};
// Exact files (media keys) this device showed as a black screen (sound only):
// only those open straight in picture mode next time. Never a whole codec
// family — other files of the same kind usually play natively and must stay native.
const BLACK_PICTURE = "rs_native_picture_black_files_v2";
const blackPictures = (): string[] => { try { return JSON.parse(localStorage.getItem(BLACK_PICTURE) || "[]"); } catch { return []; } };
const markBlackPicture = (fileKey: string) => { try { const l = blackPictures(); if (fileKey && !l.includes(fileKey)) localStorage.setItem(BLACK_PICTURE, JSON.stringify([...l, fileKey].slice(-60))); } catch { /* ignore */ } };
try { localStorage.removeItem("rs_native_picture_black_v1"); } catch { /* old per-codec list sent every file of a kind to the decoder */ }
const pictureCapable = () => typeof window !== "undefined" && typeof (window as any).VideoFrame !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly === "object";
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
  /** Playback is held while the chosen sound / the picture loads, so both start together. */
  holding: boolean;
  /** The picture is drawn by the built-in decoder ("hardware" / "software"), or "none". */
  pictureMode: string;
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
  const [holding, setHolding] = useState(false);
  const [pictureMode, setPictureMode] = useState("none");
  const [engineActive, setEngineActive] = useState(false);
  /** Media key that needs the picture drawn by us (sound-only black screen). */
  const pictureKeyRef = useRef("");
  const pictureFailedRef = useRef(new Set<string>());
  /** Black-screen files whose phone video path (Media Source) also showed no picture. */
  const mseRemuxFailedRef = useRef(new Set<string>());
  const [subtitleText, setSubtitleText] = useState("");
  const [bitmapCue, setBitmapCue] = useState<PgsBitmapCue | null>(null);
  const engineRef = useRef<MkvEngine | null>(null);
  const sidecarRef = useRef<AudioSidecar | null>(null);
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
  /** Opened with no picture track (videoWidth 0): sound held until our picture is ready. */
  const blackHoldRef = useRef<{ key: string; play: boolean } | null>(null);
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

  const detectedRef = useRef(new Set<number>());
  const relabelRef = useRef((track: number, lang: string) => {
    const list = tracksRef.current;
    const t = list?.subtitles.find((x) => x.number === track);
    if (!list || !t || list.scanned || t.label.startsWith(lang)) return;
    const signs = t.forced ? " (Signs)" : "";
    const subs = list.subtitles.map((x) => (x.number === track ? { ...x, label: `${lang}${signs}`, language: lang.slice(0, 2).toLowerCase(), detected: true } : x));
    const seen = new Map<string, number>();
    const next = { ...list, subtitles: subs.map((x) => { const base = x.label.replace(/ \d+$/, ""); const n = (seen.get(base) || 0) + 1; seen.set(base, n); return { ...x, label: n > 1 ? `${base} ${n}` : base }; }) };
    tracksRef.current = next;
    setTracks(next);
  });
  const cueCallbacks = useRef({
    onTextCue: (track: number, cue: TextCue) => {
      const list = textCues.current.get(track) || [];
      if (list.some((c) => c.start === cue.start && c.text === cue.text)) return;
      insertSorted(list, cue);
      textCues.current.set(track, list);
      if (list.length >= 6 && !detectedRef.current.has(track)) {
        const lang = detectSubtitleLanguage(list.slice(0, 40).map((c) => c.text));
        if (lang || list.length >= 40) { detectedRef.current.add(track); if (lang) relabelRef.current(track, lang); }
      }
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
    const sc = sidecarRef.current;
    sidecarRef.current = null;
    if (sc) { try { sc.destroy(); } catch { /* ignore */ } }
    const e = engineRef.current;
    engineRef.current = null;
    ownsRef.current = false;
    setEngineActive(false);
    setPictureMode("none");
    if (e) { try { e.destroy(); } catch { /* ignore */ } }
  }, []);

  const backToNative = useCallback((time: number, play: boolean) => {
    if (!engineRef.current && sidecarRef.current) {
      // Picture never left native playback: just give the sound back.
      destroyEngine();
      unfreeze();
      const native = tracksRef.current?.nativeAudio ?? -1;
      activeAudioRef.current = native;
      setActiveAudio(native);
      return;
    }
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
    detectedRef.current = new Set();
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
    pictureKeyRef.current = "";
    blackHoldRef.current = null;
    setHolding(false);
    if (!candidate) return;
    let cancelled = false;
    const apply = (list: EmbeddedTrackList | null) => {
      if (cancelled || !list) return;
      tracksRef.current = list;
      setTracks(list);
      if (activeAudioRef.current < 0) { activeAudioRef.current = list.nativeAudio; setActiveAudio(list.nativeAudio); }
      // Start the decoders this episode will need while it opens, so the
      // sound / picture don't wait for them later.
      try {
        const pick = pickDefaultAudio(list, readMediaPref(key).a, readPref(PREF_AUDIO));
        const picked = list.audio.find((a) => a.number === pick);
        if (list.decodeNative || (picked && !picked.mime && canDecodeTrack(picked.codec))) prewarmAudioDecoder();
        const family = list.container === "mkv" ? videoFamily(list.videoMime) : "";
        if (family && pictureCapable() && blackPictures().includes(key)) prewarmPictureDecoder();
        else if (family && pictureCapable()) void prepareIsolatedDecoder(); // multi-core decoder ready in case this file shows no picture
      } catch { /* warming is optional */ }
      // Pre-read the full header + cues right away (through the track proxy
      // when the server refuses direct reads) so a language switch later
      // starts instantly instead of paying that round-trip.
      if (list.container !== "mp4" && (list.audio.length > 1 || list.subtitles.length > 0) && !warmTimer) {
        warmTimer = setTimeout(() => {
          if (cancelled) return;
          // One-time scan (shared via the track cache): real subtitle
          // languages + which tracks are signs-only. Labels update in place.
          loadHeader(candidate).then(() => refineSubtitleLabels(candidate, tracksRef.current || list)).then((next) => {
            if (cancelled || !next) return;
            tracksRef.current = next;
            setTracks(next);
          }).catch(() => undefined);
        }, 300);
      }
    };
    let warmTimer: ReturnType<typeof setTimeout> | null = null;
    warmTrackProxy();
    apply(peekEmbeddedTracks(candidate));
    // Let the first frames load before we spend bandwidth on the probe.
    const timer = setTimeout(() => { probeEmbeddedTracks(candidate).then(apply).catch(() => undefined); }, 600);
    return () => { cancelled = true; clearTimeout(timer); if (warmTimer) clearTimeout(warmTimer); };
  }, [candidate, destroyEngine, key, stopSubReader]);

  // If anything else (server/quality switch, retry) replaces the element's
  // source, the engine silently steps aside.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoadStart = () => {
      const e = engineRef.current;
      if (!e && sidecarRef.current && !busyRef.current) {
        destroyEngine();
        const native = tracksRef.current?.nativeAudio ?? -1;
        activeAudioRef.current = native;
        setActiveAudio(native);
        return;
      }
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
  const handOver = useCallback(async (audioNumber: number, holdStart = false) => {
    const v = videoRef.current;
    const playUrl = srcRef.current;
    if (!v || !playUrl) return false;
    const op = ++opRef.current;
    const time = v.currentTime || 0;
    const wasPlaying = !v.paused || holdStart;
    const mediaKeyNow = keyRef.current;
    const picture = !!mediaKeyNow && pictureKeyRef.current === mediaKeyNow;
    setBusyBoth(true);
    // Picture and sound start together: hold playback while the new sound
    // (or the picture) loads instead of letting one run ahead of the other.
    if (wasPlaying) { setHolding(true); v.pause(); }
    try {
      const { header, cues, corsUrl } = await loadHeader(playUrl);
      if (op !== opRef.current) return false;
      if (picture && (!pictureDecodingPossible(header.video) || !canPlayAudioTrack(header.audio.find((a) => a.number === audioNumber) || header.audio[0]))) {
        throw new Error("picture decoding not possible here");
      }
      // Black-screen file: first let the phone's own video decoder play it
      // (same file re-packed for Media Source — smooth, hardware); our
      // canvas decoder is only used when the phone has no such decoder.
      const usePicture = picture && !(header.video && !mseRemuxFailedRef.current.has(mediaKeyNow) && wantsNativeRemux(header, audioNumber));
      if (!picture && !wantsFullEngine(header, audioNumber)) {
        // Sidecar: video keeps playing natively, only the sound changes.
        if (engineRef.current) { const t = v.currentTime; freeze(); destroyEngine(); v.src = playUrl; v.load(); await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true })); try { v.currentTime = t; } catch { /* ignore */ } unfreeze(); }
        const old = sidecarRef.current; sidecarRef.current = null;
        old?.destroy(); // gives the sound back before the next language takes it
        const sc = new AudioSidecar(corsUrl, header, cues, audioNumber, (error) => {
          if (sidecarRef.current !== sc) return;
          console.warn("[mkv] audio sidecar stopped:", error.message);
          backToNative(v.currentTime, !v.paused);
          noticeRef.current?.("This audio track couldn't play here — switched back to the original audio.");
        }, (on) => { if (sidecarRef.current === sc) setHolding(on); });
        await sc.attach(v).catch((e) => { sc.destroy(); throw e; });
        if (op !== opRef.current) { sc.destroy(); return false; }
        sidecarRef.current = sc;
        setEngineActive(true);
        if (wasPlaying) await v.play().catch(() => undefined);
        return true;
      }
      freeze();
      destroyEngine();
      stopSubReader(); // the engine reads subtitles itself
      const engine = new MkvEngine(corsUrl, header, cues, audioNumber, {
        ...cueCallbacks,
        picture: usePicture,
        onFatal: (error) => {
          if (engineRef.current !== engine) return;
          console.warn("[mkv] engine stopped:", error.message);
          if (picture && !usePicture) {
            mseRemuxFailedRef.current.add(mediaKeyNow);
            if (header.video) markBrokenMse(videoMime(header.video));
            void handOver(audioNumber, true);
            return;
          }
          const t = videoRef.current?.currentTime || time;
          const playing = videoRef.current ? !videoRef.current.paused : wasPlaying;
          freeze();
          if (picture) { pictureFailedRef.current.add(mediaKeyNow); pictureKeyRef.current = ""; }
          backToNative(t, playing);
          noticeRef.current?.(picture ? "This video's picture can't be shown on this device." : "This audio track couldn't play here — switched back to the original audio.");
        },
      });
      engineRef.current = engine;
      ownsRef.current = true;
      setEngineActive(true);
      await engine.attach(v, time);
      if (op !== opRef.current || engineRef.current !== engine) return false;
      setPictureMode(engine.pictureKind);
      if (wasPlaying) await v.play().catch(() => undefined);
      unfreeze();
      if (usePicture) return true;
      // Watchdog: sound but no picture (seen with some phones' decoders) →
      // remember it and continue through the sidecar with the native video.
      const q0 = (v as any).getVideoPlaybackQuality?.()?.totalVideoFrames ?? 0;
      const t0 = v.currentTime;
      window.setTimeout(() => {
        if (engineRef.current !== engine || op !== opRef.current) return;
        const frames = ((v as any).getVideoPlaybackQuality?.()?.totalVideoFrames ?? q0 + 99) - q0;
        const moved = v.currentTime - t0;
        if (moved > 1.5 && (!v.videoWidth || frames < 3)) {
          console.warn("[mkv] no picture through media source —", picture ? "using our picture decoder" : "using native video");
          if (header.video) markBrokenMse(videoMime(header.video));
          if (picture) mseRemuxFailedRef.current.add(mediaKeyNow);
          void handOver(audioNumber, !v.paused);
        }
      }, 3500);
      return true;
    } catch (error) {
      if (op === opRef.current) {
        console.warn("[mkv] hand-over failed:", (error as Error)?.message);
        if (picture) { pictureFailedRef.current.add(mediaKeyNow); pictureKeyRef.current = ""; }
        backToNative(time, wasPlaying);
        noticeRef.current?.(picture ? "This video's picture can't be shown on this device." : "Couldn't switch audio on this device right now.");
      }
      return false;
    } finally {
      if (op === opRef.current) { setBusyBoth(false); setHolding(false); }
    }
  }, [backToNative, cueCallbacks, destroyEngine, freeze, stopSubReader, unfreeze, videoRef]);

  /** Sound but a black screen: the picture is drawn by our own decoder from now on. */
  const startPicture = useCallback((reason: string) => {
    const key0 = keyRef.current;
    if (!key0 || pictureKeyRef.current === key0 || pictureFailedRef.current.has(key0)) return;
    console.warn("[mkv] browser shows no picture for this video —", reason);
    pictureKeyRef.current = key0;
    const list = tracksRef.current;
    const audio = activeAudioRef.current >= 0 ? activeAudioRef.current : list?.nativeAudio ?? -1;
    const v = videoRef.current;
    void handOver(audio, !!v && !v.paused);
  }, [handOver, videoRef]);

  const selectAudio = useCallback((number: number) => {
    const list = tracksRef.current;
    const track = list?.audio.find((a) => a.number === number);
    if (!list || !track || busyRef.current) return;
    // The file's own audio plays natively — unless it is Dolby/DTS the browser can't hear.
    const nativeOk = number === list.nativeAudio && !list.decodeNative;
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
    if (sidecarRef.current) {
      if (nativeOk) { backToNative(videoRef.current?.currentTime || 0, !videoRef.current?.paused); return; }
      void handOver(number);
      return;
    }
    const engine = engineRef.current;
    if (engine && !engine.isDestroyed) {
      setBusyBoth(true);
      const op = ++opRef.current;
      engine.switchAudio(number)
        .catch(async () => { if (op === opRef.current) { setBusyBoth(false); await handOver(number); } })
        .finally(() => { if (op === opRef.current) setBusyBoth(false); });
      return;
    }
    if (nativeOk) return; // native already plays it
    void handOver(number);
  }, [backToNative, handOver, videoRef]);

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
    const prefSub = media.s || readPref(PREF_SUB);
    // Hindi opens by default; only a choice made on this very file overrides it.
    let audioNumber = pickDefaultAudio(tracks, media.a, readPref(PREF_AUDIO));
    // Staying on the file's own Dolby/DTS audio still needs the software decoder.
    if (audioNumber == null && tracks.decodeNative) audioNumber = tracks.nativeAudio;
    const audioMatch = audioNumber != null ? tracks.audio.find((a) => a.number === audioNumber) : undefined;
    const subMatch = prefSub && prefSub !== "off"
      ? tracks.subtitles.find((s) => langOf(s) === prefSub && !s.forced && !/sign|song/i.test(`${s.rawName || ""} ${s.label}`)) || tracks.subtitles.find((s) => langOf(s) === prefSub)
      : undefined;
    // This device shows this kind of video as a black screen: open straight
    // in picture mode (one hand-over, with the chosen language).
    const family = tracks.container === "mkv" ? videoFamily(tracks.videoMime) : "";
    const canPicture = !!family && pictureCapable() && !pictureFailedRef.current.has(key);
    const pictureFirst = canPicture && blackPictures().includes(key);
    const v = videoRef.current;
    // The file opened without any picture track (HEVC in MKV on most
    // browsers): draw the picture ourselves straight away, sound held.
    const blackNow = () => canPicture && !!v && v.readyState >= 1 && v.videoWidth === 0;
    const releaseHold = () => {
      const hold = blackHoldRef.current;
      if (!hold || hold.key !== key) return;
      blackHoldRef.current = null;
      setHolding(false);
      if (hold.play && v) void v.play().catch(() => undefined);
    };
    if (!audioMatch && !subMatch && !pictureFirst && !canPicture) { releaseHold(); autoAppliedRef.current = key; return; }
    if (!v) return;
    let settleTimer = 0;
    const run = (now = false) => {
      if (autoAppliedRef.current === key) return;
      const picture = now || pictureFirst || blackNow();
      // Continue-watching seeks right after start; hand over only once the
      // resume position is applied so the chosen audio starts from there.
      if (!now && (v.seeking || (v.currentTime < 1 && v.readyState < 3))) {
        v.addEventListener("seeked", () => run(), { once: true });
        return;
      }
      autoAppliedRef.current = key;
      if (subMatch) { activeSubRef.current = subMatch.number; setActiveSubtitle(subMatch.number); }
      if (picture) {
        if (!pictureFirst) markBlackPicture(key);
        const hold = blackHoldRef.current;
        blackHoldRef.current = null;
        pictureKeyRef.current = key;
        const a = audioMatch?.number ?? (activeAudioRef.current >= 0 ? activeAudioRef.current : tracks.nativeAudio);
        activeAudioRef.current = a; setActiveAudio(a);
        console.warn("[mkv] browser shows no picture for this video —", `${family}: opened without picture`);
        void handOver(a, !v.paused || (!!hold && hold.key === key && hold.play));
      } else {
        releaseHold();
        if (audioMatch) { activeAudioRef.current = audioMatch.number; setActiveAudio(audioMatch.number); void handOver(audioMatch.number, !v.paused); }
        else if (subMatch) void startSubReader();
      }
    };
    if (blackNow()) { run(true); return; }
    // A held start whose file turns out to have a picture after all.
    if (blackHoldRef.current?.key === key && !canPicture) releaseHold();
    const onMeta = () => { if (blackNow()) { clearTimeout(settleTimer); run(true); } };
    // Decide right away: playback is held until the chosen sound is ready.
    const start = () => { settleTimer = window.setTimeout(() => run(), 40); };
    v.addEventListener("loadedmetadata", onMeta);
    if (!v.paused && v.readyState >= 3) start();
    else v.addEventListener("playing", start, { once: true });
    return () => { clearTimeout(settleTimer); v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("playing", start); };
  }, [candidate, handOver, key, startSubReader, tracks, videoRef]);

  // ---- no picture track at all, before the track list is known ----
  // Hold the sound the moment the file opens without a picture size, so
  // sound never runs ahead of the picture; released if no picture is coming.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !candidate || !pictureCapable()) return;
    let releaseTimer = 0;
    const hold = () => {
      if (engineRef.current || busyRef.current || ownsRef.current || tracksRef.current) return;
      if (pictureKeyRef.current === key || pictureFailedRef.current.has(key)) return;
      if (v.readyState < 1 || v.videoWidth > 0) return;
      const current = blackHoldRef.current;
      if (current && current.key === key) {
        if (!v.paused) { current.play = true; v.pause(); }
        return;
      }
      blackHoldRef.current = { key, play: !v.paused || v.autoplay };
      setHolding(true);
      if (!v.paused) v.pause();
      // No track list in time (file unreadable here): play as before.
      releaseTimer = window.setTimeout(() => {
        const h = blackHoldRef.current;
        if (!h || h.key !== key || tracksRef.current) return;
        blackHoldRef.current = null;
        setHolding(false);
        if (h.play) void v.play().catch(() => undefined);
      }, 7000);
    };
    v.addEventListener("loadedmetadata", hold);
    v.addEventListener("play", hold);
    hold();
    return () => { clearTimeout(releaseTimer); v.removeEventListener("loadedmetadata", hold); v.removeEventListener("play", hold); };
  }, [candidate, key, videoRef]);

  // ---- silent original audio (Dolby/DTS the browser claimed it could play) ----
  // Chrome counts decoded audio bytes; none after a few seconds of playback
  // means the viewer hears nothing, so the software decoder takes over.
  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) | null;
    if (!v || !tracks || !candidate || tracks.decodeNative || tracks.container === "mp4") return;
    const native = tracks.audio.find((a) => a.number === tracks.nativeAudio);
    if (!native || !/^(AC3|E-AC3|DTS|TrueHD)$/i.test(native.codec) || !canDecodeTrack(native.codec)) return;
    if (typeof v.webkitAudioDecodedByteCount !== "number") return;
    let t0 = -1;
    const check = () => {
      if (v.paused || v.seeking || engineRef.current || sidecarRef.current || busyRef.current) { t0 = -1; return; }
      if (t0 < 0) { t0 = v.currentTime; return; }
      if (v.currentTime - t0 < 3) return;
      clearInterval(timer);
      if ((v.webkitAudioDecodedByteCount || 0) > 0) return;
      const next = { ...tracks, decodeNative: true };
      tracksRef.current = next;
      setTracks(next);
      if (activeAudioRef.current === tracks.nativeAudio || activeAudioRef.current < 0) void handOver(tracks.nativeAudio);
    };
    const timer = window.setInterval(check, 700);
    return () => clearInterval(timer);
  }, [candidate, handOver, tracks, videoRef]);

  // ---- black screen with sound (HEVC / 10-bit video the browser can't show) ----
  // Time moves and sound plays but no picture was ever decoded: remember it
  // for this kind of video and draw the picture with our own decoder.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !tracks || !candidate || tracks.container !== "mkv" || !pictureCapable()) return;
    if (pictureKeyRef.current === key || pictureFailedRef.current.has(key)) return;
    let t0 = -1;
    const timer = window.setInterval(() => {
      if (engineRef.current || busyRef.current || v.paused || v.seeking || v.readyState < 2) { t0 = -1; return; }
      const frames = (v as any).getVideoPlaybackQuality?.()?.totalVideoFrames;
      const showing = v.videoWidth > 0 && (typeof frames !== "number" || frames > 0);
      if (showing) { window.clearInterval(timer); return; }
      if (t0 < 0) { t0 = v.currentTime; return; }
      // Hidden tabs report no frames; give a slow phone decoder time too.
      if (document.visibilityState !== "visible") { t0 = -1; return; }
      if (v.currentTime - t0 < 2.5) return;
      window.clearInterval(timer);
      const family = videoFamily(tracks.videoMime);
      markBlackPicture(key);
      startPicture(`${family || "video"}: sound only`);
    }, 400);
    return () => window.clearInterval(timer);
  }, [candidate, key, startPicture, tracks, videoRef]);

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
          const text = uniqueLines(findActive(textCues.current.get(activeSubtitle), t).map((c) => c.text));
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
  return { available, tracks, activeAudio, activeSubtitle, busy, holding, pictureMode, engineActive, ownsRef, subtitleText, bitmapCue, selectAudio, selectSubtitle };
}
