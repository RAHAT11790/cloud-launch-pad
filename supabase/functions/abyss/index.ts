// ============================================================
// RS Anime — Abyss resolver + stream relay
// ------------------------------------------------------------
// GET /abyss/resolve?id=<slug|url>  → { ok, title, sources:[{label,url,size}] }
// GET /abyss/stream?src=<b64url>    → Range-aware MP4 relay (sends the Referer
//                                     the Abyss CDN requires, so the file plays
//                                     inside OUR player — no iframe, no ads).
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PLAYER_ORIGIN = "https://player.abyssplayer.com";
const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---- MD5 (bug-compatible with the `md5` npm package the player uses: a
// number input is hashed as its digit VALUES, not ASCII) ----
function md5Bytes(bytes: number[]): string {
  const K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = bytes.length;
  const withPad = [...bytes, 0x80];
  while (withPad.length % 64 !== 56) withPad.push(0);
  const bitLen = len * 8;
  for (let i = 0; i < 8; i++) withPad.push(i < 4 ? (bitLen >>> (8 * i)) & 255 : 0);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < withPad.length; o += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++)
      M[i] = withPad[o + i * 4] | (withPad[o + i * 4 + 1] << 8) | (withPad[o + i * 4 + 2] << 16) | (withPad[o + i * 4 + 3] << 24);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0]
    .map((w) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255).toString(16).padStart(2, "0")).join(""))
    .join("");
}
const keyHex = (k: string | number) =>
  typeof k === "number"
    ? md5Bytes(Array.from(String(k), (c) => Number(c)))
    : md5Bytes(Array.from(new TextEncoder().encode(k)));

async function aesCtr(k: string | number, data: Uint8Array, decrypt: boolean): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(keyHex(k));
  const alg = { name: "AES-CTR", counter: raw.slice(0, 16), length: 128 };
  const key = await crypto.subtle.importKey("raw", raw, alg, false, ["encrypt", "decrypt"]);
  const out = decrypt ? await crypto.subtle.decrypt(alg, key, data) : await crypto.subtle.encrypt(alg, key, data);
  return new Uint8Array(out);
}
const bin = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))));
};

function extractSlug(input: string): string {
  const v = String(input || "").trim();
  const m = v.match(/abyss(?:player|cdn)?\.(?:com|to)\/(?:\?v=)?([A-Za-z0-9_-]{6,})/i) || v.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{6,}$/.test(v) ? v : "";
}

async function resolve(slug: string, streamPrefix: string) {
  const res = await fetch(`${PLAYER_ORIGIN}/${slug}`, {
    headers: { "User-Agent": UA, Referer: "https://abyss.to/", Accept: "text/html" }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`player page ${res.status}`);
  const html = await res.text();
  const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] || "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const datas = html.match(/const datas = "([^"]+)"/)?.[1];
  if (!datas) throw new Error("video not found or removed");
  const d = JSON.parse(atob(datas));
  const mediaBytes = Uint8Array.from(String(d.media), (c) => c.charCodeAt(0) & 255);
  const media = JSON.parse(new TextDecoder().decode(await aesCtr(`${d.user_id}:${d.slug}:${d.md5_id}`, mediaBytes, true)));
  const { sources = [], domains = [] } = media?.mp4 || {};
  const out: { label: string; url: string; size: number }[] = [];
  for (const s of sources) {
    if (!s?.size || s.status === false || s.codec === "av1") continue;
    const dom = domains.find((x: string) => x.includes(s.sub));
    if (!dom) continue;
    const plain = new TextEncoder().encode(`/mp4/${d.md5_id}/${s.res_id}/${s.size}?v=${d.slug}`);
    const enc = await aesCtr(Number(s.size), plain, false);
    const tok = btoa(btoa(bin(enc)).replace(/=/g, "")).replace(/=/g, "");
    const upstream = `https://${dom}/sora/${s.size}/${tok}`;
    out.push({ label: s.label, url: upstream, size: Number(s.size) });
  }
  // Keep only qualities the CDN actually serves (some tiers 404 for free hosts).
  const checked = await Promise.all(
    out.map(async (s) => {
      try {
        const r = await fetch(s.url, { headers: { "User-Agent": UA, Referer: `${PLAYER_ORIGIN}/`, Range: "bytes=0-1" }, signal: AbortSignal.timeout(8000) });
        try { await r.body?.cancel(); } catch { /* ignore */ }
        return r.status === 206 || r.status === 200 ? s : null;
      } catch { return null; }
    }),
  );
  const ok = checked.filter(Boolean) as typeof out;
  ok.sort((a, b) => parseInt(a.label) - parseInt(b.label));
  return {
    title,
    sources: ok.map((s) => ({ label: s.label, size: s.size, url: `${streamPrefix}?src=${b64u(s.url)}` })),
  };
}

async function stream(req: Request, target: string) {
  const u = new URL(target);
  if (!/\.sssrr\.org$|\.trycloudflare\.com$/i.test(u.hostname)) return json({ error: "host not allowed" }, 400);
  const headers: Record<string, string> = { "User-Agent": UA, Referer: `${PLAYER_ORIGIN}/`, Accept: "video/*,*/*" };
  const range = req.headers.get("range");
  if (range) headers.Range = range;
  const up = await fetch(u.toString(), { method: req.method === "HEAD" ? "HEAD" : "GET", headers, redirect: "follow" });
  const h = new Headers(cors);
  for (const k of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = up.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("content-type", "video/mp4");
  h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=3600");
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers: h });
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const url = new URL(req.url);
    const tail = url.pathname.split("/abyss")[1] || url.pathname;
    const base = /(?:^|\.)supabase\.co$/i.test(url.hostname)
      ? `https://${url.host}/functions/v1/abyss`
      : `${url.origin}${url.pathname.replace(/\/(resolve|stream)\/?$/, "")}`;
    if (/\/stream\/?$/.test(tail)) {
      const src = url.searchParams.get("src") || "";
      if (!src) return json({ error: "missing src" }, 400);
      return await stream(req, fromB64u(src));
    }
    if (/\/resolve\/?$/.test(tail)) {
      const slug = extractSlug(url.searchParams.get("id") || url.searchParams.get("url") || "");
      if (!slug) return json({ ok: false, error: "invalid abyss link" }, 400);
      const r = await resolve(slug, `${base}/stream`);
      return json({ ok: r.sources.length > 0, slug, ...r, embed: `${PLAYER_ORIGIN}/${slug}` });
    }
    return json({ ok: true, service: "rs-abyss", endpoints: ["/resolve?id=", "/stream?src="] });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 502);
  }
}

Deno.serve(handler);
