// ============================================================
// Isolated decoder frame (runs inside /rs-iso/frame.html)
// ============================================================
// The page itself stays a normal page (ads, sign-in pop-ups, images unchanged).
// Only this hidden same-origin frame is cross-origin isolated (its own
// service worker adds Document-Isolation-Policy), so the built-in video
// decoder started from here may use several processor cores at once.
// The page talks to the decoder workers through this frame; pictures go
// straight from the decoder to the page's painting worker over a MessagePort.

const isolated = (self as any).crossOriginIsolated === true && typeof SharedArrayBuffer === "function";
const workers = new Map<number, Worker>();
const origin = location.origin;
const reply = (m: unknown) => { try { parent.postMessage(m, origin); } catch { /* page gone */ } };

window.addEventListener("message", (e: MessageEvent<any>) => {
  if (e.origin !== origin || e.source !== parent) return;
  const m = e.data;
  if (!m || typeof m.type !== "string") return;
  if (m.type === "rs-iso-spawn") {
    try {
      const w = new Worker(new URL("./videoDecode.worker.ts", import.meta.url), { type: "module" });
      w.onerror = (ev) => reply({ type: "rs-iso-error", id: m.id, message: ev.message || "software decoder crashed" });
      workers.set(m.id, w);
      if (m.warm) w.postMessage({ type: "warm" });
    } catch (err) {
      reply({ type: "rs-iso-error", id: m.id, message: String((err as Error)?.message || err) });
    }
    return;
  }
  if (m.type === "rs-iso-msg") {
    const w = workers.get(m.id);
    if (!w) return;
    const transfer: Transferable[] = m.msg?.port ? [m.msg.port] : [];
    w.postMessage(m.msg, transfer);
    return;
  }
  if (m.type === "rs-iso-kill") {
    const w = workers.get(m.id);
    workers.delete(m.id);
    try { w?.terminate(); } catch { /* ignore */ }
  }
});

reply({ type: "rs-iso-ready", isolated, cores: navigator.hardwareConcurrency || 0 });
