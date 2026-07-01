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
//   GET  /hls?url=<m3u8/segment> → legacy redirect to playback API
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

const CARTOON_BLOCK_RE = /\b(?:ben\s*10|alien\s*swarm|omniverse|ultimate\s*alien|generator\s*rex|teen\s*titans|justice\s*league|batman|superman|spider\s*man|avengers|tom\s*(?:and|&)\s*jerry|looney\s*tunes|scooby\s*doo|powerpuff|courage\s*the\s*cowardly|regular\s*show|adventure\s*time|gumball|samurai\s*jack|kung\s*fu\s*panda|madagascar|minions|despicable\s*me|cars|toy\s*story|frozen|shrek|ice\s*age|hotel\s*transylvania|rio|moana|tangled|how\s*to\s*train\s*your\s*dragon|avatar\s*the\s*last\s*airbender|sponge\s*bob|nickelodeon|cartoon\s*network|disney|pixar|tintin|tin\s*tin|jurassic\s*world|sausage\s*party|maya\s*and\s*the\s*three|hazbin\s*hotel|captain\s*laserhawk|invincible|zig\s*and\s*sharko|twilight\s*of\s*the\s*gods|arcane|jentry\s*chau|vox\s*machina|dragon\s*prince|castlevania)\b/i;
const ANIME_ALLOW_RE = /\b(?:pokemon|pokémon|doraemon|shin\s*chan|crayon\s*shin|naruto|boruto|one\s*piece|dragon\s*ball|bleach|demon\s*slayer|jujutsu\s*kaisen|attack\s*on\s*titan|detective\s*conan|solo\s*leveling)\b/i;

function isAllowedAnimeItem(item: any) {
  const blob = `${item?.title || ""} ${item?.slug || ""}`.replace(/[-_]+/g, " ").toLowerCase();
  if (!blob.trim()) return false;
  if (ANIME_ALLOW_RE.test(blob)) return true;
  return !CARTOON_BLOCK_RE.test(blob);
}

const filterAnimeOnly = <T extends any>(items: T[]): T[] => (Array.isArray(items) ? items.filter(isAllowedAnimeItem) : []);

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

function parseMaxPage(html: string, type: string) {
  const safeType = type === "movies" ? "movies" : "series";
  const nums = [1];
  const re = new RegExp(`/${safeType}/page/(\\d+)/`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) nums.push(Number(m[1]));
  const title = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  if (title) nums.push(Number(title[1]));
  return Math.max(...nums.filter((n) => Number.isFinite(n) && n > 0));
}

function parseBrowseItems(html: string, type: string) {
  const out: any[] = [];
  const seen = new Set<string>();
  const safeType = type === "movies" ? "movies" : "series";
  const skipSlugs = new Set(["page", "feed", "wp-json", "category", "tag", "author"]);
  const pushFromBlock = (block: string) => {
    const hrefM = block.match(new RegExp(`href=["'](?:https?:)?\\/\\/animesalt\\.(?:ac|top)\\/${safeType}\\/([^"'/?#]+)\\/?["']`, "i"))
      || block.match(new RegExp(`href=["']\\/${safeType}\\/([^"'/?#]+)\\/?["']`, "i"));
    const slug = String(hrefM?.[1] || "").trim();
    if (!slug || skipSlugs.has(slug.toLowerCase()) || seen.has(slug)) return;

    const titleM = block.match(/<h[1-4][^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i)
      || block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
      || block.match(/<img\b[^>]*(?:alt|title)=["'](?:Image\s*)?([^"']+)["']/i);
    const imgM = block.match(/<img\b[^>]*(?:data-src|data-original|data-lazy-src|srcset|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i);
    const yearM = block.match(/\bannee-(\d{4})\b/i) || block.match(/\b(?:19|20)\d{2}\b/);
    seen.add(slug);
    out.push({
      slug,
      type: safeType,
      title: titleM ? decode(titleM[1]).replace(/^Image\s+/i, "") : slug.replace(/-/g, " "),
      poster: imgM ? resolveUrl(imgM[1].split(/\s+/)[0], AN_BASE) : "",
      year: yearM ? (yearM[1] || yearM[0]) : "",
      detailUrl: `${AN_BASE}/${safeType}/${slug}/`,
    });
  };

  const liRe = /<li\b[^>]*class=["'][^"']*\b(?:series|movies|movie|type-series|type-movies)\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html))) pushFromBlock(m[0]);

  // Fallback for future layout changes: scan anchors, but only the requested
  // direct content path. This deliberately ignores /series/page/N pagination.
  if (out.length === 0) {
    const hrefRe = new RegExp(`href=["'](?:https?:)?\\/\\/animesalt\\.(?:ac|top)\\/${safeType}\\/([^"'/?#]+)\\/?["'][^>]*>`, "gi");
    while ((m = hrefRe.exec(html))) {
      const start = Math.max(0, m.index - 900);
      const end = Math.min(html.length, m.index + 1200);
      pushFromBlock(html.slice(start, end));
    }
  }
  return uniqueBy(out, (item) => `${item.type}:${item.slug}`);
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
  return setCache(cacheKey, filterAnimeOnly(out), 15 * 60_000) as any[];
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

  const addEpisode = (epSlug: string, defaultSeason: number, rawTitle = "", strictSeason = false) => {
    const cleanSlug = String(epSlug || "").trim().replace(/^\/+|\/+$/g, "");
    if (!cleanSlug) return;
    const sx = cleanSlug.match(/(?:^|[-_])(\d+)x(\d+)$/i) || cleanSlug.match(/s(\d+)e(\d+)$/i);
    const seasonNum = sx ? Number(sx[1]) : defaultSeason;
    const epNum = sx ? Number(sx[2]) : 0;
    if (!Number.isFinite(seasonNum) || seasonNum <= 0) return;
    // Strict mode: reject episode slugs whose encoded season differs from the
    // season AnimeSalt is actually serving. Prevents S2/S3/S4 leakage from
    // cross-links on the main page or "related" strips.
    if (strictSeason && seasonNum !== defaultSeason) return;
    if (!seasons.has(seasonNum)) seasons.set(seasonNum, { name: `Season ${seasonNum}`, seasonNumber: seasonNum, episodes: [] });
    const bucket = seasons.get(seasonNum)!.episodes;
    if (bucket.some((e) => e.slug === cleanSlug)) return;
    const number = epNum || bucket.length + 1;
    bucket.push({
      number,
      episodeNumber: number,
      title: decode(rawTitle).replace(/\s+/g, " ") || `Episode ${number}`,
      slug: cleanSlug,
      link: `animesalt://${cleanSlug}`,
    });
  };

  const harvestEpisodes = (body: string, defaultSeason: number, strictSeason = false) => {
    const hrefRe = /href=["'](?:https?:\/\/animesalt\.(?:ac|top))?\/episode\/([^"'/?#]+)\/?["']/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(body))) {
      const start = Math.max(0, m.index - 250);
      const end = Math.min(body.length, m.index + 1200);
      const around = body.slice(start, end);
      const anchor = around.match(/<a\b[^>]*href=["'](?:https?:\/\/animesalt\.(?:ac|top))?\/episode\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
      addEpisode(m[1], defaultSeason, anchor?.[1] || "", strictSeason);
    }
    const urlRe = /(?:https?:)?\\?\/\\?\/animesalt\.(?:ac|top)\\?\/episode\\?\/([a-z0-9-]+)\\?\/?/gi;
    while ((m = urlRe.exec(body))) addEpisode(m[1], defaultSeason, "", strictSeason);
  };

  const postId = html.match(/data-post=["'](\d+)["']/)?.[1];
  const seasonNums = Array.from(new Set(
    Array.from(html.matchAll(/data-season=["'](\d+)["']/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0),
  )).sort((a, b) => a - b);

  // Only harvest from the static HTML if AnimeSalt didn't expose a season
  // selector — otherwise the AJAX responses are the authoritative source per
  // season and the static HTML tends to contain cross-links to unrelated seasons.
  if (!postId || !seasonNums.length) {
    harvestEpisodes(html, 1, true);
  }

  if (postId && seasonNums.length) {
    await Promise.all(seasonNums.map(async (sNum) => {
      try {
        const seasonHtml = await fetchText(`${AN_BASE}/wp-admin/admin-ajax.php?action=action_select_season&season=${sNum}&post=${postId}`, {
          headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html,*/*" },
        });
        // Strict: only accept episodes whose slug encodes this exact season.
        harvestEpisodes(seasonHtml, sNum, true);
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
  let lastStatus = 0;
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PLAYER_TIMEOUT_MS);
    try {
      const res = await fetch(master, { signal: ac.signal, headers, redirect: "follow" });
      lastStatus = res.status;
      if (res.ok) {
        const text = await res.text();
        if (/^#EXTM3U/i.test(text)) return setCache(`master:${master}`, text, 2 * 60_000) as string;
      } else {
        try { await res.body?.cancel(); } catch {}
      }
    } catch {
      // Try the next header/referrer combination. AnimeSalt CDNs sometimes
      // reject one referrer style while accepting another.
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`AN HLS upstream failed ${lastStatus || "network"}`);
}

function getSafeOrigin(value?: string | null) {
  const raw = decode(value || "");
  if (!raw) return "";
  try { return new URL(raw).origin; } catch { return ""; }
}

function wrapHlsUrl(raw: string, baseUrl: string, proxyPrefix: string, parentOrigin = "") {
  const value = decode(raw || "");
  if (!value || value.startsWith("data:")) return value;
  if (/\/an-api\/hls\?url=/i.test(value)) return value;
  const abs = /^https?:\/\//i.test(value) ? value : resolveUrl(value, baseUrl);
  const params = new URLSearchParams({ url: abs });
  const inheritedOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  // Preserve the playlist origin for its child playlists/segments.  AnimeSalt
  // often serves playlists from as-cdn21 and segments from as-cdn22; using the
  // segment host as Origin/Referer makes as-cdn22 return 500, which surfaced in
  // the player as repeated 502/504 proxy errors.
  if (inheritedOrigin) params.set("origin", inheritedOrigin);
  return `${proxyPrefix}?${params.toString()}`;
}

function rewriteM3U8(body: string, baseUrl: string, proxyPrefix: string, parentOrigin = "") {
  const playlistOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  const rewriteUriAttr = (line: string) => line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapHlsUrl(uri, baseUrl, proxyPrefix, playlistOrigin)}"`);
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#")) return /URI="/i.test(line) ? rewriteUriAttr(raw) : raw;
    return wrapHlsUrl(line, baseUrl, proxyPrefix, playlistOrigin);
  }).join("\n");
}

const isLikelySegmentUrl = (url: URL) => /\.(?:ts|m4s|js|mp4|aac)(?:$|\?)/i.test(url.pathname) || /\/p\//i.test(url.pathname);
const isLikelyPlaylistUrl = (url: URL) => /\.m3u8(?:$|\?)/i.test(url.pathname) || !isLikelySegmentUrl(url);

async function fetchHlsUpstream(req: Request, targetUrl: URL, parentOrigin: string) {
  const range = req.headers.get("range");
  const playlist = isLikelyPlaylistUrl(targetUrl);
  const accept = playlist ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,video/*,*/*";
  const refererOrigin = getSafeOrigin(parentOrigin) || targetUrl.origin;
  const baseHeaders: Record<string, string> = {
    "User-Agent": UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${refererOrigin}/`,
  };
  if (range) baseHeaders.Range = range;

  // Do not send Origin on the first attempts. The CDN accepts the same segment
  // with no Origin (or playlist-origin Origin) but returns 500 when Origin is the
  // segment host, which was the exact 502 loop users saw in playback.
  const attempts: Record<string, string>[] = [
    baseHeaders,
    { ...baseHeaders, Referer: `${targetUrl.origin}/` },
    ...(playlist ? [{ ...baseHeaders, Origin: refererOrigin }] : []),
  ];

  let lastStatus = 0;
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
      const res = await fetch(targetUrl.toString(), {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: ac.signal,
        redirect: "follow",
      });
      lastStatus = res.status;
      if (res.ok || res.status === 206 || res.status === 304) return res;
      try { await res.body?.cancel(); } catch {}
    } catch {
      // Try the next safe header profile.
    } finally {
      clearTimeout(timer);
    }
  }
  return { errorStatus: lastStatus } as const;
}

async function hlsProxy(req: Request, target: string, proxyPrefix: string) {
  let targetUrl: URL;
  try { targetUrl = new URL(target); } catch { return new Response("bad url", { status: 400, headers: cors }); }
  if (!/^https?:$/i.test(targetUrl.protocol)) return new Response("blocked protocol", { status: 400, headers: cors });
  const reqUrl = new URL(req.url);
  const parentOrigin = getSafeOrigin(reqUrl.searchParams.get("origin") || reqUrl.searchParams.get("parent") || reqUrl.searchParams.get("ref")) || targetUrl.origin;
  const upstream = await fetchHlsUpstream(req, targetUrl, parentOrigin);
  if (!(upstream instanceof Response)) return new Response(`AN upstream fetch failed: ${upstream.errorStatus || "network"}`, { status: 502, headers: cors });

  const h = new Headers(cors);
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }
  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  // Do NOT treat every /hls/ URL as a playlist: AnimeSalt often serves TS
  // fragments as .js files under /hls/ or /p/. Rewriting those binary segments
  // as text corrupts playback and leaves the player stuck on loading.
  const isM3u8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:\?|$)/i.test(targetUrl.pathname);
  if (isM3u8) {
    h.delete("content-length");
    h.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
    h.set("cache-control", "no-store");
    if (req.method === "HEAD") return new Response(null, { status: upstream.status, headers: h });
    return new Response(rewriteM3U8(await upstream.text(), targetUrl.toString(), proxyPrefix, parentOrigin), { status: upstream.status, headers: h });
  }
  if (/\.(?:ts|m4s|js)(?:$|\?)/i.test(targetUrl.pathname) || /\/p\//i.test(targetUrl.pathname) || /javascript|text\/plain/i.test(ct)) {
    h.set("content-type", /\.m4s/i.test(targetUrl.pathname) ? "video/iso.segment" : "video/mp2t");
    h.set("content-disposition", "inline");
  }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  if (req.method === "HEAD") return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: h });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
}

function responseCookie(headers: Headers) {
  const raw = headers.get("set-cookie") || "";
  return raw.split(/,(?=\s*[^;,]+=)/).map((part) => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function postPlayerJson(embedUrl: string, hash: string) {
  const origin = new URL(embedUrl).origin;
  let cookie = "";
  try {
    const page = await fetch(embedUrl, { headers: { "User-Agent": UA, Referer: `${AN_BASE}/` }, redirect: "follow" });
    cookie = responseCookie(page.headers);
    try { await page.body?.cancel(); } catch {}
  } catch {}
  const endpoint = `${origin}/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/javascript,*/*;q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: embedUrl,
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({ hash, r: `${AN_BASE}/` }).toString(),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`player ajax ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function extractFromPlayer(embedUrl: string, forceRefresh = false) {
  const cacheKey = `extract:${embedUrl}`;
  const cached = getCache<any>(cacheKey, forceRefresh);
  if (cached) return cached;
  const hash = new URL(embedUrl).pathname.match(/\/video\/([A-Za-z0-9_-]+)/)?.[1] || "";
  if (!hash) throw new Error("AN embed hash not found");
  const origin = new URL(embedUrl).origin;
  const jData = await postPlayerJson(embedUrl, hash);
  const master = String(jData?.videoSource || jData?.securedLink || "").replace(/\\\//g, "/");
  if (!master) throw new Error("AN player did not return HLS source");
  const body = await fetchMaster(master, embedUrl, origin);
  const parsedMaster = parseMaster(master, body);
  // Some AnimeSalt/CDN playlists reject Edge-side validation but still play
  // correctly through the browser HLS proxy. Never drop a valid master just
  // because the server probe failed — that was causing endless loading.
  const filtered = await filterWorkingHls(parsedMaster, embedUrl, origin).catch(() => null);
  const parsed = filtered?.streams?.length ? filtered : parsedMaster;
  const streams = parsed.streams?.length ? parsed.streams : [{ url: master, label: "Auto", height: 0, bandwidth: 0, resolution: "" }];
  const out = {
    success: true,
    embedUrl,
    directUrl: master,
    videoSource: master,
    securedLink: master,
    poster: jData?.videoImage || "",
    sources: [{ type: "hls", master, videoSource: master, securedLink: master, streams, audio: parsed.audio || [] }],
    streams,
    audio: parsed.audio || [],
    links: streams.map((s: any) => ({ label: s.label, quality: s.label, height: s.height, url: s.url })),
    defaultAudioIdx: parsed.defaultAudioIdx || 0,
    preferredAudio: parsed.preferredAudio || "",
  };
  return setCache(cacheKey, out, 5 * 60_000);
}

async function episode(slug: string, type = "", forceRefresh = false) {
  if (!isAllowedAnimeItem({ slug, title: slug })) {
    return { success: false, blocked: true, animeOnly: true, slug, error: "Blocked non-anime/cartoon slug" };
  }
  const t = type === "movies" || type === "movie" ? "movies" : "episode";
  const pageUrl = t === "movies" ? `${AN_BASE}/movies/${slug}/` : `${AN_BASE}/episode/${slug}/`;
  const html = await fetchText(pageUrl);
  const embeds = collectEmbedsFromHtml(html);
  let lastErr = "";
  for (const embed of embeds) {
    try {
      const data = await extractFromPlayer(embed, forceRefresh);
      return { ...data, slug, pageUrl, allEmbeds: embeds };
    } catch (e) {
      lastErr = (e as Error)?.message || String(e);
    }
  }
  throw new Error(`No playable AN embed found${lastErr ? `: ${lastErr}` : ""}`);
}

const API_ENDPOINTS = {
  ok: true,
  name: "AnimeSalt Stream API — NEW ultra fast stable",
  subtitles: false,
  endpoints: { series: "/series?page=1", movies: "/movies?page=1", search: "/search?q=naruto", anime: "/anime?slug=naruto&type=series", episode: "/episode?slug=naruto-1x1", embed: "/embed?url=...", playback: "/functions/v1/an-playback/hls?url=..." },
};

async function browse(type: string, page = 1, forceRefresh = false) {
  const safeType = type === "movies" ? "movies" : "series";
  const safePage = Math.max(1, Number(page || 1));
  const cacheKey = `browse:${safeType}:${safePage}`;
  const cached = getCache<any>(cacheKey, forceRefresh);
  if (cached) return cached;
  const listUrl = safePage > 1 ? `${AN_BASE}/${safeType}/page/${safePage}/` : `${AN_BASE}/${safeType}/`;
  try {
    const html = await fetchText(listUrl);
    const items = parseBrowseItems(html, safeType);
    const filtered = filterAnimeOnly(items);
    return setCache(cacheKey, { html, items: filtered, currentPage: safePage, maxPage: parseMaxPage(html, safeType), totalCount: filtered.length }, 15 * 60_000);
  } catch (e) {
    if (safePage > 1 && /Upstream\s+404/i.test((e as Error)?.message || String(e))) {
      return { html: "", items: [], currentPage: safePage, maxPage: safePage - 1, totalCount: 0 };
    }
    throw e;
  }
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
      return json(filterAnimeOnly(await search(q.trim())));
    }
    if (path === "/series" || path === "/movies") {
      const result = await browse(path === "/movies" ? "movies" : "series", Number(url.searchParams.get("page") || 1), url.searchParams.get("force") === "1");
      return json({ success: true, ...result, items: filterAnimeOnly(result.items || []) });
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
      const playback = new URL(`${publicProtocol}//${url.host}${normalizedPrefix}/an-playback/hls`.replace(/([^:]\/)\/+/g, "$1"));
      playback.searchParams.set("url", target);
      const origin = url.searchParams.get("origin") || url.searchParams.get("parent") || url.searchParams.get("ref") || "";
      if (origin) playback.searchParams.set("origin", origin);
      return new Response(null, { status: 302, headers: { ...cors, Location: playback.toString(), "Cache-Control": "no-store" } });
    }
    return json({ error: "not found", path }, 404);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
