// @ts-nocheck
// ============================================================
// Lovable Cloud / Supabase Edge Function — HTTPS Protection (v1)
// Same logic as cloudflare-workers/https-protection.js (dual-deploy).
// ============================================================
// Hides the real HTTPS video server behind short-lived, encrypted,
// viewer-bound play links.
//
//   POST /sign   { urls: ["https://server/file.mp4", ...] }
//        → { links: ["https://<worker>/v/<token>/file.mp4", ...], exp }
//        Only accepted from ALLOWED_ORIGINS.
//   GET  /v/<token>/<name>
//        → streams the real file (range + HLS playlist rewrite).
//
// Every link is AES-GCM encrypted (the real URL / domain is never visible),
// bound to the viewer's IP, expires after LINK_TTL_SEC, and refuses to play
// when embedded on a foreign website (Referer / Origin check).
//
// Deploy to YOUR OWN Supabase project (EGD Manager) — not Lovable Cloud.
// Secrets:  PROTECT_KEY      (required — any long random string)
// Optional: ALLOWED_ORIGINS  comma list, e.g. "https://rsanime03.lovable.app"
//           ALLOWED_HOSTS    comma list of your video server hosts (sign allow-list)
//           LINK_TTL_SEC     default 14400 (4h)
//           BIND_IP          "0" to disable IP binding
// ============================================================

const DEFAULT_ORIGINS = [
  "https://rsanime03.lovable.app",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:8080",
];
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase().replace(/\/+$/, "")).filter(Boolean);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

let keyCache = null;
async function getKey(secret) {
  if (keyCache && keyCache.s === secret) return keyCache.k;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const k = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache = { s: secret, k };
  return k;
}
async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(secret), new TextEncoder().encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64u(out);
}
async function open(secret, token) {
  try {
    const bytes = unb64u(token);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await getKey(secret), bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}

const originOf = (v) => { try { const u = new URL(v); return `${u.protocol}//${u.host}`.toLowerCase(); } catch { return ""; } };
const isAllowedOrigin = (origin, allowed) => {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  // Lovable preview hosts of this project
  return /^https:\/\/[a-z0-9-]+\.lovable\.app$/.test(origin) && allowed.some((a) => a.endsWith(".lovable.app"));
};
const clientIp = (req) => req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
const fileName = (u) => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || "video") .replace(/[^\w.\-]+/g, "_").slice(-80) || "video"; } catch { return "video"; } };

// deno-lint-ignore no-explicit-any
async function handle(req: Request, env: any) {
  const raw = new URL(req.url);
  const pub = String(env.PUBLIC_BASE || "").replace(/\/+$/, "");
  const path = raw.pathname.replace(/^\/(?:functions\/v1\/)?https-protection/, "") || "/";
  const url = pub ? new URL(pub + path + raw.search) : raw;
  if (pub) Object.defineProperty(url, "pathname", { value: path });
  const secret = env.PROTECT_KEY;
  const allowed = [...DEFAULT_ORIGINS, ...list(env.ALLOWED_ORIGINS)];
  const reqOrigin = originOf(req.headers.get("origin") || "") || originOf(req.headers.get("referer") || "");
  const cors = {
    "Access-Control-Allow-Origin": isAllowedOrigin(reqOrigin, allowed) ? reqOrigin : allowed[0],
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, range",
    "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type",
    "Vary": "Origin",
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!secret) return json({ error: "PROTECT_KEY not configured" }, 500);
  const bindIp = String(env.BIND_IP ?? "1") !== "0";
  const ip = clientIp(req);

  if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "https-protection", v: 1 });

  if (url.pathname === "/sign" && req.method === "POST") {
    if (!isAllowedOrigin(originOf(req.headers.get("origin") || ""), allowed)) return json({ error: "forbidden origin" }, 403);
    let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const urls = Array.isArray(body?.urls) ? body.urls.slice(0, 64) : [];
    const hosts = list(env.ALLOWED_HOSTS);
    const ttl = Math.min(Math.max(Number(env.LINK_TTL_SEC || 14400), 300), 86400);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const base = pub || `${url.protocol}//${url.host}`;
    const links = [];
    for (const raw of urls) {
      let u; try { u = new URL(String(raw)); } catch { links.push(""); continue; }
      if (u.protocol !== "https:" && u.protocol !== "http:") { links.push(""); continue; }
      if (hosts.length && !hosts.includes(u.host.toLowerCase())) { links.push(""); continue; }
      const t = await seal(secret, { u: u.toString(), e: exp, ip: bindIp ? ip : "", n: b64u(crypto.getRandomValues(new Uint8Array(6))) });
      links.push(`${base}/v/${t}/${fileName(u.toString())}`);
    }
    return json({ links, exp });
  }

  const m = url.pathname.match(/^\/v\/([A-Za-z0-9_-]+)/);
  if (m && (req.method === "GET" || req.method === "HEAD")) {
    const ref = originOf(req.headers.get("referer") || "") || originOf(req.headers.get("origin") || "");
    if (ref && !isAllowedOrigin(ref, allowed) && ref !== `${url.protocol}//${url.host}`) return new Response("Forbidden", { status: 403, headers: cors });
    const p = await open(secret, m[1]);
    if (!p?.u) return new Response("Invalid link", { status: 403, headers: cors });
    if (Date.now() / 1000 > Number(p.e || 0)) return new Response("Link expired", { status: 410, headers: cors });
    if (p.ip && p.ip !== ip) return new Response("Link locked to another viewer", { status: 403, headers: cors });

    const target = new URL(p.u);
    const h = { "User-Agent": UA, "Accept": "*/*", "Referer": `${target.protocol}//${target.host}/` };
    const range = req.headers.get("range"); if (range) h["Range"] = range;
    let up;
    try { up = await fetch(target.toString(), { method: req.method, headers: h, redirect: "follow" }); }
    catch { return new Response("Upstream unreachable", { status: 502, headers: cors }); }

    const ct = up.headers.get("content-type") || "";
    const out = new Headers(cors);
    if (/mpegurl/i.test(ct) || /\.m3u8(?:$|\?)/i.test(target.pathname)) {
      const text = await up.text();
      const base = pub || `${url.protocol}//${url.host}`;
      const sealUri = async (ref) => {
        const abs = new URL(ref, up.url || target.toString()).toString();
        const t = await seal(secret, { u: abs, e: p.e, ip: p.ip, n: p.n });
        return `${base}/v/${t}/${fileName(abs)}`;
      };
      const lines = [];
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) { lines.push(line); continue; }
        if (s.startsWith("#")) {
          const matches = [...line.matchAll(/URI="([^"]+)"/g)];
          let l = line;
          for (const mm of matches) l = l.replace(mm[0], `URI="${await sealUri(mm[1])}"`);
          lines.push(l);
        } else lines.push(await sealUri(s));
      }
      out.set("content-type", "application/vnd.apple.mpegurl");
      out.set("cache-control", "no-store");
      return new Response(lines.join("\n"), { status: up.status, headers: out });
    }
    for (const k of PASS) { const v = up.headers.get(k); if (v) out.set(k, v); }
    out.set("cache-control", "private, max-age=3600");
    out.set("x-content-type-options", "nosniff");
    return new Response(up.body, { status: up.status, headers: out });
  }
  return json({ error: "not found" }, 404);
}

const envObj = () => ({
  PROTECT_KEY: Deno.env.get("PROTECT_KEY") || Deno.env.get("SIGNING_SECRET"),
  ALLOWED_ORIGINS: Deno.env.get("ALLOWED_ORIGINS") || "",
  ALLOWED_HOSTS: Deno.env.get("ALLOWED_HOSTS") || "",
  LINK_TTL_SEC: Deno.env.get("LINK_TTL_SEC") || "14400",
  BIND_IP: Deno.env.get("BIND_IP") || "1",
  PUBLIC_BASE: `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/https-protection`,
});
Deno.serve((req) => handle(req, envObj()));
