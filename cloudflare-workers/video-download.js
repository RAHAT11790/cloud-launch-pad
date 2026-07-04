// 🆕 NEW v3 (2026-07-04) — Opaque src token + clean HEAD/GET response. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// Cloudflare Worker — video-download (CF-native)
// Clean single-shot download proxy with attachment Content-Disposition.
// Usage: /?src=<OPAQUE_URL_TOKEN>&filename=<ENCODED_NAME>
// ============================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-type, content-disposition, accept-ranges",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const fromOpaqueUrlToken = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
};

function safeName(n) {
  return String(n || "video.mp4").replace(/[\r\n"]/g, "").slice(0, 180);
}

async function tryFetch(url, headers, method) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method, headers, redirect: "follow" });
      if (r.ok || r.status === 206) return r;
      if (r.status >= 500) { await new Promise((res) => setTimeout(res, 300 * (i + 1))); continue; }
      return r;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((res) => setTimeout(res, 300 * (i + 1)));
    }
  }
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    const target = u.searchParams.get("url") || fromOpaqueUrlToken(u.searchParams.get("src") || "");
    const filename = safeName(u.searchParams.get("filename") || "video.mp4");
    if (!target) return new Response("Missing ?url=", { status: 400, headers: cors });
    let up;
    try { up = new URL(target); } catch { return new Response("Invalid url", { status: 400, headers: cors }); }

    const origin = `${up.protocol}//${up.host}`;
    const headers = {
      "User-Agent": UA,
      Accept: "*/*",
      "Accept-Encoding": "identity",
      Referer: `${origin}/`,
      Origin: origin,
    };
    const range = req.headers.get("range");
    if (range) headers.range = range;

    let res;
    try { res = await tryFetch(up.toString(), headers, req.method); }
    catch (e) { return new Response(`Upstream error: ${e?.message || e}`, { status: 502, headers: cors }); }
    if (!res.ok && res.status !== 206) {
      try { await res.body?.cancel(); } catch {}
      return new Response(JSON.stringify({ error: "Download source error", upstreamStatus: res.status }), {
        status: 502,
        headers: { ...cors, "content-type": "application/json" },
      });
    }

    const out = new Headers(cors);
    for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = res.headers.get(k); if (v) out.set(k, v);
    }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    if (!out.has("content-type")) out.set("content-type", "application/octet-stream");
    out.set("content-disposition", `attachment; filename="${filename}"`);
    out.set("Cross-Origin-Resource-Policy", "cross-origin");

    return new Response(req.method === "HEAD" ? null : res.body, { status: res.status, headers: out });
  },
};
