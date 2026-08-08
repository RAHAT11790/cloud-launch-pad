// 🆕 NEW v2 (2026-07-04) — Opaque src token + strict router. REDEPLOY REQUIRED.
// After deploy, paste this URL back into Admin → EGD Router.
// ============================================================
// Cloudflare Worker port of Supabase Edge Function: an-api
// Ported automatically — replace CF_URL in EGD/Cloudflare Manager
// ============================================================
const AN_BASE = "https://animesalt.link";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TEXT_TIMEOUT_MS = 7e3;
const PLAYER_TIMEOUT_MS = 6500;
const API_CACHE_VERSION = "v9-codecs-playback";
const cache = /* @__PURE__ */ new Map();
const getCache = (key, forceRefresh = false) => {
  if (forceRefresh) {
    cache.delete(key);
    return null;
  }
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.ts > hit.ttl) {
    if (hit) cache.delete(key);
    return null;
  }
  return hit.data;
};
const setCache = (key, data, ttl) => {
  cache.set(key, { ts: Date.now(), ttl, data });
  if (cache.size > 300) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return data;
};
const CARTOON_BLOCK_RE = /\b(?:ben\s*10|alien\s*swarm|omniverse|ultimate\s*alien|generator\s*rex|teen\s*titans|justice\s*league|batman|superman|spider\s*man|avengers|tom\s*(?:and|&)\s*jerry|looney\s*tunes|scooby\s*doo|powerpuff|courage\s*the\s*cowardly|regular\s*show|adventure\s*time|gumball|samurai\s*jack|kung\s*fu\s*panda|madagascar|minions|despicable\s*me|cars|toy\s*story|frozen|shrek|ice\s*age|hotel\s*transylvania|rio|moana|tangled|how\s*to\s*train\s*your\s*dragon|avatar\s*the\s*last\s*airbender|sponge\s*bob|nickelodeon|cartoon\s*network|disney|pixar|tintin|tin\s*tin|jurassic\s*world|sausage\s*party|maya\s*and\s*the\s*three|hazbin\s*hotel|captain\s*laserhawk|invincible|zig\s*and\s*sharko|twilight\s*of\s*the\s*gods|arcane|jentry\s*chau|vox\s*machina|dragon\s*prince|castlevania)\b/i;
const ANIME_ALLOW_RE = /\b(?:pokemon|pokémon|doraemon|shin\s*chan|crayon\s*shin|naruto|boruto|one\s*piece|dragon\s*ball|bleach|demon\s*slayer|jujutsu\s*kaisen|attack\s*on\s*titan|detective\s*conan|solo\s*leveling)\b/i;
function isAllowedAnimeItem(item) {
  const blob = `${item?.title || ""} ${item?.slug || ""}`.replace(/[-_]+/g, " ").toLowerCase();
  if (!blob.trim()) return false;
  if (ANIME_ALLOW_RE.test(blob)) return true;
  return !CARTOON_BLOCK_RE.test(blob);
}
const filterAnimeOnly = (items) => Array.isArray(items) ? items.filter(isAllowedAnimeItem) : [];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400"
};
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
});
const decode = (s) => String(s || "").replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/\\u003d/g, "=").replace(/\\u003f/g, "?").replace(/\\u002f/gi, "/").replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "-").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim();
const resolveUrl = (value, baseUrl) => {
  const raw = decode(value);
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
};
function safeAtob(value) {
  try {
    return atob(value);
  } catch {
  }
  try {
    return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
  }
  return "";
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchText(url, init) {
  const target = new URL(url);
  let lastStatus = 0;
  let lastErr = "network";
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TEXT_TIMEOUT_MS + attempt * 1500);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: target.origin === AN_BASE ? `${AN_BASE}/` : `${target.origin}/`,
          ...init?.headers || {}
        },
        redirect: "follow"
      });
      lastStatus = res.status;
      if (res.ok) return await res.text();
      lastErr = `Upstream ${res.status}`;
      try {
        await res.body?.cancel();
      } catch {
      }
      if (res.status === 404) break;
    } catch (e) {
      lastErr = e?.name === "AbortError" ? "timeout" : e?.message || "network";
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await delay(180 + attempt * 320);
  }
  throw new Error(`${lastErr}${lastStatus ? ` (${lastStatus})` : ""} for ${url}`);
}
function parseHlsAttrs(line) {
  const attrs = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m;
  while (m = re.exec(body)) attrs[m[1].toUpperCase()] = String(m[2] || "").replace(/^"|"$/g, "");
  return attrs;
}
function uniqueBy(items, getKey) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const key = getKey(item).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function parseMaxPage(html, type) {
  const safeType = type === "movies" ? "movies" : "series";
  const nums = [1];
  const re = new RegExp(`/${safeType}/page/(\\d+)/`, "gi");
  let m;
  while (m = re.exec(html)) nums.push(Number(m[1]));
  const title = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  if (title) nums.push(Number(title[1]));
  return Math.max(...nums.filter((n) => Number.isFinite(n) && n > 0));
}
function parseBrowseItems(html, type) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const safeType = type === "movies" ? "movies" : "series";
  const skipSlugs = /* @__PURE__ */ new Set(["page", "feed", "wp-json", "category", "tag", "author"]);
  const pushFromBlock = (block) => {
    const hrefM = block.match(new RegExp(`href=["'](?:https?:)?\\/\\/animesalt\\.(?:ac|top)\\/${safeType}\\/([^"'/?#]+)\\/?["']`, "i")) || block.match(new RegExp(`href=["']\\/${safeType}\\/([^"'/?#]+)\\/?["']`, "i"));
    const slug = String(hrefM?.[1] || "").trim();
    if (!slug || skipSlugs.has(slug.toLowerCase()) || seen.has(slug)) return;
    const titleM = block.match(/<h[1-4][^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i) || block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || block.match(/<img\b[^>]*(?:alt|title)=["'](?:Image\s*)?([^"']+)["']/i);
    const imgM = block.match(/<img\b[^>]*(?:data-src|data-original|data-lazy-src|srcset|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/i);
    const yearM = block.match(/\bannee-(\d{4})\b/i) || block.match(/\b(?:19|20)\d{2}\b/);
    seen.add(slug);
    out.push({
      slug,
      type: safeType,
      title: titleM ? decode(titleM[1]).replace(/^Image\s+/i, "") : slug.replace(/-/g, " "),
      poster: imgM ? resolveUrl(imgM[1].split(/\s+/)[0], AN_BASE) : "",
      year: yearM ? yearM[1] || yearM[0] : "",
      detailUrl: `${AN_BASE}/${safeType}/${slug}/`
    });
  };
  const liRe = /<li\b[^>]*class=["'][^"']*\b(?:series|movies|movie|type-series|type-movies)\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;
  let m;
  while (m = liRe.exec(html)) pushFromBlock(m[0]);
  if (out.length === 0) {
    const hrefRe = new RegExp(`href=["'](?:https?:)?\\/\\/animesalt\\.(?:ac|top)\\/${safeType}\\/([^"'/?#]+)\\/?["'][^>]*>`, "gi");
    while (m = hrefRe.exec(html)) {
      const start = Math.max(0, m.index - 900);
      const end = Math.min(html.length, m.index + 1200);
      pushFromBlock(html.slice(start, end));
    }
  }
  return uniqueBy(out, (item) => `${item.type}:${item.slug}`);
}
async function search(q) {
  const cacheKey = `search:${q.toLowerCase().trim()}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const html = await fetchText(`${AN_BASE}/?s=${encodeURIComponent(q)}`);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const itemRe = /<li[^>]*class=["'][^"']*post-\d+[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let item;
  while (item = itemRe.exec(html)) {
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
      detailUrl: `${AN_BASE}/${type}/${slug}/`
    });
  }
  if (out.length === 0) {
    const hrefRe = /href=["']https?:\/\/animesalt\.(?:ac|top)\/(series|movies)\/([^"'/?#]+)\/?["'][\s\S]{0,900}/gi;
    let m;
    while (m = hrefRe.exec(html)) {
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
  return setCache(cacheKey, filterAnimeOnly(out), 15 * 6e4);
}
async function detail(slug, type, forceRefresh = false) {
  const t = type === "movies" ? "movies" : "series";
  const cacheKey = `detail:${API_CACHE_VERSION}:${t}:${slug}`;
  const cached = getCache(cacheKey, forceRefresh);
  if (cached) return cached;
  const html = await fetchText(`${AN_BASE}/${t}/${slug}/`);
  const titleM = html.match(/<meta property=["']og:title["'] content=["']([^"']+)/i) || html.match(/<title>([^<]+)/i);
  const posterM = html.match(/<meta property=["']og:image["'] content=["']([^"']+)/i);
  const descM = html.match(/<meta name=["']description["'] content=["']([^"']+)/i) || html.match(/<meta property=["']og:description["'] content=["']([^"']+)/i);
  const seasons = /* @__PURE__ */ new Map();
  const addEpisode = (epSlug, defaultSeason, rawTitle = "", strictSeason = false) => {
    const cleanSlug = String(epSlug || "").trim().replace(/^\/+|\/+$/g, "");
    if (!cleanSlug) return false;
    const sx = cleanSlug.match(/(?:^|[-_])(\d+)x(\d+)$/i) || cleanSlug.match(/s(\d+)e(\d+)$/i);
    const seasonNum = sx ? Number(sx[1]) : defaultSeason;
    const epNum = sx ? Number(sx[2]) : 0;
    if (!Number.isFinite(seasonNum) || seasonNum <= 0) return false;
    if (strictSeason && seasonNum !== defaultSeason) return false;
    if (!seasons.has(seasonNum)) seasons.set(seasonNum, { name: `Season ${seasonNum}`, seasonNumber: seasonNum, episodes: [] });
    const bucket = seasons.get(seasonNum).episodes;
    if (bucket.some((e) => e.slug === cleanSlug)) return false;
    const number = epNum || bucket.length + 1;
    bucket.push({
      number,
      episodeNumber: number,
      title: decode(rawTitle).replace(/\s+/g, " ") || `Episode ${number}`,
      slug: cleanSlug,
      link: `animesalt://${cleanSlug}`
    });
    return true;
  };
  const harvestEpisodes = (body, defaultSeason, strictSeason = false) => {
    let added = 0;
    const hrefRe = /href=["'](?:https?:\/\/animesalt\.(?:ac|top))?\/episode\/([^"'/?#]+)\/?["']/gi;
    let m;
    while (m = hrefRe.exec(body)) {
      const start = Math.max(0, m.index - 250);
      const end = Math.min(body.length, m.index + 1200);
      const around = body.slice(start, end);
      const anchor = around.match(/<a\b[^>]*href=["'](?:https?:\/\/animesalt\.(?:ac|top))?\/episode\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
      if (addEpisode(m[1], defaultSeason, anchor?.[1] || "", strictSeason)) added++;
    }
    const urlRe = /(?:https?:)?\\?\/\\?\/animesalt\.(?:ac|top)\\?\/episode\\?\/([a-z0-9-]+)\\?\/?/gi;
    while (m = urlRe.exec(body)) if (addEpisode(m[1], defaultSeason, "", strictSeason)) added++;
    return added;
  };
  const harvestEpisodesFromSeasonRanges = (buttons) => {
    let added = 0;
    for (const button of buttons) {
      if (!button.regional) continue;
      const text = button.text || "";
      const range = text.match(/(?:^|\D)(\d{1,4})\s*-\s*(\d{1,4})(?:\D|$)/);
      const count = text.match(/\((\d{1,4})\)/);
      if (!range) continue;
      const start = Number(range[1]);
      const end = Number(range[2]);
      const expected = count ? Number(count[1]) : end - start + 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start || end - start > 250) continue;
      if (Number.isFinite(expected) && expected > 0 && expected !== end - start + 1) continue;
      for (let ep = start; ep <= end; ep++) {
        if (addEpisode(`${slug}-${button.season}x${ep}`, button.season, `Episode ${ep}`, true)) added++;
      }
    }
    return added;
  };
  const postId = html.match(/data-post=["'](\d+)["']/)?.[1];
  const seasonButtons = [];
  const seasonBtnRe = /<a\b[^>]*data-post=["'](\d+)["'][^>]*data-season=["'](\d+)["'][^>]*>[\s\S]*?<\/a>/gi;
  let btn;
  while (btn = seasonBtnRe.exec(html)) {
    const raw = btn[0] || "";
    const s = Number(btn[2]);
    if (!Number.isFinite(s) || s <= 0) continue;
    const text = decode(raw).replace(/\s+/g, " ").trim();
    const isSubOnly = /\bnon-regional\b/i.test(raw) || /\[(?:sub|subbed)\]/i.test(text) || /\bsubbed\s*only\b/i.test(text);
    seasonButtons.push({ season: s, postId: btn[1], html: raw, text, regional: !isSubOnly });
  }
  const rawSeasonNums = Array.from(new Set(
    Array.from(html.matchAll(/data-season=["'](\d+)["']/g)).map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0)
  )).sort((a, b) => a - b);
  const regionalSeasonNums = seasonButtons.length ? Array.from(new Set(seasonButtons.filter((b) => b.regional).map((b) => b.season))).sort((a, b) => a - b) : rawSeasonNums;
  const seasonNums = regionalSeasonNums.length ? regionalSeasonNums : rawSeasonNums;
  const rangeGenerated = seasonButtons.length ? harvestEpisodesFromSeasonRanges(seasonButtons) : 0;
  if (!rangeGenerated && (!postId || !seasonNums.length)) {
    harvestEpisodes(html, 1, true);
  }
  if (!rangeGenerated && postId && seasonNums.length) {
    const CONCURRENCY = 8;
    let cursor = 0;
    const htmlBySeason = /* @__PURE__ */ new Map();
    const workers = Array.from({ length: Math.min(CONCURRENCY, seasonNums.length) }, async () => {
      while (cursor < seasonNums.length) {
        const sNum = seasonNums[cursor++];
        try {
          const seasonHtml = await fetchText(`${AN_BASE}/wp-admin/admin-ajax.php?action=action_select_season&season=${sNum}&post=${postId}`, {
            headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html,*/*", Referer: `${AN_BASE}/${t}/${slug}/` }
          });
          htmlBySeason.set(sNum, seasonHtml);
        } catch {
        }
      }
    });
    await Promise.all(workers);
    for (const sNum of seasonNums) {
      const seasonHtml = htmlBySeason.get(sNum);
      if (!seasonHtml) continue;
      harvestEpisodes(seasonHtml, sNum, true);
    }
  }
  let seasonsArr = Array.from(seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber).map((s) => ({
    name: s.name,
    seasonNumber: s.seasonNumber,
    episodes: s.episodes.sort((a, b) => a.number - b.number)
  }));
  const trimmedTailEpisodes = [];
  let tailProbes = 0;
  const MAX_TAIL_PROBES = 8;
  outer: for (let si = seasonsArr.length - 1; si >= 0; si--) {
    const season = seasonsArr[si];
    while (season.episodes.length && tailProbes < MAX_TAIL_PROBES) {
      const last = season.episodes[season.episodes.length - 1];
      tailProbes++;
      const ok = await verifyEpisodeHindiPlayable(last.slug);
      if (ok) break outer;
      trimmedTailEpisodes.push(last.slug);
      season.episodes.pop();
    }
  }
  seasonsArr = seasonsArr.filter((s) => s.episodes.length > 0);
  return setCache(cacheKey, {
    slug,
    type: t,
    title: titleM ? decode(titleM[1]) : slug.replace(/-/g, " "),
    poster: posterM ? resolveUrl(posterM[1], AN_BASE) : "",
    storyline: descM ? decode(descM[1]) : "",
    postId: postId || null,
    seasonNumbers: seasonNums,
    sourceSeasonNumbers: rawSeasonNums,
    skippedSubOnlySeasons: rawSeasonNums.filter((n) => !seasonNums.includes(n)),
    trimmedTailEpisodes,
    seasons: seasonsArr,
    episodeCount: seasonsArr.reduce((n, s) => n + s.episodes.length, 0),
    hindiFiltered: t !== "movies",
    playbackPolicy: "fast-season-index; episode playback accepts only separate video playlists + separate Hindi audio"
  }, 60 * 6e4);
}
async function verifyEpisodeHindiPlayable(epSlug) {
  const key = `playable:${API_CACHE_VERSION}:${epSlug}`;
  const cached = getCache(key);
  if (cached !== null) return cached;
  try {
    const data = await episode(epSlug, "", false);
    const ok = !!data?.success && Array.isArray(data.streams) && data.streams.length > 0;
    setCache(key, ok, ok ? 6 * 60 * 6e4 : 30 * 6e4);
    return ok;
  } catch {
    setCache(key, false, 10 * 6e4);
    return false;
  }
}
async function verifyHindiPlayableBatch(slugs) {
  const out = /* @__PURE__ */ new Map();
  const CONCURRENCY = 16;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, slugs.length) }, async () => {
    while (cursor < slugs.length) {
      const idx = cursor++;
      const s = slugs[idx];
      out.set(s, await verifyEpisodeHindiPlayable(s));
    }
  });
  await Promise.all(workers);
  return out;
}
function collectEmbedsFromHtml(html) {
  const out = /* @__PURE__ */ new Set();
  const push = (value) => {
    const raw = decode(value || "");
    const abs = raw.startsWith("//") ? `https:${raw}` : raw;
    if (/^https?:\/\/[^\s"'<>]+\/video\/[a-f0-9]{16,}/i.test(abs)) out.add(abs);
    if (/^https?:\/\/megaplay\.buzz\/stream\/s-\d+\/\d+\/(?:sub|dub)\b/i.test(abs)) out.add(abs);
  };
  const attrRe = /(?:src|data-src|data-embed|data-player|data-video|href)=["']([^"']+)["']/gi;
  let m;
  while (m = attrRe.exec(html)) push(m[1]);
  const anyRe = /https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]{16,}/gi;
  while (m = anyRe.exec(html)) push(m[0]);
  const megaRe = /https?:\/\/megaplay\.buzz\/stream\/s-\d+\/\d+\/(?:sub|dub)\b/gi;
  while (m = megaRe.exec(html)) push(m[0]);
  const multiRe = /multi-lang-plyr\/player\.php\?data=([A-Za-z0-9_\-=+/]+)/gi;
  while (m = multiRe.exec(html)) {
    const decoded = safeAtob(m[1]);
    if (!decoded) continue;
    try {
      const arr = JSON.parse(decoded);
      if (Array.isArray(arr)) arr.forEach((item) => push(String(item?.link || "")));
    } catch {
    }
  }
  return Array.from(out).sort((a, b) => {
    const ad = /\/dub\b/i.test(a) ? 0 : 1;
    const bd = /\/dub\b/i.test(b) ? 0 : 1;
    return ad - bd;
  });
}
function parseMaster(masterUrl, body) {
  const base = new URL(masterUrl);
  const baseOrigin = `${base.protocol}//${base.host}`;
  const resolve = (u) => /^https?:\/\//i.test(u) ? u : u.startsWith("/") ? baseOrigin + u : new URL(u, masterUrl).toString();
  const streamsWithAudio = [];
  const streamsMixed = [];
  const audio = [];
  const lines = body.split(/\r?\n/);
  let hasAudioGroup = false;
  const HINDI_RE = /hindi|हिन्दी|हिंदी|\bhin\b/i;
  const ENGLISH_RE = /english|\beng\b|\ben\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      hasAudioGroup = true;
      const attrs = parseHlsAttrs(line);
      const uri = attrs.URI || "";
      if (uri) {
        const name = attrs.NAME || attrs.LANGUAGE || `Audio ${audio.length + 1}`;
        const language = attrs.LANGUAGE || "";
        const blob = `${name} ${language}`;
        audio.push({
          language,
          name,
          uri: resolve(uri),
          default: /YES/i.test(attrs.DEFAULT || ""),
          isHindi: HINDI_RE.test(blob),
          isEnglish: ENGLISH_RE.test(blob)
        });
      }
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      const attrs = parseHlsAttrs(line);
      const res = attrs.RESOLUTION || "";
      const height = res ? Number(res.split("x")[1]) : 0;
      const label = attrs.NAME || (height ? `${height}p` : "Auto");
      const entry = { url: resolve(next), filename: `${label}.m3u8`, resolution: res, height, bandwidth: Number(attrs.BANDWIDTH || 0), codecs: attrs.CODECS || "", label };
      if (attrs.AUDIO) streamsWithAudio.push(entry);
      else streamsMixed.push(entry);
    }
  }
  const streams = (streamsWithAudio.length > 0 ? streamsWithAudio : streamsMixed).sort((a, b) => b.height - a.height);
  const uniqueAudio = uniqueBy(audio, (a) => a.uri);
  const hindiIdx = uniqueAudio.findIndex((a) => a.isHindi);
  const englishIdx = uniqueAudio.findIndex((a) => a.isEnglish);
  let rejected = "";
  let defaultIdx = 0;
  if (hasAudioGroup && uniqueAudio.length > 0) {
    if (hindiIdx >= 0) defaultIdx = hindiIdx;
    else if (englishIdx >= 0) defaultIdx = englishIdx;
    else rejected = "no Hindi or English audio track";
  }
  if (streams.length === 0) rejected = rejected || "no playable variants in master";
  uniqueAudio.forEach((a, i) => {
    a.default = i === defaultIdx;
  });
  const separateAudioVideo = streamsWithAudio.length > 0 && uniqueAudio.length > 0;
  return {
    streams: rejected ? [] : uniqueBy(streams, (s) => s.url),
    audio: rejected ? [] : uniqueAudio,
    defaultAudioIdx: defaultIdx,
    preferredAudio: rejected ? "" : uniqueAudio[defaultIdx]?.name || "",
    separateAudioVideo,
    hasAudioGroup,
    mixedFallback: streamsWithAudio.length === 0 && streamsMixed.length > 0,
    rejected
  };
}
function firstMediaUrl(body, baseUrl) {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return resolveUrl(line, baseUrl);
  }
  return "";
}
async function fetchHlsText(url, embedUrl, origin) {
  return await fetchMaster(url, embedUrl, origin);
}
async function isWorkingMediaPlaylist(url, embedUrl, origin) {
  try {
    const body = await fetchHlsText(url, embedUrl, origin);
    if (!/^#EXTM3U/i.test(body)) return false;
    if (/#EXT-X-STREAM-INF/i.test(body)) return true;
    if (!/#EXTINF:/i.test(body) && !/#EXT-X-MAP/i.test(body)) return false;
    return !!firstMediaUrl(body, url) || /#EXT-X-MAP/i.test(body);
  } catch {
    return false;
  }
}
async function filterWorkingHls(parsed, embedUrl, origin) {
  if (parsed?.separateAudioVideo !== true) {
    return { streams: [], audio: [], defaultAudioIdx: 0, preferredAudio: "", separateAudioVideo: false, rejected: "mixed/master-only HLS rejected" };
  }
  const [streams, audio] = await Promise.all([
    Promise.all((parsed.streams || []).map(async (stream) => ({ stream, ok: await isWorkingMediaPlaylist(stream.url, embedUrl, origin) }))),
    Promise.all((parsed.audio || []).map(async (track) => ({ track, ok: await isWorkingMediaPlaylist(track.uri, embedUrl, origin) })))
  ]);
  const workingStreams = streams.filter((entry) => entry.ok).map((entry) => entry.stream);
  const workingAudio = audio.filter((entry) => entry.ok).map((entry) => entry.track);
  const masterHadSeparateAudio = Array.isArray(parsed.audio) && parsed.audio.length > 0;
  if (masterHadSeparateAudio && workingAudio.length === 0) {
    return { streams: [], audio: [], defaultAudioIdx: 0, preferredAudio: "", rejected: "audio tracks failed validation" };
  }
  const hindiIdx = workingAudio.findIndex((a) => a.isHindi);
  const englishIdx = workingAudio.findIndex((a) => a.isEnglish);
  let defaultIdx = 0;
  let rejected = "";
  if (workingAudio.length > 0) {
    if (hindiIdx >= 0) defaultIdx = hindiIdx;
    else if (englishIdx >= 0) defaultIdx = englishIdx;
    else rejected = "no Hindi or English audio track";
  }
  workingAudio.forEach((a, i) => {
    a.default = i === defaultIdx;
  });
  return {
    streams: rejected ? [] : workingStreams,
    audio: rejected ? [] : workingAudio,
    defaultAudioIdx: defaultIdx,
    preferredAudio: rejected ? "" : workingAudio[defaultIdx]?.name || "",
    separateAudioVideo: !rejected && workingStreams.length > 0 && workingAudio.length > 0,
    rejected: rejected || (workingStreams.length === 0 ? "no validated video playlists" : "")
  };
}
async function fetchMaster(master, embedUrl, origin) {
  const c = getCache(`master:${master}`);
  if (c) return c;
  const attempts = [
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*" },
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: `${origin}/`, Origin: origin },
    { "User-Agent": UA, Accept: "application/vnd.apple.mpegurl,*/*", Referer: embedUrl, Origin: origin }
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
        if (/^#EXTM3U/i.test(text)) return setCache(`master:${master}`, text, 2 * 6e4);
      } else {
        try {
          await res.body?.cancel();
        } catch {
        }
      }
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`AN HLS upstream failed ${lastStatus || "network"}`);
}
function getSafeOrigin(value) {
  const raw = decode(value || "");
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}
const toOpaqueUrlToken = (value) => {
  try {
    return btoa(unescape(encodeURIComponent(String(value || "")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
};
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
function wrapHlsUrl(raw, baseUrl, proxyPrefix, parentOrigin = "") {
  const value = decode(raw || "");
  if (!value || value.startsWith("data:")) return value;
  let abs = /^https?:\/\//i.test(value) ? value : resolveUrl(value, baseUrl);
  try {
    const existing = new URL(abs);
    if (/\/(?:an-api|an-playback|hls)(?:\/hls)?$/i.test(existing.pathname) || /\/functions\/v1\/(?:an-api|an-playback|hls)(?:\/hls)?$/i.test(existing.pathname)) {
      abs = existing.searchParams.get("url") || fromOpaqueUrlToken(existing.searchParams.get("src") || "") || abs;
    }
  } catch {
  }
  const params = new URLSearchParams({ src: toOpaqueUrlToken(abs) });
  const inheritedOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  if (inheritedOrigin) params.set("origin", inheritedOrigin);
  return `${proxyPrefix}?${params.toString()}`;
}
function rewriteM3U8(body, baseUrl, proxyPrefix, parentOrigin = "") {
  const playlistOrigin = getSafeOrigin(parentOrigin) || getSafeOrigin(baseUrl);
  const rewriteUriAttr = (line) => line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${wrapHlsUrl(uri, baseUrl, proxyPrefix, playlistOrigin)}"`);
  return body.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith("#")) return /URI="/i.test(line) ? rewriteUriAttr(raw) : raw;
    return wrapHlsUrl(line, baseUrl, proxyPrefix, playlistOrigin);
  }).join("\n");
}
const isLikelySegmentUrl = (url) => /\.(?:ts|m4s|js|mp4|aac)(?:$|\?)/i.test(url.pathname) || /\/p\//i.test(url.pathname);
const isLikelyPlaylistUrl = (url) => /\.m3u8(?:$|\?)/i.test(url.pathname) || !isLikelySegmentUrl(url);
async function fetchHlsUpstream(req, targetUrl, parentOrigin) {
  const range = req.headers.get("range");
  const playlist = isLikelyPlaylistUrl(targetUrl);
  const accept = playlist ? "application/vnd.apple.mpegurl,*/*" : "video/mp2t,video/*,*/*";
  const refererOrigin = getSafeOrigin(parentOrigin) || targetUrl.origin;
  const baseHeaders = {
    "User-Agent": UA,
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${refererOrigin}/`
  };
  if (range) baseHeaders.Range = range;
  const attempts = [
    baseHeaders,
    { ...baseHeaders, Referer: `${targetUrl.origin}/` },
    ...playlist ? [{ ...baseHeaders, Origin: refererOrigin }] : []
  ];
  let lastStatus = 0;
  for (const headers of attempts) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2e4);
    try {
      const res = await fetch(targetUrl.toString(), {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: ac.signal,
        redirect: "follow"
      });
      lastStatus = res.status;
      if (res.ok || res.status === 206 || res.status === 304) return res;
      try {
        await res.body?.cancel();
      } catch {
      }
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  return { errorStatus: lastStatus };
}
async function hlsProxy(req, target, proxyPrefix) {
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("bad url", { status: 400, headers: cors });
  }
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
function responseCookie(headers) {
  const raw = headers.get("set-cookie") || "";
  return raw.split(/,(?=\s*[^;,]+=)/).map((part) => part.split(";")[0].trim()).filter(Boolean).join("; ");
}
async function postPlayerJson(embedUrl, hash) {
  const origin = new URL(embedUrl).origin;
  let cookie = "";
  try {
    const page = await fetch(embedUrl, { headers: { "User-Agent": UA, Referer: `${AN_BASE}/` }, redirect: "follow" });
    cookie = responseCookie(page.headers);
    try {
      await page.body?.cancel();
    } catch {
    }
  } catch {
  }
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
      ...cookie ? { Cookie: cookie } : {}
    },
    body: new URLSearchParams({ hash, r: `${AN_BASE}/` }).toString(),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`player ajax ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
}
async function getMegaPlaySources(embedUrl) {
  const origin = new URL(embedUrl).origin;
  const page = await fetchText(embedUrl, { headers: { Referer: `${AN_BASE}/` } });
  const dataId = page.match(/data-id=["'](\d+)["']/i)?.[1] || page.match(/\bid\s*[:=]\s*["']?(\d{3,})/i)?.[1] || "";
  if (!dataId) throw new Error("MegaPlay data-id not found");
  const res = await fetch(`${origin}/stream/getSources?id=${encodeURIComponent(dataId)}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/javascript,*/*;q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: embedUrl,
      Origin: origin
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`MegaPlay getSources ${res.status}`);
  return await res.json();
}
async function extractFromPlayer(embedUrl, forceRefresh = false) {
  const cacheKey = `extract:${API_CACHE_VERSION}:${embedUrl}`;
  const cached = getCache(cacheKey, forceRefresh);
  if (cached) return cached;
  const origin = new URL(embedUrl).origin;
  const isMegaPlay = /megaplay\.buzz\/stream\//i.test(embedUrl);
  const hash = isMegaPlay ? "" : new URL(embedUrl).pathname.match(/\/video\/([A-Za-z0-9_-]+)/)?.[1] || "";
  if (!isMegaPlay && !hash) throw new Error("AN embed hash not found");
  const jData = isMegaPlay ? await getMegaPlaySources(embedUrl) : await postPlayerJson(embedUrl, hash);
  const master = String(jData?.sources?.file || jData?.videoSource || jData?.securedLink || jData?.file || "").replace(/\\\//g, "/");
  if (!master) throw new Error("AN player did not return HLS source");
  const body = await fetchMaster(master, embedUrl, origin);
  const parsed = parseMaster(master, body);
  if (parsed.rejected || !parsed.streams.length) {
    throw new Error(parsed.rejected || "AN master did not expose any playable variant");
  }
  const hasHindiAudio = (parsed.audio || []).some((a) => a?.isHindi || /hindi|हिन्दी|हिंदी|\bhin\b/i.test(`${a?.name || ""} ${a?.language || ""}`));
  const streams = parsed.streams || [];
  const primaryVideo = streams[0]?.url || "";
  const out = {
    success: true,
    hindiDub: hasHindiAudio,
    separateAudioVideo: parsed.separateAudioVideo === true,
    mixedFallback: parsed.mixedFallback === true,
    embedUrl,
    directUrl: primaryVideo,
    videoSource: primaryVideo,
    securedLink: primaryVideo,
    poster: jData?.videoImage || "",
    sources: [{ type: "hls", separateAudioVideo: parsed.separateAudioVideo === true, streams, audio: parsed.audio || [] }],
    streams,
    audio: parsed.audio || [],
    links: streams.map((s) => ({ label: s.label, quality: s.label, height: s.height, url: s.url })),
    defaultAudioIdx: parsed.defaultAudioIdx || 0,
    preferredAudio: parsed.preferredAudio || ""
  };
  return setCache(cacheKey, out, 5 * 6e4);
}
async function episode(slug, type = "", forceRefresh = false) {
  const cleanSlug = String(slug || "").trim();
  if (/^https?:\/\//i.test(cleanSlug)) {
    return await extractFromPlayer(cleanSlug, forceRefresh);
  }
  if (!isAllowedAnimeItem({ slug: cleanSlug, title: cleanSlug })) {
    return { success: false, blocked: true, animeOnly: true, slug: cleanSlug, error: "Blocked non-anime/cartoon slug" };
  }
  const t = type === "movies" || type === "movie" ? "movies" : "episode";
  const pageUrl = t === "movies" ? `${AN_BASE}/movies/${cleanSlug}/` : `${AN_BASE}/episode/${cleanSlug}/`;
  let html = "";
  try {
    html = await fetchText(pageUrl);
  } catch (e) {
    return { success: false, playable: false, slug: cleanSlug, pageUrl, error: e?.message || String(e), retryable: true };
  }
  const embeds = collectEmbedsFromHtml(html);
  if (!embeds.length) return { success: false, playable: false, slug: cleanSlug, pageUrl, allEmbeds: [], error: "No AN embed found" };
  let lastErr = "";
  for (const embed of embeds) {
    try {
      const data = await extractFromPlayer(embed, forceRefresh);
      return { ...data, slug: cleanSlug, pageUrl, allEmbeds: embeds };
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  return { success: false, playable: false, slug: cleanSlug, pageUrl, allEmbeds: embeds, error: `No playable AN embed found${lastErr ? `: ${lastErr}` : ""}` };
}
const API_ENDPOINTS = {
  ok: true,
  name: "AnimeSalt Stream API \u2014 NEW ultra fast stable",
  subtitles: false,
  endpoints: { series: "/series?page=1", movies: "/movies?page=1", search: "/search?q=naruto", anime: "/anime?slug=naruto&type=series", episode: "/episode?slug=naruto-1x1", embed: "/embed?url=...", playback: "/functions/v1/an-playback/hls?url=..." }
};
async function browse(type, page = 1, forceRefresh = false) {
  const safeType = type === "movies" ? "movies" : "series";
  const safePage = Math.max(1, Number(page || 1));
  const cacheKey = `browse:${safeType}:${safePage}`;
  const cached = getCache(cacheKey, forceRefresh);
  if (cached) return cached;
  const listUrl = safePage > 1 ? `${AN_BASE}/${safeType}/page/${safePage}/` : `${AN_BASE}/${safeType}/`;
  try {
    const html = await fetchText(listUrl);
    const items = parseBrowseItems(html, safeType);
    const filtered = filterAnimeOnly(items);
    return setCache(cacheKey, { html, items: filtered, currentPage: safePage, maxPage: parseMaxPage(html, safeType), totalCount: filtered.length }, 15 * 6e4);
  } catch (e) {
    if (safePage > 1 && /Upstream\s+404/i.test(e?.message || String(e))) {
      return { html: "", items: [], currentPage: safePage, maxPage: safePage - 1, totalCount: 0 };
    }
    throw e;
  }
}
var stdin_default = { async fetch(req, env, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.includes("/an-api") ? url.pathname.split("/an-api")[1] || "/" : url.pathname;
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
      return json({ success: false, error: "unsupported POST body" }, 200);
    }
    if (path === "/" || path === "") return json(API_ENDPOINTS);
    if (path === "/raw") {
      const target = url.searchParams.get("url") || fromOpaqueUrlToken(url.searchParams.get("src") || "");
      if (!target) return json({ success: false, error: "missing ?url=" }, 200);
      return json({ success: true, html: await fetchText(target) });
    }
    if (path === "/search") {
      const q = url.searchParams.get("q") || "";
      if (!q.trim()) return json({ success: false, error: "missing ?q=" }, 200);
      return json(filterAnimeOnly(await search(q.trim())));
    }
    if (path === "/series" || path === "/movies") {
      const result = await browse(path === "/movies" ? "movies" : "series", Number(url.searchParams.get("page") || 1), url.searchParams.get("force") === "1");
      return json({ success: true, ...result, items: filterAnimeOnly(result.items || []) });
    }
    if (path === "/anime") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "series";
      if (!slug) return json({ success: false, error: "missing ?slug=" }, 200);
      return json(await detail(slug, type, url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1"));
    }
    if (path === "/episode") {
      const slug = url.searchParams.get("slug") || "";
      const type = url.searchParams.get("type") || "";
      if (!slug) return json({ success: false, error: "missing ?slug=" }, 200);
      return json(await episode(slug, type, url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1"));
    }
    if (path === "/embed") {
      const embedUrl = url.searchParams.get("url") || "";
      if (!embedUrl) return json({ success: false, error: "missing ?url=" }, 200);
      return json(await extractFromPlayer(embedUrl, url.searchParams.get("force") === "1" || url.searchParams.get("refresh") === "1"));
    }
    if (path === "/hls") {
      const target = url.searchParams.get("url") || fromOpaqueUrlToken(url.searchParams.get("src") || "");
      if (!target) return json({ success: false, error: "missing ?url=" }, 200);
      const playback = new URL(`${publicProtocol}//${url.host}${normalizedPrefix}/an-playback/hls`.replace(/([^:]\/)\/+/g, "$1"));
      playback.searchParams.set("src", toOpaqueUrlToken(target));
      const origin = url.searchParams.get("origin") || url.searchParams.get("parent") || url.searchParams.get("ref") || "";
      if (origin) playback.searchParams.set("origin", origin);
      return new Response(null, { status: 302, headers: { ...cors, Location: playback.toString(), "Cache-Control": "no-store" } });
    }
    return json({ success: false, error: "not found", path }, 200);
  } catch (e) {
    return json({ success: false, ok: false, retryable: true, error: e.message || String(e) }, 200);
  }
} };
export {
  stdin_default as default
};
