/// <reference lib="webworker" />
// Decodes Dolby/DTS/TrueHD audio off the main thread (see pcmFeeder.ts).
import createRsAudio from "./wasm/rsaudio.mjs";
import wasmUrl from "./wasm/rsaudio.wasm?url";
import { PcmFeeder, type DecoderOpen, type EncodedFrame } from "./pcmFeeder";

type Msg =
  | { type: "open"; id: number; cfg: DecoderOpen }
  | { type: "reset"; id: number }
  | { type: "push"; id: number; frames: EncodedFrame[]; final?: boolean }
  | { type: "close"; id: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let feeder: Promise<PcmFeeder> | null = null;
const getFeeder = () => (feeder ||= createRsAudio({ locateFile: () => wasmUrl }).then((m) => new PcmFeeder(m)));

ctx.onmessage = async (event: MessageEvent<Msg>) => {
  const msg = event.data;
  try {
    const f = await getFeeder();
    if (msg.type === "open") { const ok = f.open(msg.cfg); ctx.postMessage({ id: msg.id, ok }); return; }
    if (msg.type === "reset") { f.reset(); ctx.postMessage({ id: msg.id, ok: true }); return; }
    if (msg.type === "close") { f.close(); ctx.postMessage({ id: msg.id, ok: true }); return; }
    const out = f.push(msg.frames, !!msg.final);
    ctx.postMessage({ id: msg.id, ok: true, fragments: out }, out.map((b) => b.buffer));
  } catch (error) {
    ctx.postMessage({ id: msg.id, ok: false, error: String((error as Error)?.message || error) });
  }
};
