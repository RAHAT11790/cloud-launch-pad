// ============================================================
// an-api — NEW ultra-fast AnimeSalt extractor (NO subtitle logic)
// ============================================================
// Endpoints:
//   GET  /                       → endpoint list
//   GET  /search?q=naruto        → [{slug,title,poster,year,type}]
//   GET  /anime?slug=&type=series→ detail + seasons/episodes
//   GET  /episode?slug=naruto-1x1→ embed + HLS streams/audio only
//   GET  /embed?url=<embed-url>  → HLS streams/audio only
//   GET  /hls?url=<m3u8/segment> → CORS HLS passthrough
//   POST {url} / {action,slug}   → backward-compatible app mode
//
// Subtitle extraction/proxy was intentionally removed. This restores the
// stable AN behavior: episode extraction first, playback URLs fast, no CC work.
// ============================================================

const AN_BASE = "https://animesalt.ac";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TEXT_TIMEOUT_MS = 9_000;
const PLAYER_TIMEOUT_MS = 8_000;
const cache = new Map<string, { ts: number; ttl: number; data: unknown }>();
const getCache = <T>(key: string): T | null => {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.ts > hit.ttl) {
    if (hit) cache.delete(key);
    return null;
  }
  return hit.data as T;
};
const setCache = (key: string, data: unknown, ttl: number) => {
  cache.set(key, { ts: Date.now(), ttl, data });
  if (cache.size > 300) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return data;
};

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const decode = (s: string) =>
  String(s || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

const resolveUrl = (value: string, baseUrl: string) => {
  const raw = decode(value);
  if (!raw) return "";
  try { return new URL(raw, baseUrl).toString(); } catch { return raw; }
};

function safeAtob(value: string): string {
  try { return atob(value); } catch {}
  try { return atob(value.replace(/-/g, "+").replace(/_/g, "/")); } catch {}
  return "";
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const target = new URL(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TEXT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: target.origin === AN_BASE ? `${AN_BASE}/` : `${target.origin}/`,
        ...(init?.headers || {}),
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseHlsAttrs(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) attrs[m[1].toUpperCase()] = String(m[2] || "").replace(/^"|"$/g, "");
  return attrs;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- SEARCH ----------
async function search(q: string) {
  const cacheKey = `search:${q.toLowerCase().trim()}`;
  const cached = getCache<any[]>(cacheKey);
  if (cached) return cached;
  const html = await fetchText(`${AN_BASE}/?s=${encodeURIComponent(q)}`);
  const out: any[] = [];
  const seen = new Set<string>();
  const itemRe = /<li[^>]*class=["'][^"']*post-\d+[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(html))) {
    const block = item[1];
    const hrefM = block.match(/href=["']https?:\/\/animesalt\.(?:ac|top)\/(series|movies)\/([^"'/?#]+)\/?["']/i);
    if (!hrefM) continue;
    const type = hrefM[1] === "movies" ? "movies" : "series";
    const slug = hrefM[2];
    if (!slug || seen.has(`${type}:${slug}`)) continue;
    seen.add(`${type}:${slug}`);
    const titleM = block.match(/<h[1-4][^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i) || block.match(/(?:title|alt)=["']([^"']+)["']/i);
    const imgM = block.match(/(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i);
    const yearM = block.match(/annee-(\d{3,4})/i) || block.match(/(?:19|20)\d{2}/);
    out.push({
      slug,
      type,
      title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "),
      poster: imgM ? resolveUrl(imgM[1], AN_BASE) : "",
      year: yearM ? (yearM[1] || yearM[0]).replace(/^annee-/, "") : "",
      detailUrl: `${AN_BASE}/${type}/${slug}/`,
    });
  }

  // Fallback for layout changes: scan all result links.
  if (out.length === 0) {
    const hrefRe = /href=["']https?:\/\/animesalt\.(?:ac|top)\/(series|movies)\/([^"'/?#]+)\/?["'][\s\S]{0,900}/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html))) {
      const type = m[1] === "movies" ? "movies" : "series";
      const slug = m[2];
      if (!slug || seen.has(`${type}:${slug}`)) continue;
      seen.add(`${type}:${slug}`);
      const block = m[0];
      const titleM = block.match(/(?:title|alt)=["']([^"']+)["']/i) || block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const imgM = block.match(/(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i);
      const yearM = block.match(/(?:19|20)\d{2}/);
      out.push({ slug, type, title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "), poster: imgM ? resolveUrl(imgM[1], AN_BASE) : "", year: yearM?.[0] || "", detailUrl: `${AN_BASE}/${type}/${slug}/` });
    }
  }
  return setCache(cacheKey, out, 15 * 60_000) as any[];
}

// ---------- DETAIL / EPISODES ----------
async function detail(slug: string, type: string) {
  const t = type === "movies" ? "movies" : "series";
  const cacheKey = `detail:${t}:${slug}`;
  const cached = getCache<any>(cacheKey);
  if (cached) return cached;
  const html = await fetchText(`${AN_BASE}/${t}/${slug}/`);
  const titleM = html.match(/<meta property=["']og:title["'] content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
  const posterM = html.match(/<meta property=["']og:image["'] content=["']([^"']+)/i);
  const descM = html.match(/<meta name=["']description["'] content=["']([^"']+)/i) || html.match(/<meta property=["']og:description["'] content=["']([^"']+)/i);

  const seasons = new Map<string, { name: string; episodes: any[] }>();
  const seen = new Set<string>();
  const epRe = /href=["']https?:\/\/animesalt\.(?:ac|top)\/episode\/([^"'/?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = epRe.exec(html))) {
    const epSlug = m[1];
    if (!epSlug || seen.has(epSlug)) continue;
    seen.add(epSlug);
    const sx = epSlug.match(/(\d+)x(\d+)$/i);
    const seasonNum = sx ? Number(sx[1]) : 1;
    const epNum = sx ? Number(sx[2]) : seen.size;
    const key = `Season ${seasonNum}`;
    if (!seasons.has(key)) seasons.set(key, { name: key, episodes: [] });
    seasons.get(key)!.episodes.push({ number: epNum, episodeNumber: epNum, title: decode(m[2]) || `Episode ${epNum}`, slug: epSlug, link: `animesalt://${epSlug}` });
  }

  const seasonsArr = Array.from(seasons.values()).map((s) => ({
    name: s.name,
    episodes: s.episodes.sort((a, b) => a.number - b.number),
  }));

  return setCache(cacheKey, {
    slug,
    type: t,
    title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "),
    poster: posterM ? resolveUrl(posterM[1], AN_BASE) : "",
    storyline: descM ? decode(descM[1]) : "",
    seasons: seasonsArr,
    episodeCount: seasonsArr.reduce((n, s) => n + s.episodes.length, 0),
  }, 60 * 60_000);
}

// ---------- STREAM EXTRACTION ----------
function collectEmbedsFromHtml(html: string): string[] {
  const out = new Set<string>();
  const push = (value: string) => {
    const raw = decode(value || "");
    const abs = raw.startsWith("//") ? `https:${raw}` : raw;
    if (/^https?:\/\/[^\s"'<>]+\/video\/[a-f0-9]{16,}/i.test(abs)) out.add(abs);
  };

  const attrRe = /(?:src|data-src|data-embed|data-player|data-video|href)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) push(m[1]);

  const anyRe = /https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]{16,}/gi;
  while ((m = anyRe.exec(html))) push(m[0]);

  const multiRe = /multi-lang-plyr\/player\.php\?data=([A-Za-z0-9_\-=+/]+)/gi;
  while ((m = multiRe.exec(html))) {
    const decoded = safeAtob(m[1]);
    if (!decoded) continue;
    try {
      const arr = JSON.parse(decoded);
      if (Array.isArray(arr)) arr.forEach((item) => push(String(item?.link || "")));
    } catch {}
  }

  return Array.from(out);
}

function parseMaster(masterUrl: string, body: string) {
  const base = new URL(masterUrl);
  const baseOrigin = `${base.protocol}//${base.host}`;
  const resolve = (u: string) => /^https?:\/\//i.test(u) ? u : u.startsWith("/") ? baseOrigin + u : new URL(u, masterUrl).toString();
  const streams: any[] = [];
  const audio: any[] = [];
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      const attrs = parseHlsAttrs(line);
      const uri = attrs.URI || "";
      if (uri) {
        const name = attrs.NAME || attrs.LANGUAGE || `Audio ${audio.length + 1}`;
        const language = attrs.LANGUAGE || "";
        const blob = `${name} ${language}`.toLowerCase();
        audio.push({
          language,
          name,
          uri: resolve(uri),
          default: /YES/i.test(attrs.DEFAULT || ""),
          isHindi: /hindi|हिन्दी|हिंदी|\bhin\b/.test(blob),
        });
      }
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      const attrs = parseHlsAttrs(line);
      const res = attrs.RESOLUTION || "";
      const height = res ? Number(res.split("x")[1]) : 0;
      const label = attrs.NAME || (height ? `${height}p` : "Auto");
      streams.push({ url: resolve(next), filename: `${label}.m3u8`, resolution: res, height, bandwidth: Number(attrs.BANDWIDTH || 0), label });
    }
  }

  if (streams.length === 0 && /^#EXTM3U/i.test(body) && /#EXTINF:/i.test(body)) {
    streams.push({ url: masterUrl, filename: "auto.m3u8", resolution: "", height: 0, bandwidth: 0, label: "Auto" });
  }

  streams.sort((a, b) => b.height - a.height);
  const uniqueAudio = uniqueBy(audio, (a) => a.uri);
  const hindiIdx = uniqueAudio.findIndex((a) => a.isHindi);
  const declaredDefaultIdx = uniqueAudio.findIndex((a) => a.default);
  return {
    streams: uniqueBy(streams, (s) => s.url),
    audio: uniqueAudio,
    defaultAudioIdx: hindiIdx >= 0 ? hindiIdx : (declaredDefaultIdx >= 0 ? declaredDefaultIdx : 0),
    preferredAudio: hindiIdx >= 0 ? "Hindi" : (uniqueAudio[declaredDefaultIdx]?.name || uniqueAudio[0]?.name || ""),
  };
}

async function fetchMaster(master: string, embedUrl: string, origin: string) {
  const c = getCache<string>(`master:${master}`);
  if (c) return c;
  const attempts = [
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*" },
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: `${origin}/`, Origin: origin },
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: embedUrl, Origin: origin },
  ];
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PLAYER_TIMEOUT_MS);
    try {
      const res = await fetch(master, { headers, redirect: "follow", signal: ac.signal });
      if (res.ok) return setCache(`master:${master}`, await res.text(), 90_000) as string;
      try { await res.body?.cancel(); } catch {}
    } catch {
      // try next header strategy
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("master fetch failed");
}

async function extractFromPlayer(embedUrl: string) {
  const cached = getCache<any>(`embed:${embedUrl}`);
  if (cached) return cached;
  const m = embedUrl.match(/^(https?:\/\/[^/]+)\/video\/([a-f0-9]+)/i);
  if (!m) return { embed: embedUrl, error: "unrecognized embed format", streams: [], audio: [] };
  const origin = m[1];
  const hash = m[2];
  const apiUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PLAYER_TIMEOUT_MS);
  let txt = "";
  let res: Response | null = null;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Referer: embedUrl,
        Origin: origin,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ hash, r: `${AN_BASE}/` }).toString(),
      redirect: "follow",
      signal: ac.signal,
    });
    txt = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (!res?.ok) return { embed: embedUrl, hash, error: `player upstream ${res?.status || 0}`, raw: txt.slice(0, 200), streams: [], audio: [] };

  let data: any;
  try { data = JSON.parse(txt); } catch { return { embed: embedUrl, hash, error: "player did not return JSON", raw: txt.slice(0, 200), streams: [], audio: [] }; }
  const master = decode(String(data.videoSource || data.securedLink || data.file || data.source || ""));
  let parsed: any = { streams: [] as any[], audio: [] as any[], defaultAudioIdx: 0, preferredAudio: "" };
  if (master) {
    try { parsed = parseMaster(master, await fetchMaster(master, embedUrl, origin)); }
    catch (e) { return { embed: embedUrl, hash, poster: data.videoImage || "", master, videoSource: master, securedLink: master, streams: [], audio: [], error: (e as Error).message }; }
  }
  return setCache(`embed:${embedUrl}`, { embed: embedUrl, hash, poster: data.videoImage || "", master, videoSource: master, securedLink: master, streams: parsed.streams, audio: parsed.audio, defaultAudioIdx: parsed.defaultAudioIdx, preferredAudio: parsed.preferredAudio }, 8 * 60_000);
}

async function episode(slug: string, type?: string) {
  const cacheKey = `episode:${type || ""}:${slug}`;
  const cached = getCache<any>(cacheKey);
  if (cached) return cached;
  const candidates = type === "movies"
    ? [`${AN_BASE}/movies/${slug}/`, `${AN_BASE}/episode/${slug}/`]
    : [`${AN_BASE}/episode/${slug}/`, `${AN_BASE}/movies/${slug}/`, `${AN_BASE}/series/${slug}/`];

  let html = "";
  let pageUrl = candidates[0];
  let embeds: string[] = [];
  for (const candidate of candidates) {
    try {
      const h = await fetchText(candidate);
      const found = collectEmbedsFromHtml(h);
      if (!html) { html = h; pageUrl = candidate; }
      if (found.length) { html = h; pageUrl = candidate; embeds = found; break; }
    } catch {}
  }

  const titleM = html.match(/<meta property=["']og:title["'] content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
  const sources = await Promise.all(embeds.map(async (embed) => {
    try { return await extractFromPlayer(embed); }
    catch (e) { return { embed, error: (e as Error).message, streams: [], audio: [] }; }
  }));

  const playableSources = sources.filter((s) => s.master || (Array.isArray(s.streams) && s.streams.length));
  const links = playableSources.flatMap((source) =>
    Array.isArray(source.streams) && source.streams.length
      ? source.streams.map((stream: any) => ({ quality: stream.label || (stream.height ? `${stream.height}p` : "Auto"), url: stream.url }))
      : [{ quality: "Auto", url: source.master }]
  ).filter((x) => x.url);

  const primary = playableSources[0] as any;
  return setCache(cacheKey, {
    slug,
    title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "),
    pageUrl,
    sources,
    links,
    embedUrl: sources[0]?.embed || "",
    allEmbeds: sources.map((s) => s.embed).filter(Boolean),
    directUrl: playableSources[0]?.master || links[0]?.url || "",
    defaultAudioIdx: typeof primary?.defaultAudioIdx === "number" ? primary.defaultAudioIdx : 0,
    preferredAudio: primary?.preferredAudio || "Hindi",
  }, 8 * 60_000);
}

// ---------- HLS PROXY ----------
function rewriteM3U8(text: string, baseUrl: string, proxyPrefix: string): string {
  const wrap = (u: string) => `${proxyPrefix}?url=${encodeURIComponent(resolveUrl(u, baseUrl))}`;
  return text.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${wrap(u)}"`);
    return wrap(line.trim());
  }).join("\n");
}

async function hlsProxy(req: Request, target: string, proxyPrefix: string) {
  const targetUrl = new URL(target);
  const origin = `${targetUrl.protocol}//${targetUrl.host}`;
  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/vnd.apple.mpegurl,video/*,*/*",
    "Accept-Encoding": "identity",
  };
  const range = req.headers.get("range");
  if (range) baseHeaders.Range = range;
  let upstream: Response | null = null;
  const attempts: Record<string, string>[] = [
    baseHeaders,
    { ...baseHeaders, Referer: `${origin}/` },
    { ...baseHeaders, Referer: `${AN_BASE}/`, Origin: AN_BASE },
    { ...baseHeaders, Referer: `${origin}/`, Origin: origin },
  ];
  for (const headers of attempts) {
    try {
      upstream = await fetch(target, { headers, redirect: "follow" });
      if (upstream.ok || upstream.status === 206 || upstream.status === 304) break;
      try { await upstream.body?.cancel(); } catch {}
    } catch {
      upstream = null;
    }
  }
  if (!upstream) return new Response("AN upstream fetch failed: network", { status: 502, headers: cors });
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    return new Response(`AN upstream fetch failed: ${upstream.status}`, { status: 502, headers: cors });
  }

  const h = new Headers(cors);
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }
  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const isM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:\?|$)/i.test(target);
  if (isM3u8) {
    const rewritten = rewriteM3U8(await upstream.text(), target, proxyPrefix);
    h.delete("content-length");
    h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    h.set("cache-control", "no-store");
    return new Response(rewritten, { status: upstream.status, headers: h });
  }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
}

const API_ENDPOINTS = {
  ok: true,
  name: "AnimeSalt Stream API — NEW ultra fast stable",
  subtitles: false,
  endpoints: { search: "/search?q=naruto", anime: "/anime?slug=naruto&type=series", episode: "/episode?slug=naruto-1x1", embed: "/embed?url=...", hls: "/hls?url=..." },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.includes("/an-api") ? (url.pathname.split("/an-api")[1] || "/") : url.pathname;
  const prefixPath = url.pathname.includes("/an-api") ? url.pathname.split("/an-api")[0] : "";
  const proxyPrefix = `${url.protocol}//${url.host}${prefixPath}/an-api/hls`.replace(/([^:]\/)\/+/g, "$1");

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const targetUrl = String(body?.url || "").trim();
      if (targetUrl) return json({ success: true, html: await fetchText(targetUrl) });
      const action = String(body?.action || "").trim().toLowerCase();
      const slug = String(body?.slug || "").trim();
      const type = String(body?.type || "series").trim();
      if (action === "series" && slug) return json({ success: true, data: await detail(slug, "series") });
      if ((action === "movie" || action === "episode") && slug) return json({ success: true, data: await episode(slug, action === "movie" ? "movies" : type) });
      if (action === "browse") {
        const safeType = type === "movies" ? "movies" : "series";
        const page = Math.max(1, Number(body?.page || 1));
        const listUrl = page > 1 ? `${AN_BASE}/${safeType}/page/${page}/` : `${AN_BASE}/${safeType}/`;
        return json({ success: true, html: await fetchText(listUrl) });
      }
      return json({ success: false, error: "unsupported POST body" }, 400);
    }

    if (path === "/" || path === "") return json(API_ENDPOINTS);
    if (path === "/raw") {
      const target = url.searchParams.get("url") || "";
      if (!target) return json({ error: "missing ?url=" }, 400);
      return json({ success: true, html: await fetchText(target) });
    }
    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return json({ error: "missing ?q=" }, 400);
      return json(await search(q.trim()));
    }
    if (path === "/anime") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "series";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await detail(slug, type));
    }
    if (path === "/episode") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await episode(slug, type));
    }
    if (path === "/embed") {
      const embedUrl = url.searchParams.get("url") || "";
      if (!embedUrl) return json({ error: "missing ?url=" }, 400);
      return json(await extractFromPlayer(embedUrl));
    }
    if (path === "/hls") {
      const target = url.searchParams.get("url") || "";
      if (!target) return new Response("missing ?url=", { status: 400, headers: cors });
      return await hlsProxy(req, target, proxyPrefix);
    }
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
