/// <reference lib="webworker" />
// Software HEVC / H.264 picture decoding off the main thread (see pictureDecoder.ts).
// Normal path: attached to the painting worker over a MessagePort, it sends
// raw I420 planes in recycled buffers (no copies piling up, no GC pauses) —
// decoding and painting run on two separate threads, never on the busy page.
// Older browsers: pictures go back to the page as VideoFrames.
// One packet is decoded per task so a seek ("flush") is handled right away.
import createRsVideo from "./wasm/rsvideo.mjs";
import wasmUrl from "./wasm/rsvideo.wasm?url";
import { VideoFeeder, type DecodedPicture } from "./videoFeeder";
import { decoderThreads } from "./wasm/rsvideo-mt-config";

type Msg =
  | { type: "warm" }
  | { type: "port"; port: MessagePort }
  | { type: "open"; codec: "hevc" | "h264"; extra: Uint8Array | null; planes?: boolean }
  | { type: "decode"; gen: number; data: Uint8Array; pts: number }
  | { type: "flush"; gen: number }
  | { type: "skip"; level: number }
  | { type: "recycle"; buf: ArrayBuffer }
  | { type: "close" };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let out: { postMessage(m: unknown, t?: Transferable[]): void } = ctx;
let feeder: VideoFeeder | null = null;
let planes = false;
let modulePromise: ReturnType<typeof createRsVideo> | null = null;
// Inside the isolated decoder frame (isoFrame.ts) the multi-core build is
// used: several pictures are decoded at once on different cores.
const isolated = (self as any).crossOriginIsolated === true && typeof SharedArrayBuffer === "function";
const cores = Math.max(1, Number((self.navigator as any)?.hardwareConcurrency) || 1);
let threads = 1;
const loadSingle = () => createRsVideo({ locateFile: () => wasmUrl });
const loadModule = () => (modulePromise ||= (async () => {
  if (isolated && cores >= 3) {
    try {
      const [{ default: createMt }, { default: mtUrl }] = await Promise.all([import("./wasm/rsvideo-mt.mjs"), import("./wasm/rsvideo-mt.wasm?url")]);
      // The helper threads must start within a few seconds, or this phone gets the one-core decoder.
      const m = await Promise.race([
        createMt({ locateFile: () => mtUrl }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("threads did not start")), 8000)),
      ]);
      threads = decoderThreads(cores);
      return m;
    } catch (e) {
      out.postMessage({ type: "log", text: `multi-core decoder unavailable (${String((e as Error)?.message || e)})` });
    }
  }
  threads = 1;
  return loadSingle();
})());
let gen = 0;
const queue: Array<{ gen: number; data: Uint8Array; pts: number }> = [];
let pool: ArrayBuffer[] = [];

const send = (pic: DecodedPicture, g: number) => {
  if (planes) {
    const size = pic.data.length;
    let buf = pool.pop();
    while (buf && buf.byteLength !== size) buf = pool.pop(); // size changed: drop old buffers
    if (!buf) buf = new ArrayBuffer(size);
    new Uint8Array(buf).set(pic.data);
    out.postMessage({ type: "pic", gen: g, w: pic.width, h: pic.height, pts: pic.pts, buf }, [buf]);
    return;
  }
  const frame = new VideoFrame(pic.data, { format: "I420", codedWidth: pic.width, codedHeight: pic.height, timestamp: pic.pts });
  out.postMessage({ type: "frame", gen: g, frame }, [frame as unknown as Transferable]);
};

// A zero-delay task queue (setTimeout(0) is slowed down after a few nested calls).
const channel = new MessageChannel();
let scheduled = false;
const schedule = () => { if (!scheduled) { scheduled = true; channel.port2.postMessage(0); } };
channel.port1.onmessage = () => {
  scheduled = false;
  const job = queue.shift();
  if (!job) return;
  const started = performance.now();
  if (job.gen === gen && feeder) {
    try {
      feeder.decode(job.data, job.pts, (pic) => { if (job.gen === gen) send(pic, job.gen); });
    } catch (error) {
      out.postMessage({ type: "error", error: String((error as Error)?.message || error) });
    }
  }
  out.postMessage({ type: "done", gen: job.gen, ms: performance.now() - started });
  if (queue.length) schedule();
};

const handle = async (msg: Msg) => {
  switch (msg.type) {
    case "warm": loadModule().catch(() => { modulePromise = null; }); return;
    case "port": out = msg.port; msg.port.onmessage = (e: MessageEvent<Msg>) => { void handle(e.data); }; return;
    case "open":
      try {
        const m = await loadModule();
        feeder = new VideoFeeder(m);
        planes = !!msg.planes;
        out.postMessage({ type: "opened", ok: feeder.open(msg.codec, msg.extra, threads), threads });
      } catch (error) {
        out.postMessage({ type: "opened", ok: false, error: String((error as Error)?.message || error) });
      }
      return;
    case "decode": queue.push(msg); schedule(); return;
    case "flush": gen = msg.gen; queue.length = 0; feeder?.flush(); return;
    case "skip": feeder?.setSkip(msg.level); return;
    case "recycle": if (pool.length < 12) pool.push(msg.buf); return;
    case "close": queue.length = 0; pool = []; feeder?.close(); feeder = null; ctx.close();
  }
};
ctx.onmessage = (event: MessageEvent<Msg>) => { void handle(event.data); };
