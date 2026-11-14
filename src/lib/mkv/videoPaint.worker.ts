/// <reference lib="webworker" />
// Decodes (or receives) and paints the picture on an OffscreenCanvas, on the
// sound's clock (PictureCore). Off the page entirely, so menus, ads and
// scrolling never delay or drop a picture.
//   1. the phone's own hardware decoder (WebCodecs VideoDecoder, right here);
//   2. otherwise the built-in software decoder in its own worker, whose raw
//      planes arrive over a MessagePort in recycled buffers.
// Both are painted with WebGL (GPU colour conversion).
import { PictureCore, type Chunk, type CoreBackend, type Pic } from "./pictureCore";
import { YuvPainter } from "./yuvPainter";

type Msg =
  | { type: "open"; canvas: OffscreenCanvas; port: MessagePort; frameUs: number; codec: "hevc" | "h264"; extra: Uint8Array | null; hw: VideoDecoderConfig | null }
  | { type: "chunk"; data: Uint8Array; pts: number; key: boolean }
  | { type: "clock"; t: number; rate: number; running: boolean; at: number }
  | { type: "reset"; t: number; gen: number }
  | { type: "port"; port: MessagePort }
  | { type: "close" };

/** A software picture (I420 planes) or a hardware VideoFrame. */
type AnyPic = Pic & { frame?: VideoFrame; width?: number; height?: number; data?: Uint8Array };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let core: PictureCore<AnyPic> | null = null;
let painter: YuvPainter | null = null;
let port: MessagePort | null = null;
let openMsg: Extract<Msg, { type: "open" }> | null = null;
let portWaiter: (() => void) | null = null;
let resetGen = 0;
let lastReset = 0;
let tickHandle: ReturnType<typeof setTimeout> | null = null;
let stateTimer: ReturnType<typeof setInterval> | null = null;
let clockState = { t: 0, rate: 1, running: false, at: 0 };
const wallMs = () => performance.timeOrigin + performance.now();

const clock = {
  now() {
    const c = clockState;
    if (!c.running) return c.t * 1e6;
    const ahead = Math.min(2000, Math.max(0, wallMs() - c.at)); // the page may be busy for a moment
    return (c.t + (ahead / 1000) * c.rate) * 1e6;
  },
  running: () => clockState.running,
  rate: () => clockState.rate,
};

const wrapFrame = (f: VideoFrame): AnyPic => ({ timestamp: f.timestamp, frame: f, close: () => f.close() });

// ---------- phone hardware decoder ----------
const hardwareBackend = async (config: VideoDecoderConfig): Promise<CoreBackend | null> => {
  const VD = (ctx as any).VideoDecoder as typeof VideoDecoder | undefined;
  if (!VD) return null;
  const ok = await VD.isConfigSupported(config).then((r) => !!r.supported).catch(() => false);
  if (!ok) return null;
  let dec: VideoDecoder;
  try {
    dec = new VD({
      output: (f) => { if (core) core.onFrame(wrapFrame(f)); else f.close(); },
      error: (e) => { void hardwareFailed(String((e as Error)?.message || e)); },
    });
    dec.configure(config);
  } catch { return null; }
  return {
    kind: "hardware",
    pending: () => (dec.state === "configured" ? dec.decodeQueueSize : 0),
    decode(c: Chunk) { if (dec.state === "configured") dec.decode(new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: c.pts, data: c.data })); },
    reset() { try { dec.reset(); dec.configure(config); } catch { /* closed */ } },
    setSkip() { /* hardware keeps up */ },
    close() { try { dec.close(); } catch { /* ignore */ } },
  } as CoreBackend & { close(): void };
};

// ---------- built-in software decoder (other worker) ----------
let decGen = 1;
/** Cores the software decoder uses (more than 1 inside the isolated frame). */
let decoderThreads = 1;
let inflight = 0;
const softwareBackend = (): Promise<CoreBackend> => new Promise((resolve, reject) => {
  const m0 = openMsg!;
  const backend: CoreBackend = {
    kind: "software",
    pending: () => inflight,
    decode(c: Chunk) { inflight += 1; port?.postMessage({ type: "decode", gen: decGen, data: c.data, pts: c.pts }, [c.data.buffer]); },
    reset() { decGen += 1; inflight = 0; port?.postMessage({ type: "flush", gen: decGen }); },
    setSkip(level: number) { port?.postMessage({ type: "skip", level }); },
  };
  port!.onmessage = (e: MessageEvent<any>) => {
    const m = e.data;
    if (m.type === "pic") {
      const buf: ArrayBuffer = m.buf;
      const pic: AnyPic = {
        timestamp: m.pts, width: m.w, height: m.h, data: new Uint8Array(buf),
        close: () => { try { port?.postMessage({ type: "recycle", buf }, [buf]); } catch { /* closed */ } },
      };
      if (m.gen === decGen && core) core.onFrame(pic); else pic.close();
      return;
    }
    if (m.type === "done") {
      if (m.gen === decGen) {
        inflight = Math.max(0, inflight - 1);
        if (core) core.stats.decodeMs = Math.round(core.stats.decodeMs * 0.9 + m.ms * 0.1);
        core?.feed();
      }
      return;
    }
    if (m.type === "opened") { decoderThreads = Number(m.threads) || 1; if (m.ok) resolve(backend); else reject(new Error(m.error || "software decoder could not open this video")); return; }
    if (m.type === "error") ctx.postMessage({ type: "error", error: m.error });
  };
  port!.postMessage({ type: "open", codec: m0.codec, extra: m0.extra, planes: true });
});

/** A hardware decoder that breaks mid-way hands over to the software one. */
let switching = false;
const hardwareFailed = async (why: string) => {
  if (!core || core.backend?.kind !== "hardware" || switching) return;
  switching = true;
  ctx.postMessage({ type: "log", text: `hardware decoder failed (${why}), using the built-in decoder` });
  try { (core.backend as CoreBackend & { close?: () => void }).close?.(); } catch { /* ignore */ }
  core.backend = null;
  try {
    // The page started no software decoder for a hardware phone: ask for one.
    if (!port) {
      const got = new Promise<void>((resolve) => { portWaiter = resolve; });
      ctx.postMessage({ type: "needDecoder" });
      await got;
    }
    const sw = await softwareBackend();
    if (!core) return;
    core.backend = sw;
    core.reset(lastReset >= 0 ? clock.now() / 1e6 : 0); // picture resumes at the next keyframe
    ctx.postMessage({ type: "kind", kind: "software" });
  } catch (e) {
    ctx.postMessage({ type: "error", error: String((e as Error)?.message || e) });
  } finally { switching = false; }
};

const postState = () => {
  if (core) ctx.postMessage({ type: "state", gen: resetGen, shown: core.shownSeconds, skip: core.skip, ready: core.ready, stats: core.stats, painter: painter?.kind, decoder: core.backend?.kind, threads: core.backend?.kind === "software" ? decoderThreads : 0 });
};

// Wakes up right when the next picture is due.
const loop = () => {
  if (!core) return;
  core.tick();
  tickHandle = setTimeout(loop, core.msToNext());
};

ctx.onmessage = async (event: MessageEvent<Msg>) => {
  const msg = event.data;
  switch (msg.type) {
    case "open": {
      openMsg = msg;
      port = msg.port;
      painter = new YuvPainter(msg.canvas);
      const p = painter;
      core = new PictureCore<AnyPic>(msg.frameUs, clock, (pic) => {
        if (pic.frame) p.paintFrame(pic.frame);
        else p.paint(pic as Required<Pic & { width: number; height: number; data: Uint8Array }>);
      }, () => { postState(); ctx.postMessage({ type: "ready", gen: resetGen }); });
      try {
        const backend = (msg.hw && (await hardwareBackend(msg.hw))) || (await softwareBackend());
        if (!core) return;
        core.backend = backend;
        if (backend.kind === "hardware") { try { port?.postMessage({ type: "close" }); } catch { /* ignore */ } port = null; }
        loop();
        stateTimer = setInterval(postState, 250);
        ctx.postMessage({ type: "opened", ok: true, kind: backend.kind });
      } catch (e) {
        ctx.postMessage({ type: "opened", ok: false, error: String((e as Error)?.message || e) });
      }
      return;
    }
    case "port": port = msg.port; portWaiter?.(); portWaiter = null; return;
    case "chunk": core?.push({ data: msg.data, pts: msg.pts, key: msg.key }); return;
    case "clock": clockState = { t: msg.t, rate: msg.rate, running: msg.running, at: msg.at }; return;
    case "reset": resetGen = msg.gen; lastReset = msg.t; core?.reset(msg.t); return;
    case "close":
      if (tickHandle) clearTimeout(tickHandle);
      if (stateTimer) clearInterval(stateTimer);
      try { (core?.backend as (CoreBackend & { close?: () => void }) | null)?.close?.(); } catch { /* ignore */ }
      core?.close(); core = null;
      try { port?.postMessage({ type: "close" }); } catch { /* ignore */ }
      port = null;
      ctx.close();
  }
};
