// ============================================================
// an-api — Standalone AnimeSalt (AN) Search + Stream Extractor API
// ============================================================
// Endpoints (all GET, JSON unless noted):
//   GET /                       → JSON endpoint list (API only)
//   GET /search?q=naruto        → [{slug,title,poster,year,type}]
//   GET /anime?slug=&type=series→ {title,poster,storyline,seasons:[{name,episodes:[{number,title,slug}]}]}
//   GET /episode?slug=naruto-1x1→ {slug,title,sources:[{embed,master,streams:[{url,filename,resolution,height,bandwidth}],audio:[{language,name,uri}]}]}
// CORS: open. Pure scraping — no secrets required.
// ============================================================

const AN_BASE = "https://animesalt.ac";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });

const decode = (s: string) =>
  s
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();

const decodeSubtitleEntities = (value: string) =>
  decode(value)
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/\\u002f/gi, "/")
    .replace(/\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

function safeAtob(value: string): string {
  try { return atob(value); } catch {}
  try { return atob(value.replace(/-/g, "+").replace(/_/g, "/")); } catch {}
  return "";
}

const parseHlsAttrs = (line: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    attrs[m[1].toUpperCase()] = String(m[2] || "").replace(/^"|"$/g, "");
  }
  return attrs;
};

const resolveUrl = (value: string, baseUrl: string) => {
  try { return new URL(value, baseUrl).toString(); } catch { return value; }
};

const uniqueByUri = <T extends { uri?: string; url?: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.uri || item.url || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: AN_BASE + "/",
      ...(init?.headers || {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
  return await res.text();
}

// ---------- SEARCH ----------
async function search(q: string) {
  const html = await fetchText(`${AN_BASE}/?s=${encodeURIComponent(q)}`);
  const seen = new Set<string>();
  const out: any[] = [];
  // Each result is wrapped in <li ...><article>...<a class="lnk-blk" href="...slug/"></a></article></li>
  const liRe = /<li[^>]*class="[^"]*post-\d+[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) {
    const block = m[1];
    const hrefM = block.match(/href="https:\/\/animesalt\.ac\/(series|movies)\/([^"\/]+)\/?"/i);
    if (!hrefM) continue;
    const type = hrefM[1];
    const slug = hrefM[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const titleM = block.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleM ? decode(titleM[1]) : slug.replace(/-/g, " ");
    // poster: prefer data-src on img, fall back to src
    const imgM =
      block.match(/<img[^>]+data-src="([^"]+)"/i) ||
      block.match(/<img[^>]+src="(https?:[^"]+)"/i);
    let poster = imgM ? imgM[1] : "";
    if (poster.startsWith("//")) poster = "https:" + poster;
    const yearM = block.match(/annee-(\d{3,4})/i) || block.match(/(?:19|20)\d{2}/);
    out.push({
      slug,
      type,
      title,
      poster,
      year: yearM ? yearM[0].replace(/^annee-/, "") : "",
      detailUrl: `${AN_BASE}/${type}/${slug}/`,
    });
  }
  return out;
}

// ---------- ANIME DETAIL ----------
async function detail(slug: string, type: string) {
  const t = type === "movies" ? "movies" : "series";
  const html = await fetchText(`${AN_BASE}/${t}/${slug}/`);
  const titleM =
    html.match(/<meta property="og:title" content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  const posterM = html.match(/<meta property="og:image" content="([^"]+)"/i);
  const descM = html.match(/<meta name="description" content="([^"]+)"/i);

  const seasons = new Map<string, { name: string; episodes: any[] }>();
  const epRe =
    /<a[^>]+href="https:\/\/animesalt\.ac\/episode\/([^"\/]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = epRe.exec(html))) {
    const epSlug = m[1];
    if (seen.has(epSlug)) continue;
    seen.add(epSlug);
    const inner = decode(m[2]) || epSlug;
    const sx = epSlug.match(/(\d+)x(\d+)$/i);
    const seasonNum = sx ? Number(sx[1]) : 1;
    const epNum = sx ? Number(sx[2]) : seen.size;
    const key = `Season ${seasonNum}`;
    if (!seasons.has(key)) seasons.set(key, { name: key, episodes: [] });
    seasons.get(key)!.episodes.push({ number: epNum, title: inner, slug: epSlug });
  }

  const seasonsArr = Array.from(seasons.values()).map((s) => ({
    name: s.name,
    episodes: s.episodes.sort((a, b) => a.number - b.number),
  }));

  return {
    slug,
    type: t,
    title: titleM ? decode(titleM[1]) : slug,
    poster: posterM ? posterM[1] : "",
    storyline: descM ? decode(descM[1]) : "",
    seasons: seasonsArr,
    episodeCount: seasonsArr.reduce((n, s) => n + s.episodes.length, 0),
  };
}

// ---------- EPISODE → ALL STREAM URLS ----------
function parseMaster(masterUrl: string, body: string) {
  const base = new URL(masterUrl);
  const baseOrigin = `${base.protocol}//${base.host}`;
  const resolve = (u: string) =>
    /^https?:\/\//i.test(u) ? u : u.startsWith("/") ? baseOrigin + u : new URL(u, masterUrl).toString();

  const lines = body.split(/\r?\n/);
  const streams: any[] = [];
  const audio: any[] = [];
  const subtitles: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      const attrs = parseHlsAttrs(line);
      const lang = attrs.LANGUAGE || "";
      const name = attrs.NAME || lang;
      const uri = attrs.URI || "";
      if (uri) audio.push({ language: lang, name, uri: resolve(uri) });
    } else if (line.startsWith("#EXT-X-MEDIA") && /TYPE=(SUBTITLES|CLOSED-CAPTIONS)/i.test(line)) {
      const attrs = parseHlsAttrs(line);
      const lang = attrs.LANGUAGE || "";
      const name = attrs.NAME || lang || attrs["GROUP-ID"] || "Subtitle";
      const uri = attrs.URI || "";
      if (uri) subtitles.push({ language: lang, name, uri: resolve(uri) });
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      const attrs = parseHlsAttrs(line);
      const res = attrs.RESOLUTION || "";
      const name = attrs.NAME || "";
      const bw = Number(attrs.BANDWIDTH || 0);
      const height = res ? Number(res.split("x")[1]) : 0;
      const url = resolve(next);
      const label = name || (height ? `${height}p` : "auto");
      const filename = `${label}.m3u8`;
      streams.push({ url, filename, resolution: res, height, bandwidth: bw, label });
    }
  }
  streams.sort((a, b) => b.height - a.height);
  return { streams, audio: uniqueByUri(audio), subtitles: uniqueByUri(subtitles) };
}

function collectSubtitleString(value: string, baseUrl: string, out: any[]) {
  const raw = decodeSubtitleEntities(value || "").trim();
  if (!raw) return;

  // PlayerJS commonly stores subtitles as:
  //   [English]https://...vtt,[Arabic]https://...srt
  // Some mirrors use escaped JSON containing file/url/src keys. Support both.
  try {
    const parsed = JSON.parse(raw);
    collectSubtitleCandidates(parsed, baseUrl, out);
  } catch {}

  const bracketRe = /\[([^\]]+)\]\s*(https?:\/\/[^,\s\]"']+|\/[^,\s\]"']+|[^,\s\]"']+\.(?:vtt|srt|webvtt|ttml|dfxp)(?:\?[^,\s\]"']*)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(raw))) {
    out.push({ language: (m[1] || "").slice(0, 3).toLowerCase(), name: decode(m[1] || "Subtitle"), uri: resolveUrl(m[2], baseUrl) });
  }

  const objectUrlRe = /(?:file|url|src|uri|href)\s*[:=]\s*["']([^"']+\.(?:vtt|srt|webvtt|ttml|dfxp)(?:\?[^"']*)?)["']/gi;
  while ((m = objectUrlRe.exec(raw))) {
    out.push({ language: "und", name: `Subtitle ${out.length + 1}`, uri: resolveUrl(m[1], baseUrl) });
  }
}

function collectSubtitleCandidates(value: unknown, baseUrl: string, out: any[], depth = 0) {
  if (!value || depth > 5) return;
  if (typeof value === "string") {
    collectSubtitleString(value, baseUrl, out);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSubtitleCandidates(item, baseUrl, out, depth + 1));
    return;
  }
  if (typeof value !== "object") return;

  const obj = value as Record<string, any>;
  const kind = String(obj.kind || obj.type || obj.trackType || obj.fileType || "").toLowerCase();
  const label = String(obj.label || obj.name || obj.title || obj.language || obj.lang || obj.srclang || "Subtitle");
  const raw = obj.file || obj.url || obj.src || obj.uri || obj.link || obj.href;
  const rawString = typeof raw === "string" ? raw.trim() : "";
  const looksLikeSubtitle = /sub|caption|text|vtt|srt|webvtt|ttml|dfxp/i.test(kind) || /\.(vtt|srt|webvtt|ttml|dfxp)(\?|#|$)/i.test(rawString);
  if (rawString && looksLikeSubtitle) {
    out.push({
      language: obj.language || obj.srclang || obj.lang || "",
      name: label || obj.language || obj.lang || "Subtitle",
      uri: resolveUrl(rawString, baseUrl),
    });
  }

  for (const key of ["captions", "caption", "subtitles", "subtitle", "tracks", "textTracks", "subs", "files", "sources", "playerjsSubtitle"]) {
    if (obj[key]) collectSubtitleCandidates(obj[key], baseUrl, out, depth + 1);
  }
}

function decodeJsStringLiteral(raw: string): string {
  const value = raw.trim();
  try {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return JSON.parse(value.startsWith("'")
        ? `"${value.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`
        : value);
    }
  } catch {}
  return value.replace(/^['"]|['"]$/g, "");
}

function collectPlayerJsSubtitles(html: string, baseUrl: string): any[] {
  const out: any[] = [];
  const assignments = /(?:var\s+)?(?:playerjsSubtitle|subtitle|subtitles|tracks|textTracks)\s*=\s*(["'][\s\S]*?["']|\[[\s\S]*?\]|\{[\s\S]*?\})\s*;/gi;
  let a: RegExpExecArray | null;
  while ((a = assignments.exec(html))) {
    const rawList = decodeJsStringLiteral(a[1]);
    collectSubtitleString(rawList, baseUrl, out);
  }
  return uniqueByUri(out);
}

async function extractFromPlayer(embedUrl: string) {
  // embedUrl: https://as-cdnNN.top/video/{hash}
  const m = embedUrl.match(/^(https?:\/\/[^\/]+)\/video\/([a-f0-9]+)/i);
  if (!m) return { embed: embedUrl, error: "unrecognized embed format" };
  const origin = m[1];
  const hash = m[2];
  let embedHtml = "";
  try {
    embedHtml = await fetchText(embedUrl, { headers: { Referer: AN_BASE + "/" } });
  } catch {}
  const apiUrl = `${origin}/player/index.php?data=${hash}&do=getVideo`;
  const body = new URLSearchParams({ hash, r: AN_BASE + "/" }).toString();
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: embedUrl,
      Origin: origin,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const txt = await res.text();
  let data: any;
  try { data = JSON.parse(txt); } catch {
    return { embed: embedUrl, error: "player did not return JSON", raw: txt.slice(0, 200) };
  }
  const master = data.videoSource || data.securedLink || "";
  let parsed: any = { streams: [], audio: [], subtitles: [] };
  if (master) {
    try {
      let mRes: Response | null = null;
      const attempts = [
        { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*" },
        { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: origin + "/", Origin: origin },
        { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: embedUrl, Origin: origin },
      ];
      for (const headers of attempts) {
        const res = await fetch(master, { headers });
        if (res.ok) { mRes = res; break; }
        try { await res.body?.cancel(); } catch {}
      }
      if (!mRes) throw new Error("master fetch failed");
      const mTxt = await mRes.text();
      parsed = parseMaster(master, mTxt);
    } catch (e) {
      parsed.error = `master fetch failed: ${(e as Error).message}`;
    }
  }
  // Some AN player JSONs expose captions in top-level or nested player fields.
  const extraSubs: any[] = [];
  collectSubtitleCandidates(data, embedUrl, extraSubs);
  const embedSubs = collectPlayerJsSubtitles(embedHtml, embedUrl);
  const allSubs = uniqueByUri([...(parsed.subtitles || []), ...extraSubs, ...embedSubs]);
  return {
    embed: embedUrl,
    hash,
    poster: data.videoImage || "",
    master,
    streams: parsed.streams,
    audio: parsed.audio,
    subtitles: allSubs,
  };
}

async function episode(slug: string, type?: string) {
  // Try paths based on type, fall back to the other if no embeds.
  const candidates = type === "movies"
    ? [`${AN_BASE}/movies/${slug}/`, `${AN_BASE}/episode/${slug}/`]
    : [`${AN_BASE}/episode/${slug}/`, `${AN_BASE}/movies/${slug}/`, `${AN_BASE}/series/${slug}/`];

  let html = "";
  let pageUrl = candidates[0];
  let embeds = new Set<string>();
  for (const url of candidates) {
    try {
      const h = await fetchText(url);
      const found = new Set<string>();
      const reIframe = /<iframe[^>]+(?:src|data-src)="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = reIframe.exec(h))) {
        if (/\/video\/[a-f0-9]+/i.test(m[1])) found.add(m[1]);
      }
      const reData = /data-(?:src|embed|player|video)="([^"]+\/video\/[a-f0-9]+[^"]*)"/gi;
      while ((m = reData.exec(h))) found.add(m[1]);
      // any URL in HTML
      const reAny = /https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]+/gi;
      while ((m = reAny.exec(h))) found.add(m[0]);
      if (found.size > 0) { html = h; pageUrl = url; embeds = found; break; }
      if (!html) { html = h; pageUrl = url; }
    } catch {}
  }

  const titleM =
    html.match(/<meta property="og:title" content="([^"]+)"/i) ||
    html.match(/<title>([^<]+)<\/title>/i);

  const sources: any[] = [];
  for (const embed of embeds) {
    try {
      sources.push(await extractFromPlayer(embed));
    } catch (e) {
      sources.push({ embed, error: (e as Error).message });
    }
  }
  return {
    slug,
    title: titleM ? decode(titleM[1]) : slug,
    pageUrl,
    sources,
  };
}

// ---------- API ROOT ----------
const API_ENDPOINTS = {
  ok: true,
  name: "AnimeSalt Stream API",
  endpoints: {
    search: "/search?q=naruto",
    anime: "/anime?slug=naruto&type=series",
    episode: "/episode?slug=naruto-1x1",
    embed: "/embed?url=https%3A%2F%2Fexample.com%2Fembed",
    hls: "/hls?url=https%3A%2F%2Fexample.com%2Fmaster.m3u8",
    subs: "/subs?url=https%3A%2F%2Fexample.com%2Fsubtitle.srt"
  }
};

// ---------- HLS PROXY (CORS-safe pass-through + m3u8 URL rewriting) ----------
// Used by the native player so hls.js can fetch playlists and segments from a
// same-origin (CORS-allowed) URL. Body is NOT modified other than rewriting
// URL references inside .m3u8 to point back through this proxy.
function rewriteM3U8(text: string, baseUrl: string, proxyPrefix: string): string {
  const base = new URL(baseUrl);
  const toAbs = (u: string) => { try { return new URL(u, base).toString(); } catch { return u; } };
  const wrap = (u: string) => `${proxyPrefix}?url=${encodeURIComponent(toAbs(u))}`;
  return text.split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
    return wrap(line.trim());
  }).join("\n");
}

async function hlsProxy(req: Request, target: string, proxyPrefix: string): Promise<Response> {
  const range = req.headers.get("range") || undefined;
  const commonHeaders: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/vnd.apple.mpegurl,video/*,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      ...(range ? { Range: range } : {}),
  };
  const targetUrl = new URL(target);
  const origin = `${targetUrl.protocol}//${targetUrl.host}`;
  const attempts: Record<string, string>[] = [
    commonHeaders,
    { ...commonHeaders, Referer: origin + "/", Origin: origin },
  ];

  let upstream: Response | null = null;
  for (const headers of attempts) {
    const res = await fetch(target, { headers });
    if (res.ok || res.status === 206 || res.status === 304) { upstream = res; break; }
    try { await res.body?.cancel(); } catch {}
  }

  if (!upstream) {
    return new Response("AN upstream fetch failed", { status: 502, headers: cors });
  }

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  const looksM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(\?|$)/i.test(target);

  const baseHeaders: Record<string, string> = { ...cors };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) baseHeaders[h] = v;
  }

  if (looksM3u8) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, target, proxyPrefix);
    delete baseHeaders["content-length"];
    baseHeaders["content-type"] = "application/vnd.apple.mpegurl; charset=utf-8";
    baseHeaders["cache-control"] = "no-store";
    return new Response(rewritten, { status: upstream.status, headers: baseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: baseHeaders });
}

// ---------- SUBTITLE PROXY (SRT→VTT conversion, always WebVTT out) ----------
function srtToVtt(srt: string): string {
  // Convert "00:00:01,000" → "00:00:01.000" and prepend WEBVTT header.
  const body = srt
    .replace(/\r+/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + body.trim() + "\n";
}

function isVttLike(text: string) {
  return /^WEBVTT\b/i.test(text.trim()) || /\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text);
}

function timestampToSeconds(raw: string): number {
  const parts = raw.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return Number.NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number.NaN;
}

function secondsToTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds || 0);
  const hh = Math.floor(safe / 3600).toString().padStart(2, "0");
  const mm = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const ss = Math.floor(safe % 60).toString().padStart(2, "0");
  const ms = Math.round((safe - Math.floor(safe)) * 1000).toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function stripVttHeader(text: string) {
  return text
    .replace(/\r+/g, "")
    .replace(/^WEBVTT[^\n]*(?:\n+NOTE[^\n]*(?:\n(?!\d{2}:)[^\n]*)*)?/i, "")
    .trim();
}

function offsetVttCues(text: string, offset: number): string {
  const body = stripVttHeader(text);
  if (!offset) return body;
  return body.replace(
    /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})([^\n]*)/g,
    (_m, start, end, rest) => {
      const s = timestampToSeconds(start);
      const e = timestampToSeconds(end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) return _m;
      return `${secondsToTimestamp(s + offset)} --> ${secondsToTimestamp(e + offset)}${rest || ""}`;
    },
  );
}

async function subtitleToVtt(target: string, depth = 0): Promise<string> {
  if (depth > 4) throw new Error("subtitle nesting too deep");
  const upstream = await fetch(target, { headers: { "User-Agent": UA } });
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  const text = await upstream.text();
  const trimmed = text.replace(/\r/g, "").trim();

  if (/^#EXTM3U\b/i.test(trimmed)) {
    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    let nextDuration = 0;
    let offset = 0;
    const parts: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        nextDuration = Number.parseFloat(line.slice(8).split(",")[0] || "0") || 0;
        continue;
      }
      if (line.startsWith("#")) continue;
      const segmentUrl = resolveUrl(line, target);
      const segmentVtt = await subtitleToVtt(segmentUrl, depth + 1);
      parts.push(offsetVttCues(segmentVtt, offset));
      offset += nextDuration;
      nextDuration = 0;
    }
    return "WEBVTT\n\n" + parts.filter(Boolean).join("\n\n").trim() + "\n";
  }

  if (isVttLike(trimmed)) return /^WEBVTT\b/i.test(trimmed) ? trimmed + "\n" : srtToVtt(trimmed);
  return "WEBVTT\n\n" + trimmed + "\n";
}

async function subsProxy(target: string): Promise<Response> {
  let text: string;
  try {
    text = await subtitleToVtt(target);
  } catch (e) {
    return new Response((e as Error).message || "subtitle upstream failed", { status: 502, headers: cors });
  }
  return new Response(text, {
    status: 200,
    headers: { ...cors, "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

// ---------- ROUTER ----------
// Domain allowlist — block third-party scrapers/embeds.
const _ALLOWED_HOST_RX = [
  /\.lovable\.app$/i, /^lovable\.app$/i,
  /\.lovableproject\.com$/i, /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i, /^127\.0\.0\.1(?::\d+)?$/i,
];
const _hostAllowed = (s: string | null) => {
  if (!s) return false;
  try { return _ALLOWED_HOST_RX.some((rx) => rx.test(new URL(s).host)); } catch { return false; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/an-api/i, "") || "/";
  const proxyPrefix = `https://${url.host}/functions/v1/an-api/hls`;

  // Allowlist guard disabled — origin/referer headers are unreliable for
  // cross-origin media/HLS segment fetches and were blocking real playback.
  // Embed-theft protection is enforced at the UI layer instead.

  try {
    // Backward-compatible JSON mode for the app/client library.
    // Supported body shapes:
    //   { url }                         -> raw HTML fetch
    //   { action:"series", slug }       -> detail
    //   { action:"movie"|"episode", slug } -> stream extraction
    //   { action:"browse", type, page } -> raw list HTML
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

    if (path === "/" || path === "") {
      return json(API_ENDPOINTS);
    }
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
    if (path === "/subs") {
      const target = url.searchParams.get("url") || "";
      if (!target) return new Response("missing ?url=", { status: 400, headers: cors });
      return await subsProxy(target);
    }
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
