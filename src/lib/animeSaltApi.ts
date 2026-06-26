import { getEdgeFunctionUrl } from '@/lib/edgeFunctionRouter';
import { db, ref, get, set } from '@/lib/firebase';

const ANIMESALT_BASE = 'https://animesalt.ac';
const PLAYABLE_EXT_RE = /\.(?:m3u8|mp4|webm|ogg|mov|mkv)(?:[?#].*)?$/i;
const ASSET_EXT_RE = /\.(?:js|css|json|jpe?g|png|gif|svg|webp|ico|woff2?|ttf)(?:[?#].*)?$/i;
const FETCH_TIMEOUT_MS = 12_000;

// Firebase-backed cache for AnimeSalt API responses.
// Series structure rarely changes -> long TTL. Playback URLs may be signed -> shorter TTL.
const CACHE_TTL_SERIES_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const CACHE_TTL_PLAYBACK_MS = 10 * 60 * 1000;          // playback links expire; keep fresh
const memCache = new Map<string, { ts: number; data: any }>();

const sanitizeKey = (s: string) => String(s || '').replace(/[.#$/\[\]]/g, '_').slice(0, 200);

async function readAsCache(kind: 'series' | 'movie' | 'episode', slug: string, ttl: number): Promise<any | null> {
  const key = `${kind}:${slug}`;
  const mem = memCache.get(key);
  const now = Date.now();
  if (mem && now - mem.ts < ttl) return mem.data;
  try {
    const snap = await get(ref(db, `animesaltCache/${kind}/${sanitizeKey(slug)}`));
    const val = snap.val();
    if (val && val.ts && val.data && now - Number(val.ts) < ttl) {
      memCache.set(key, { ts: Number(val.ts), data: val.data });
      return val.data;
    }
  } catch {}
  return null;
}

function writeAsCache(kind: 'series' | 'movie' | 'episode', slug: string, data: any) {
  const ts = Date.now();
  memCache.set(`${kind}:${slug}`, { ts, data });
  try {
    // Fire-and-forget; never block UX on cache writes.
    set(ref(db, `animesaltCache/${kind}/${sanitizeKey(slug)}`), { ts, data }).catch(() => {});
  } catch {}
}

type AnimeSaltLink = { quality: string; url: string };

const toAbsoluteUrl = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `${ANIMESALT_BASE}${raw}`;
  return raw;
};

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
};

const decodeHtml = (value: string) =>
  value
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');

const getText = (root: ParentNode, selectors: string[]): string => {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = decodeHtml(el?.textContent?.trim() || '');
    if (text) return text;
  }
  return '';
};

const getAttr = (root: ParentNode, selectors: string[], attr: string): string => {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const value = decodeHtml(el?.getAttribute(attr)?.trim() || '');
    if (value) return toAbsoluteUrl(value);
  }
  return '';
};

const guessQualityLabel = (url: string, index: number) => {
  if (/4k|2160/i.test(url)) return '4K';
  if (/1080/i.test(url)) return '1080p';
  if (/720/i.test(url)) return '720p';
  if (/480/i.test(url)) return '480p';
  return index === 0 ? 'Auto' : `Source ${index + 1}`;
};

const normalizeLinkList = (values: Array<{ url?: string | null; quality?: string | null; label?: string | null } | string | null | undefined>): AnimeSaltLink[] => {
  const seen = new Set<string>();
  const links: AnimeSaltLink[] = [];

  values.forEach((entry, index) => {
    const url = toAbsoluteUrl(typeof entry === 'string' ? entry : entry?.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({
      quality: typeof entry === 'string' ? guessQualityLabel(url, index) : String(entry?.quality || entry?.label || guessQualityLabel(url, index)),
      url,
    });
  });

  return links;
};

const isPlaybackCandidate = (value: string) => {
  const url = toAbsoluteUrl(value);
  if (!url || ASSET_EXT_RE.test(url)) return false;
  if (/animesalt\.(?:ac|top)\/(?:series|movies|episode)\//i.test(url) && !PLAYABLE_EXT_RE.test(url)) return false;
  return PLAYABLE_EXT_RE.test(url) || !/animesalt\.(?:ac|top)/i.test(url) || /embed|watch|player|stream|download/i.test(url);
};

const pickPlaybackFields = (payload: any) => {
  const rawLinks = Array.isArray(payload?.links) ? payload.links : [];
  const rawEmbedUrls = Array.isArray(payload?.embedUrls) ? payload.embedUrls : [];
  const sourceLinks = Array.isArray(payload?.sources)
    ? payload.sources.flatMap((source: any) => {
        const streams = Array.isArray(source?.streams) ? source.streams : [];
        return [
          source?.master,
          source?.videoSource,
          source?.securedLink,
          source?.embed,
          ...streams.map((stream: any) => ({
            quality: stream?.label || stream?.quality || (stream?.height ? `${stream.height}p` : undefined),
            url: stream?.url,
          })),
        ];
      })
    : [];
  const collected = normalizeLinkList([
    ...rawLinks,
    ...rawEmbedUrls,
    ...sourceLinks,
    payload?.embedUrl,
    payload?.movieEmbedUrl,
    payload?.directUrl,
    payload?.streamUrl,
    payload?.videoUrl,
    payload?.file,
    ...(Array.isArray(payload?.allEmbeds) ? payload.allEmbeds : []),
  ]).filter((entry) => isPlaybackCandidate(entry.url));

  const allEmbeds = collected.map((entry) => entry.url);
  const primary = allEmbeds[0] || '';
  const directUrl = collected.find((entry) => PLAYABLE_EXT_RE.test(entry.url))?.url || payload?.directUrl || '';

  return {
    links: collected,
    embedUrls: allEmbeds,
    allEmbeds,
    embedUrl: payload?.embedUrl || primary,
    movieEmbedUrl: payload?.movieEmbedUrl || primary,
    directUrl,
  };
};

const extractLanguages = (doc: Document) => {
  const sourceText = doc.body?.textContent || '';
  const matches = sourceText.match(/(?:Bangla|Bengali|English|Hindi|Dual Audio|Multi Audio|Subbed|Dubbed)[^\n|•]{0,24}/gi) || [];
  return Array.from(new Set(matches.map((entry) => decodeHtml(entry.replace(/\s+/g, ' ').trim())).filter(Boolean))).slice(0, 6);
};

const parseMeta = (html: string) => {
  const doc = parseHtml(html);
  const title =
    getAttr(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]'], 'content') ||
    getText(doc, ['h1.entry-title', 'h1', 'title']);
  const poster =
    getAttr(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]', '.poster img', '.thumb img', 'article img', 'img'], 'content') ||
    getAttr(doc, ['.poster img', '.thumb img', 'article img', 'img'], 'data-src') ||
    getAttr(doc, ['.poster img', '.thumb img', 'article img', 'img'], 'src');
  const backdrop = getAttr(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]'], 'content') || poster;
  const storylineFull = getText(doc, ['.entry-content', '.entry-content p', '.summary', '.description', 'article p']);
  const storylineMeta = getAttr(doc, ['meta[name="description"]', 'meta[property="og:description"]'], 'content');
  const storyline = (storylineFull && storylineFull.length > (storylineMeta?.length || 0))
    ? storylineFull
    : (storylineMeta || storylineFull);
  const yearMatch = (doc.body?.textContent || '').match(/(?:19|20)\d{2}/);
  const ratingMatch = (doc.body?.textContent || '').match(/([0-9](?:\.[0-9])?)\s*\/\s*10/);

  return {
    title,
    poster,
    backdrop,
    storyline,
    year: yearMatch?.[0] || '',
    rating: ratingMatch?.[1] || '',
    languages: extractLanguages(doc),
    doc,
  };
};

/** Get AnimeSalt proxy URL from the EGD Router only. */
const getAnimeSaltProxyUrl = async (): Promise<string> => {
  const proxyUrl = await getEdgeFunctionUrl('an-api');
  const normalized = normalizeAnApiBaseUrl(proxyUrl);
  if (!normalized) throw new Error('AN API URL is not saved/enabled in EGD Router.');
  return normalized;
};

const normalizeAnApiBaseUrl = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    const endpointNames = new Set(['raw', 'search', 'anime', 'episode', 'embed', 'hls', 'subs']);
    const parts = url.pathname.split('/').filter(Boolean);
    while (parts.length && endpointNames.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    url.pathname = `/${parts.join('/')}`.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/(?:raw|search|anime|episode|embed|hls|subs)(?:\?.*)?$/i, '').replace(/\/+$/, '');
  }
};

const fetchPage = async (url: string): Promise<string> => {
  const proxyUrl = await getAnimeSaltProxyUrl();

  // Important: do NOT call `/raw?url=...` from the app. The AN API contract
  // exposed in EGD Manager is structured (`/search`, `/anime`, `/episode`,
  // `/embed`, `/hls`, `/subs`). Older builds used `/raw?url=` as a fallback,
  // which produced the reported invalid runtime path:
  //   supabase/functions/raw?url=https://animesalt.ac/episode/.../index.ts
  // Keep the raw HTML fallback only through the backwards-compatible POST
  // shape supported by our deployable `an-api` source, never as a GET path.
  const res = await fetchWithTimeout(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) throw new Error(`AnimeSalt proxy error: ${res.status}`);
  const data = await res.json();
  if (data.success && data.html) return data.html;
  throw new Error('No HTML returned from AnimeSalt proxy');
};

const parseListPage = (html: string): { slug: string; title: string; poster: string; type: string; year: string; language?: string; episodeCount?: number }[] => {
  const doc = parseHtml(html);
  const items: { slug: string; title: string; poster: string; type: string; year: string; language?: string; episodeCount?: number }[] = [];
  const seen = new Set<string>();

  const extractLangFromText = (txt: string): string | undefined => {
    if (!txt) return undefined;
    // Look for known language labels (Hindi/English/Multi/Dual/Sub/Dub/Japanese/Tamil/Telugu/Bengali/Korean/Spanish)
    const langs: string[] = [];
    const dict = ["Hindi", "English", "Bengali", "Tamil", "Telugu", "Japanese", "Korean", "Spanish", "Multi Audio", "Multi", "Dual Audio", "Dual", "Sub", "Dub"];
    for (const l of dict) {
      const re = new RegExp(`\\b${l.replace(/ /g, "\\s")}\\b`, "i");
      if (re.test(txt)) langs.push(l);
    }
    if (langs.length === 0) return undefined;
    if (langs.length === 1) return langs[0];
    return "Multi";
  };
  const extractEpCount = (txt: string): number | undefined => {
    if (!txt) return undefined;
    const m = txt.match(/(\d{1,3})\s*(?:ep(?:isode)?s?|EP)\b/i);
    return m ? Number(m[1]) : undefined;
  };

  doc.querySelectorAll('a[href*="/series/"], a[href*="/movies/"]').forEach((anchor) => {
    const href = toAbsoluteUrl(anchor.getAttribute('href'));
    const match = href.match(/\/(series|movies)\/([^/?#]+)/i);
    if (!match) return;
    const slug = match[2];
    if (!slug || seen.has(slug)) return;

    const card = anchor.closest('article, li, .item, .poster, .bs, .ml-item, .anime-card') || anchor;
    const title =
      decodeHtml(anchor.getAttribute('title') || '') ||
      decodeHtml((anchor.querySelector('img')?.getAttribute('alt') || '')) ||
      getText(card, ['h1', 'h2', 'h3', 'h4', '.entry-title', '.title']) ||
      slug.replace(/-/g, ' ');
    const poster =
      getAttr(card, ['img'], 'data-src') ||
      getAttr(card, ['img'], 'src');
    const cardText = (card.textContent || '');
    const year = (cardText.match(/(?:19|20)\d{2}/) || [])[0] || '';
    // Look in dedicated badge/label nodes first, fallback to full card text
    const labelText = (
      getText(card, ['.lang', '.language', '.audio', '.dub', '.quality', '.badge', '.label', '.tag']) ||
      ''
    );
    const language = extractLangFromText(labelText) || extractLangFromText(title) || extractLangFromText(cardText);
    const episodeCount = extractEpCount(labelText) || extractEpCount(cardText);

    items.push({ slug, title, poster, type: match[1], year, language, episodeCount });
    seen.add(slug);
  });

  if (items.length > 0) return items;

  const fallbackMatches = html.match(/href="https?:\/\/animesalt\.[^/]+\/(series|movies)\/([^/"]+)"[\s\S]{0,400}?<img[^>]+(?:src|data-src)="([^"]+)"/gi) || [];
  fallbackMatches.forEach((block) => {
    const match = block.match(/href="https?:\/\/animesalt\.[^/]+\/(series|movies)\/([^/"]+)"/i);
    const img = block.match(/(?:src|data-src)="([^"]+)"/i);
    if (!match || !img || seen.has(match[2])) return;
    items.push({ slug: match[2], title: match[2].replace(/-/g, ' '), poster: toAbsoluteUrl(img[1]), type: match[1], year: '' });
    seen.add(match[2]);
  });

  return items;
};

const parseSeriesDetail = (html: string) => {
  const meta = parseMeta(html);
  const { doc } = meta;
  const grouped = new Map<string, { name: string; episodes: { number: number; title: string; slug: string }[] }>();

  doc.querySelectorAll('a[href*="/episode/"]').forEach((anchor, index) => {
    const href = toAbsoluteUrl(anchor.getAttribute('href'));
    const match = href.match(/\/episode\/([^/?#]+)/i);
    if (!match) return;
    const slug = match[1];
    const seasonContainer = anchor.closest('[class*="season"], [id*="season"], [data-season]');
    const seasonLabel =
      decodeHtml(seasonContainer?.getAttribute('data-season') || '') ||
      getText(seasonContainer || doc, ['h1', 'h2', 'h3', 'h4', '.title', '.heading']) ||
      'Season 1';
    const normalizedSeason = /season\s*\d+/i.test(seasonLabel) ? seasonLabel.match(/season\s*\d+/i)?.[0] || seasonLabel : seasonLabel;
    const bucketName = normalizedSeason || 'Season 1';
    if (!grouped.has(bucketName)) grouped.set(bucketName, { name: bucketName, episodes: [] });

    const rawTitle = decodeHtml(anchor.getAttribute('title') || anchor.textContent || '') || `Episode ${index + 1}`;
    const episodeNumber = Number((rawTitle.match(/(?:episode|ep)\s*(\d+)/i) || slug.match(/(?:episode|ep)[-_]?(\d+)/i) || [])[1] || grouped.get(bucketName)!.episodes.length + 1);
    const bucket = grouped.get(bucketName)!;
    if (bucket.episodes.some((episode) => episode.slug === slug)) return;
    bucket.episodes.push({ number: episodeNumber, title: rawTitle, slug });
  });

  const seasons = Array.from(grouped.values())
    .map((season, index) => ({
      name: season.name || `Season ${index + 1}`,
      episodes: season.episodes.sort((a, b) => a.number - b.number),
    }))
    .filter((season) => season.episodes.length > 0);

  return {
    title: meta.title,
    poster: meta.poster,
    backdrop: meta.backdrop,
    storyline: meta.storyline,
    year: meta.year,
    rating: meta.rating,
    languages: meta.languages,
    seasons,
  };
};

const parsePlaybackPage = (html: string) => {
  const meta = parseMeta(html);
  const { doc } = meta;
  const rawCandidates = new Set<string>();
  const attrSelectors = ['iframe[src]', 'video[src]', 'video source[src]', 'a[href]', '[data-src]', '[data-url]', '[data-file]', '[data-embed]'];

  attrSelectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => {
      ['src', 'href', 'data-src', 'data-url', 'data-file', 'data-embed'].forEach((attr) => {
        const value = node.getAttribute(attr);
        const absolute = toAbsoluteUrl(value);
        if (isPlaybackCandidate(absolute)) rawCandidates.add(absolute);
      });
    });
  });

  (html.match(/https?:\/\/[^\s"'`<>]+/gi) || []).forEach((url) => {
    const absolute = toAbsoluteUrl(url);
    if (isPlaybackCandidate(absolute)) rawCandidates.add(absolute);
  });

  const links = normalizeLinkList(Array.from(rawCandidates));
  const playback = pickPlaybackFields({ links });

  return {
    title: meta.title,
    poster: meta.poster,
    backdrop: meta.backdrop,
    storyline: meta.storyline,
    year: meta.year,
    rating: meta.rating,
    languages: meta.languages,
    ...playback,
  };
};

/** Try direct API call first, supporting both nested and top-level response formats */
const tryDirectApi = async (proxyUrl: string, body: any): Promise<any | null> => {
  try {
    const base = normalizeAnApiBaseUrl(proxyUrl);
    let endpoint = '';
    if (body.action === 'search') endpoint = `${base}/search?q=${encodeURIComponent(body.q || body.query || '')}`;
    else if (body.action === 'series') endpoint = `${base}/anime?slug=${encodeURIComponent(body.slug || '')}&type=series`;
    else if (body.action === 'movie') endpoint = `${base}/episode?slug=${encodeURIComponent(body.slug || '')}&type=movies`;
    else if (body.action === 'episode') endpoint = `${base}/episode?slug=${encodeURIComponent(body.slug || '')}`;
    else return null;
    const res = await fetchWithTimeout(endpoint);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) return { items: data };
    if (data?.error) return null;
    if (data.data) return data.data;
    if (data.items) return { items: data.items, maxPage: data.maxPage, currentPage: data.currentPage, totalCount: data.totalCount };
    return data;
  } catch {
    return null;
  }
};

const normalizeSeriesPayload = (payload: any) => {
  const seasons = Array.isArray(payload?.seasons)
    ? payload.seasons
        .map((season: any, sIdx: number) => ({
          name: season?.name || `Season ${sIdx + 1}`,
          episodes: Array.isArray(season?.episodes)
            ? season.episodes
                .map((episode: any, eIdx: number) => ({
                  number: Number(episode?.number || episode?.episodeNumber || eIdx + 1),
                  title: String(episode?.title || `Episode ${episode?.number || episode?.episodeNumber || eIdx + 1}`),
                  slug: String(episode?.slug || episode?.episodeSlug || '').trim(),
                }))
                .filter((episode: any) => episode.slug)
            : [],
        }))
        .filter((season: any) => season.episodes.length > 0)
    : [];

  return {
    ...payload,
    title: String(payload?.title || '').trim(),
    poster: toAbsoluteUrl(payload?.poster || payload?.image || payload?.thumb),
    backdrop: toAbsoluteUrl(payload?.backdrop || payload?.poster || payload?.image || payload?.thumb),
    storyline: String(payload?.storyline || payload?.overview || payload?.description || '').trim(),
    year: String(payload?.year || '').trim(),
    rating: String(payload?.rating || payload?.vote || '').trim(),
    languages: Array.isArray(payload?.languages) ? payload.languages.filter(Boolean) : [],
    seasons,
  };
};

const normalizePlaybackPayload = (payload: any) => ({
  ...payload,
  title: String(payload?.title || '').trim(),
  poster: toAbsoluteUrl(payload?.poster || payload?.image || payload?.thumb),
  backdrop: toAbsoluteUrl(payload?.backdrop || payload?.poster || payload?.image || payload?.thumb),
  storyline: String(payload?.storyline || payload?.overview || payload?.description || '').trim(),
  year: String(payload?.year || '').trim(),
  rating: String(payload?.rating || payload?.vote || '').trim(),
  languages: Array.isArray(payload?.languages) ? payload.languages.filter(Boolean) : [],
  ...pickPlaybackFields(payload),
});

export const animeSaltApi = {
  async browse(page = 1, language?: string, contentType?: string) {
    const type = contentType === 'movies' ? 'movies' : 'series';
    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'browse', type, page, language });
    if (directResult?.items?.length) return { success: true, items: directResult.items };

    const url = page > 1 ? `${ANIMESALT_BASE}/${type}/page/${page}/` : `${ANIMESALT_BASE}/${type}/`;
    const html = await fetchPage(url);
    return { success: true, items: parseListPage(html) };
  },

  async browseAll() {
    const proxyUrl = await getAnimeSaltProxyUrl();
    const [seriesDirect, moviesDirect] = await Promise.all([
      tryDirectApi(proxyUrl, { action: 'browse', type: 'series', page: 1 }),
      tryDirectApi(proxyUrl, { action: 'browse', type: 'movies', page: 1 }),
    ]);

    const sItems = (seriesDirect?.items || []).map((it: any) => ({ ...it, type: 'series' }));
    const mItems = (moviesDirect?.items || []).map((it: any) => ({ ...it, type: 'movies' }));
    if (sItems.length || mItems.length) return { success: true, items: [...sItems, ...mItems] };

    const [seriesHtml, moviesHtml] = await Promise.all([
      fetchPage(`${ANIMESALT_BASE}/series/`),
      fetchPage(`${ANIMESALT_BASE}/movies/`),
    ]);
    const sParsed = parseListPage(seriesHtml).map((it) => ({ ...it, type: 'series' }));
    const mParsed = parseListPage(moviesHtml).map((it) => ({ ...it, type: 'movies' }));
    return { success: true, items: [...sParsed, ...mParsed] };
  },

  async getSeries(slug: string) {
    const cached = await readAsCache('series', slug, CACHE_TTL_SERIES_MS);
    if (cached) return { success: true, data: cached, cached: true };

    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'series', slug });
    if (directResult) {
      const normalized = normalizeSeriesPayload(directResult);
      if (normalized.seasons.length > 0) {
        writeAsCache('series', slug, normalized);
        return { success: true, data: normalized };
      }
    }

    const html = await fetchPage(`${ANIMESALT_BASE}/series/${slug}/`);
    const data = parseSeriesDetail(html);
    if (data?.seasons?.length) writeAsCache('series', slug, data);
    return { success: true, data };
  },

  async getMovie(slug: string) {
    const cached = await readAsCache('movie', slug, CACHE_TTL_PLAYBACK_MS);
    if (cached) {
      const normalizedCached = normalizePlaybackPayload(cached);
      if (normalizedCached.embedUrl || normalizedCached.links?.length || normalizedCached.allEmbeds?.length) {
        return { success: true, data: normalizedCached, cached: true };
      }
    }

    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'movie', slug });
    if (directResult) {
      const normalized = normalizePlaybackPayload(directResult);
      if (normalized.embedUrl || normalized.links?.length) {
        writeAsCache('movie', slug, normalized);
        return { success: true, data: normalized };
      }
    }

    const html = await fetchPage(`${ANIMESALT_BASE}/movies/${slug}/`);
    const data = parsePlaybackPage(html);
    if (data?.embedUrl || data?.links?.length) writeAsCache('movie', slug, data);
    return { success: true, data };
  },

  async getEpisode(slug: string) {
    const cached = await readAsCache('episode', slug, CACHE_TTL_PLAYBACK_MS);
    if (cached) {
      const normalizedCached = normalizePlaybackPayload(cached);
      if (normalizedCached.embedUrl || normalizedCached.links?.length || normalizedCached.allEmbeds?.length) {
        return { success: true, ...normalizedCached, cached: true };
      }
    }

    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'episode', slug });
    if (directResult) {
      const normalized = normalizePlaybackPayload(directResult);
      if (normalized.embedUrl || normalized.links?.length || normalized.allEmbeds?.length) {
        writeAsCache('episode', slug, normalized);
        return { success: true, ...normalized };
      }
    }

    const html = await fetchPage(`${ANIMESALT_BASE}/episode/${slug}/`);
    const parsed = parsePlaybackPage(html);
    if (parsed?.embedUrl || parsed?.links?.length || parsed?.allEmbeds?.length) {
      writeAsCache('episode', slug, parsed);
    }
    return { success: true, ...parsed };
  },
};
