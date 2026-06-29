import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

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
const getCache = <T>(key: string, forceRefresh = false): T | null => {
  if (forceRefresh) {
    cache.delete(key);
    return null;
  }
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
  ...corsHeaders,
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
async function detail(slug: string, type: string, forceRefresh = false) {
  const t = type === "movies" ? "movies" : "series";
  const cacheKey = `detail:${t}:${slug}`;
  const cached = getCache<any>(cacheKey, forceRefresh);
  if (cached) return cached;
  const html = await fetchText(`${AN_BASE}/${t}/${slug}/`);
  const titleM = html.match(/<meta property=["']og:title["'] content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
  const posterM = html.match(/<meta property=["']og:image["'] content=["']([^"']+)/i);
  const descM = html.match(/<meta name=["']description["'] content=["']([^"']+)/i) || html.match(/<meta property=["']og:description["'] content=["']([^"']+)/i);

  const seasons = new Map<number, { name: string; seasonNumber: number; episodes: any[] }>();

  const harvestEpisodes = (body: string, defaultSeason: number) => {
    const epRe = /href=["']https?:\/\/animesalt\.(?:ac|top)\/episode\/([^"'/?#]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = epRe.exec(body))) {
      const epSlug = m[1];
      if (!epSlug) continue;
      const sx = epSlug.match(/(\d+)x(\d+)$/i);
      const seasonNum = sx ? Number(sx[1]) : defaultSeason;
      const epNum = sx ? Number(sx[2]) : 0;
      if (!seasons.has(seasonNum)) seasons.set(seasonNum, { name: `Season ${seasonNum}`, seasonNumber: seasonNum, episodes: [] });
      const bucket = seasons.get(seasonNum)!.episodes;
      if (bucket.some((e) => e.slug === epSlug)) continue;
      bucket.push({ number: epNum || bucket.length + 1, episodeNumber: epNum || bucket.length + 1, title: decode(m[2]) || `Episode ${epNum || bucket.length + 1}`, slug: epSlug, link: `animesalt://${epSlug}` });
    }
  };

  // Static HTML usually contains only the currently-selected season (Season 1).
  harvestEpisodes(html, 1);

  // AnimeSalt loads each additional season via WP AJAX:
  //   /wp-admin/admin-ajax.php?action=action_select_season&season=N&post=POSTID
  // Without this fetch we only ever see Season 1 — which is why Demon Slayer
  // and every multi-season anime had episodes missing.
  const postId = html.match(/data-post=["'](\d+)["']/)?.[1];
  const seasonNums = Array.from(new Set(
    Array.from(html.matchAll(/data-season=["'](\d+)["']/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0),
  )).sort((a, b) => a - b);

  if (postId && seasonNums.length) {
    await Promise.all(seasonNums.map(async (sNum) => {
      try {
        const seasonHtml = await fetchText(`${AN_BASE}/wp-admin/admin-ajax.php?action=action_select_season&season=${sNum}&post=${postId}`, {
          headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html,*/*" },
        });
        harvestEpisodes(seasonHtml, sNum);
      } catch {}
    }));
  }

  const seasonsArr = Array.from(seasons.values())
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((s) => ({
      name: s.name,
      seasonNumber: s.seasonNumber,
      episodes: s.episodes.sort((a, b) => a.number - b.number),
    }));

  return setCache(cacheKey, {
    slug,
    type: t,
    title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "),
    poster: posterM ? resolveUrl(posterM[1], AN_BASE) : "",
    storyline: descM ? decode(descM[1]) : "",
    postId: postId || null,
    seasonNumbers: seasonNums,
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
  // Default audio policy: Hindi ALWAYS wins. Only fall back to the HLS-declared
  // default (or the first track) when no Hindi track exists.
  const hindiIdx = uniqueAudio.findIndex((a: any) => a.isHindi || /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${a.name || ""} ${a.language || ""}`));
  const declaredDefaultIdx = uniqueAudio.findIndex((a) => a.default);
  const defaultIdx = hindiIdx >= 0 ? hindiIdx : (declaredDefaultIdx >= 0 ? declaredDefaultIdx : 0);
  uniqueAudio.forEach((a: any, i: number) => { a.default = i === defaultIdx; });
  return {
    streams: uniqueBy(streams, (s) => s.url),
    audio: uniqueAudio,
    defaultAudioIdx: defaultIdx,
    preferredAudio: uniqueAudio[defaultIdx]?.name || "",
  };
}

function firstMediaUrl(body: string, baseUrl: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return resolveUrl(line, baseUrl);
  }
  return "";
}

async function fetchHlsText(url: string, embedUrl: string, origin: string): Promise<string> {
  return await fetchMaster(url, embedUrl, origin);
}

async function isWorkingMediaPlaylist(url: string, embedUrl: string, origin: string): Promise<boolean> {
  try {
    const body = await fetchHlsText(url, embedUrl, origin);
    if (!/^#EXTM3U/i.test(body)) return false;
    if (/#EXT-X-STREAM-INF/i.test(body)) return true;
    if (!/#EXTINF:/i.test(body) && !/#EXT-X-MAP/i.test(body)) return false;
    // Do not probe individual .ts/.m4s segments from the Edge Function. Many
    // tokenized AnimeSalt/CDN playlists allow the browser/player request but
    // reject server-side range probes, which caused valid fetches to be marked
    // as failed. A syntactically valid media playlist is enough; playback goes
    // through the HLS proxy later with the correct headers.
    return !!firstMediaUrl(body, url) || /#EXT-X-MAP/i.test(body);
  } catch {
    return false;
  }
}

async function filterWorkingHls(parsed: any, embedUrl: string, origin: string) {
  const [streams, audio] = await Promise.all([
    Promise.all((parsed.streams || []).map(async (stream: any) => ({ stream, ok: await isWorkingMediaPlaylist(stream.url, embedUrl, origin) }))),
    Promise.all((parsed.audio || []).map(async (track: any) => ({ track, ok: await isWorkingMediaPlaylist(track.uri, embedUrl, origin) }))),
  ]);
  const workingStreams = streams.filter((entry) => entry.ok).map((entry) => entry.stream);
  const workingAudio = audio.filter((entry) => entry.ok).map((entry) => entry.track);
  const masterHadSeparateAudio = Array.isArray(parsed.audio) && parsed.audio.length > 0;
  if (masterHadSeparateAudio && workingAudio.length === 0) {
    return { streams: [], audio: [], defaultAudioIdx: 0, preferredAudio: "", rejected: "audio tracks failed validation" };
  }
  const hindiIdx = workingAudio.findIndex((a: any) => a.isHindi || /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${a.name || ""} ${a.language || ""}`));
  const declaredDefaultIdx = workingAudio.findIndex((a: any) => a.default);
  const defaultIdx = hindiIdx >= 0 ? hindiIdx : (declaredDefaultIdx >= 0 ? declaredDefaultIdx : 0);
  workingAudio.forEach((a: any, i: number) => { a.default = i === defaultIdx; });
  return {
    streams: workingStreams,
    audio: workingAudio,
    defaultAudioIdx: defaultIdx,
    preferredAudio: workingAudio[defaultIdx]?.name || "",
    rejected: workingStreams.length === 0 ? "no validated video playlists" : "",
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

async function extractFromPlayer(embedUrl: string, forceRefresh = false) {
  const cached = getCache<any>(`embed:${embedUrl}`, forceRefresh);
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
    try {
      // Do NOT segment-probe the variant/audio playlists here. AnimeSalt's
      // variant URLs are the exact URLs the admin needs to store (480/720/1080
      // video-only + all separate audio renditions). Probing the first segment
      // from the Edge Function can fail because of CDN/referrer rules even when
      // the playlist is perfectly playable in the browser via hls.js. That made
      // Fetch save zero quality URLs. Parse the master and return every playlist
      // URL; the public player will combine video+audio from Firebase only.
      parsed = parseMaster(master, await fetchMaster(master, embedUrl, origin));
    }
    catch (e) { return { embed: embedUrl, hash, poster: data.videoImage || "", master, videoSource: master, securedLink: master, streams: [], audio: [], error: (e as Error).message }; }
  }
  if (master && parsed.streams.length === 0) {
    return { embed: embedUrl, hash, poster: data.videoImage || "", master, videoSource: master, securedLink: master, streams: [], audio: [], error: "no HLS variant playlists found" };
  }
  return setCache(`embed:${embedUrl}`, { embed: embedUrl, hash, poster: data.videoImage || "", master, videoSource: master, securedLink: master, streams: parsed.streams, audio: parsed.audio, defaultAudioIdx: parsed.defaultAudioIdx, preferredAudio: parsed.preferredAudio }, 8 * 60_000);
}

async function episode(slug: string, type?: string, forceRefresh = false) {
  const cacheKey = `episode:${type || ""}:${slug}`;
  const cached = getCache<any>(cacheKey, forceRefresh);
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
    try { return await extractFromPlayer(embed, forceRefresh); }
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
    preferredAudio: primary?.preferredAudio || "",
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
  const upstreamMethod = req.method === "HEAD" ? "HEAD" : "GET";
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
      upstream = await fetch(target, { method: upstreamMethod, headers, redirect: "follow" });
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
  const isM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:\?|$)/i.test(target) || /\/hls\//i.test(targetUrl.pathname);
  if (isM3u8) {
    if (req.method === "HEAD") {
      h.delete("content-length");
      h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
      h.set("cache-control", "no-store");
      return new Response(null, { status: upstream.status, headers: h });
    }
    const rewritten = rewriteM3U8(await upstream.text(), target, proxyPrefix);
    h.delete("content-length");
    h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    h.set("cache-control", "no-store");
    return new Response(rewritten, { status: upstream.status, headers: h });
  }
  // AnimeSalt serves MPEG-TS fragments from .js URLs with
  // application/javascript. hls.js can fetch the bytes, but mobile browsers are
  // stricter when the MIME looks like script. Force media headers on fragments.
  if (/\/p\//i.test(targetUrl.pathname) || /javascript|text\/plain/i.test(ct)) {
    h.set("content-type", "video/mp2t");
    h.set("content-disposition", "inline");
  }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  const body = req.method === "HEAD" ? null : new ReadableStream({
    async start(controller) {
      const reader = upstream?.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // Browser cancelled the HLS segment/playlist request (BadResource in Deno).
        // This is normal when users leave Continue Watching or switch episodes.
      } finally {
        try { reader.releaseLock(); } catch {}
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      try { upstream?.body?.cancel(); } catch {}
    },
  });
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: h });
}

const API_ENDPOINTS = {
  ok: true,
  name: "AnimeSalt Stream API — NEW ultra fast stable",
  subtitles: false,
  endpoints: { series: "/series?page=1", movies: "/movies?page=1", search: "/search?q=naruto", anime: "/anime?slug=naruto&type=series", episode: "/episode?slug=naruto-1x1", embed: "/embed?url=...", hls: "/hls?url=..." },
};

async function browse(type: string, page = 1, forceRefresh = false) {
  const safeType = type === "movies" ? "movies" : "series";
  const safePage = Math.max(1, Number(page || 1));
  const cacheKey = `browse:${safeType}:${safePage}`;
  const cached = getCache<any>(cacheKey, forceRefresh);
  if (cached) return cached;
  const listUrl = safePage > 1 ? `${AN_BASE}/${safeType}/page/${safePage}/` : `${AN_BASE}/${safeType}/`;
  return setCache(cacheKey, { html: await fetchText(listUrl), currentPage: safePage }, 15 * 60_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.includes("/an-api") ? (url.pathname.split("/an-api")[1] || "/") : url.pathname;
  const prefixPath = url.pathname.includes("/an-api") ? url.pathname.split("/an-api")[0] : "";
  const isCloudHost = /\.supabase\.co$/i.test(url.hostname);
  const normalizedPrefix = prefixPath || (isCloudHost ? "/functions/v1" : "");
  const publicProtocol = isCloudHost ? "https:" : url.protocol;
  const proxyPrefix = `${publicProtocol}//${url.host}${normalizedPrefix}/an-api/hls`.replace(/([^:]\/)\/+/g, "$1");

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const targetUrl = String(body?.url || "").trim();
      if (targetUrl) return json({ success: true, html: await fetchText(targetUrl) });
      const action = String(body?.action || "").trim().toLowerCase();
      const slug = String(body?.slug || "").trim();
      const type = String(body?.type || "series").trim();
      const forceRefresh = body?.force === true || body?.refresh === true || body?.forceRefresh === true;
      if (action === "series" && slug) return json({ success: true, data: await detail(slug, "series", forceRefresh) });
      if ((action === "movie" || action === "episode") && slug) return json({ success: true, data: await episode(slug, action === "movie" ? "movies" : type, forceRefresh) });
      if (action === "browse") {
        const result = await browse(type, body?.page || 1, forceRefresh);
        return json({ success: true, ...result });
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
    if (path === "/series" || path === "/movies") {
      const result = await browse(path === "/movies" ? "movies" : "series", Number(url.searchParams.get("page") || 1), url.searchParams.get("force") === "1");
      return json({ success: true, ...result });
    }
    if (path === "/anime") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "series";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await detail(slug, type, url.searchParams.get("force") === "1"));
    }
    if (path === "/episode") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "";
      if (!slug) return json({ error: "missing ?slug=" }, 400);
      return json(await episode(slug, type, url.searchParams.get("force") === "1"));
    }
    if (path === "/embed") {
      const embedUrl = url.searchParams.get("url") || "";
      if (!embedUrl) return json({ error: "missing ?url=" }, 400);
      return json(await extractFromPlayer(embedUrl, url.searchParams.get("force") === "1"));
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
