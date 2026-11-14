// ============================================================
// Multi-core software decoder through the isolated frame (page side)
// ============================================================
// Browsers only allow a decoder to use several cores in a cross-origin
// isolated document. Isolating the whole site would change how ads, sign-in
// pop-ups and images load, so only a hidden same-origin frame is isolated
// (Document-Isolation-Policy, added by /rs-iso/isolate-worker.js whose scope is
// that folder only). Where the browser can't do this, the normal one-core
// decoder worker on the page is used — nothing else changes.

/** What the picture decoder needs from a decoder worker. */
export interface DecoderHandle {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onerror: ((e: { message: string }) => void) | null;
  readonly isolated: boolean;
}

const FRAME_URL = "/rs-iso/frame.html";
const SW_URL = "/rs-iso/isolate-worker.js";
const SCOPE = "/rs-iso/";

let frame: HTMLIFrameElement | null = null;
let preparing: Promise<boolean> | null = null;
let ready = false;
let nextId = 1;
const handles = new Map<number, DecoderHandle>();

const supported = () =>
  typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator &&
  window.isSecureContext && typeof Worker !== "undefined" && typeof WebAssembly === "object";

const activeWorker = async (timeoutMs: number): Promise<boolean> => {
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (reg.active && reg.active.state === "activated") return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !!reg.active;
};

const onMessage = (e: MessageEvent<any>) => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m?.type === "rs-iso-error") handles.get(m.id)?.onerror?.({ message: String(m.message || "software decoder crashed") });
};

/** Starts the isolated frame once; resolves true when multi-core decoding is available. */
export function prepareIsolatedDecoder(timeoutMs = 6000): Promise<boolean> {
  if (preparing) return preparing;
  if (!supported()) return (preparing = Promise.resolve(false));
  preparing = (async () => {
    try {
      if (!(await activeWorker(timeoutMs))) return false;
      const f = document.createElement("iframe");
      f.setAttribute("aria-hidden", "true");
      f.tabIndex = -1;
      f.title = "decoder";
      f.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none;";
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { window.removeEventListener("message", first); resolve(false); }, timeoutMs);
        const first = (e: MessageEvent<any>) => {
          if (e.origin !== location.origin || e.source !== f.contentWindow || e.data?.type !== "rs-iso-ready") return;
          clearTimeout(timer);
          window.removeEventListener("message", first);
          resolve(e.data.isolated === true);
        };
        window.addEventListener("message", first);
        f.src = FRAME_URL;
        document.body.appendChild(f);
      });
      if (!ok) { f.remove(); return false; }
      frame = f;
      window.addEventListener("message", onMessage);
      ready = true;
      return true;
    } catch {
      return false;
    }
  })();
  return preparing;
}

export const isolatedDecoderReady = () => ready;

/** A decoder worker living in the isolated frame (null when not available). */
export function spawnIsolatedDecoder(warm = false): DecoderHandle | null {
  const win = frame?.contentWindow;
  if (!ready || !win) return null;
  const id = nextId++;
  const handle: DecoderHandle = {
    isolated: true,
    onerror: null,
    postMessage(msg: unknown, transfer: Transferable[] = []) {
      try { frame?.contentWindow?.postMessage({ type: "rs-iso-msg", id, msg }, location.origin, transfer); }
      catch (e) { handle.onerror?.({ message: String((e as Error)?.message || e) }); }
    },
    terminate() {
      handles.delete(id);
      try { frame?.contentWindow?.postMessage({ type: "rs-iso-kill", id }, location.origin); } catch { /* ignore */ }
    },
  };
  handles.set(id, handle);
  win.postMessage({ type: "rs-iso-spawn", id, warm }, location.origin);
  return handle;
}
