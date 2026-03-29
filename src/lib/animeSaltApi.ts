import { getEdgeFunctionUrl } from '@/lib/edgeFunctionRouter';
import { db, ref, get } from '@/lib/firebase';

const ANIMESALT_BASE = 'https://animesalt.ac';

/** Get AnimeSalt proxy URL - checks custom URL first, then edge router */
const getAnimeSaltProxyUrl = async (): Promise<string> => {
  // Check Firebase for custom AnimeSalt URL
  try {
    const snap = await get(ref(db, 'settings/animesaltConfig'));
    const val = snap.val();
    if (val?.enabled !== false && val?.customUrl) {
      return val.customUrl;
    }
    if (val?.enabled === false) {
      throw new Error('AnimeSalt বন্ধ আছে। Admin Panel থেকে চালু করুন।');
    }
  } catch (e: any) {
    if (e.message?.includes('বন্ধ')) throw e;
  }

  // Check function override
  try {
    const overrideSnap = await get(ref(db, 'settings/functionOverrides/animesalt'));
    const override = overrideSnap.val();
    if (override?.customUrl) return override.customUrl;
    if (override?.enabled === false) {
      throw new Error('AnimeSalt ফাংশন বন্ধ আছে।');
    }
  } catch (e: any) {
    if (e.message?.includes('বন্ধ')) throw e;
  }

  // Fallback to edge router
  const proxyUrl = await getEdgeFunctionUrl('animesalt');
  if (!proxyUrl) {
    throw new Error('AnimeSalt endpoint not configured. Set Base URL or Custom URL in Admin Panel.');
  }
  return proxyUrl;
};

const fetchPage = async (url: string): Promise<string> => {
  const proxyUrl = await getAnimeSaltProxyUrl();
  
  // Try new format first (url-based), then old format (action-based)
  let res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  
  let data: any;
  
  if (res.ok) {
    data = await res.json();
    if (data.success && data.html) return data.html;
  }
  
  // Fallback: try old action-based format
  const isSeriesPage = url.includes('/series');
  const isMoviesPage = url.includes('/movies');
  const isEpisodePage = url.includes('/episode/');
  const pageMatch = url.match(/\/page\/(\d+)/);
  const slugMatch = url.match(/\/(series|movies|episode)\/([^/]+)/);
  
  let action = 'browse';
  let fallbackBody: any = { action };
  
  if (isEpisodePage && slugMatch) {
    fallbackBody = { action: 'episode', slug: slugMatch[2] };
  } else if (slugMatch && !pageMatch) {
    // Map type to correct action name matching edge function
    const actionName = slugMatch[1] === 'series' ? 'series' : 'movie';
    fallbackBody = { action: actionName, slug: slugMatch[2] };
  } else {
    fallbackBody = {
      action: 'browse',
      type: isMoviesPage ? 'movies' : 'series',
      page: pageMatch ? parseInt(pageMatch[1]) : 1,
    };
  }
  
  res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fallbackBody),
  });
  
  if (!res.ok) throw new Error(`AnimeSalt proxy error: ${res.status}`);
  data = await res.json();
  
  // Old format returns data differently
  if (data.success && data.html) return data.html;
  if (data.success && data.data) {
    // Reconstruct HTML-like response for compatibility
    return JSON.stringify(data);
  }
  
  throw new Error('No HTML returned from AnimeSalt proxy');
};

/** Parse anime items from AnimeSalt HTML listing page */
const parseListPage = (html: string): { slug: string; title: string; poster: string; type: string; year: string }[] => {
  const items: { slug: string; title: string; poster: string; type: string; year: string }[] = [];
  const cardRegex = /<article[^>]*>[\s\S]*?<\/article>/gi;
  const cards = html.match(cardRegex) || [];
  
  for (const card of cards) {
    const linkMatch = card.match(/href="https?:\/\/animesalt\.[^/]+\/(series|movies)\/([^/"]+)/i);
    if (!linkMatch) continue;
    const type = linkMatch[1];
    const slug = linkMatch[2];
    const titleMatch = card.match(/title="([^"]+)"/i) || card.match(/<h[23][^>]*>([^<]+)<\/h[23]>/i);
    const title = titleMatch ? titleMatch[1].replace(/&#8217;/g, "'").replace(/&#8211;/g, "-").replace(/&amp;/g, "&") : slug;
    const imgMatch = card.match(/src="([^"]+)"/i) || card.match(/data-src="([^"]+)"/i);
    const poster = imgMatch ? imgMatch[1] : '';
    const yearMatch = card.match(/(\d{4})/);
    const year = yearMatch ? yearMatch[1] : '';
    if (!items.some(i => i.slug === slug)) {
      items.push({ slug, title, poster, type, year });
    }
  }
  return items;
};

/** Parse series detail page for episodes */
const parseSeriesDetail = (html: string) => {
  const seasons: { name: string; episodes: { number: number; title: string; slug: string }[] }[] = [];
  const seasonRegex = /class="[^"]*season[^"]*"[^>]*>[\s\S]*?(?=class="[^"]*season[^"]*"|$)/gi;
  const seasonBlocks = html.match(seasonRegex) || [html];
  
  seasonBlocks.forEach((block, idx) => {
    const seasonNameMatch = block.match(/Season\s*(\d+)/i);
    const seasonName = seasonNameMatch ? `Season ${seasonNameMatch[1]}` : `Season ${idx + 1}`;
    const episodes: { number: number; title: string; slug: string }[] = [];
    const epRegex = /href="https?:\/\/animesalt\.[^/]+\/episode\/([^/"]+)/gi;
    let epMatch;
    let epNum = 1;
    while ((epMatch = epRegex.exec(block)) !== null) {
      const epSlug = epMatch[1];
      const epTitleMatch = block.slice(epMatch.index).match(/title="([^"]+)"/i);
      episodes.push({
        number: epNum++,
        title: epTitleMatch ? epTitleMatch[1] : `Episode ${epNum - 1}`,
        slug: epSlug,
      });
    }
    if (episodes.length > 0) {
      seasons.push({ name: seasonName, episodes });
    }
  });
  return { seasons };
};

/** Parse episode page for video links */
const parseEpisodePage = (html: string) => {
  const links: { quality: string; url: string }[] = [];
  const iframeMatch = html.match(/iframe[^>]+src="([^"]+)"/gi) || [];
  iframeMatch.forEach(m => {
    const src = m.match(/src="([^"]+)"/i);
    if (src) links.push({ quality: 'default', url: src[1] });
  });
  const videoRegex = /href="([^"]*(?:mp4|m3u8|stream)[^"]*)"/gi;
  let vMatch;
  while ((vMatch = videoRegex.exec(html)) !== null) {
    links.push({ quality: 'direct', url: vMatch[1] });
  }
  return { links };
};

/** Try direct API call first, supporting both nested and top-level response formats */
const tryDirectApi = async (proxyUrl: string, body: any): Promise<any | null> => {
  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    if (data.data) return data.data;
    if (data.items) return { items: data.items, maxPage: data.maxPage, currentPage: data.currentPage, totalCount: data.totalCount };
    return data;
  } catch { return null; }
};

export const animeSaltApi = {
  async browse(page = 1, language?: string, contentType?: string) {
    const type = contentType === 'movies' ? 'movies' : 'series';
    
    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'browse', type, page });
    if (directResult?.items?.length) {
      return { success: true, items: directResult.items };
    }
    
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
    
    const sItems = seriesDirect?.items || [];
    const mItems = moviesDirect?.items || [];
    if (sItems.length || mItems.length) {
      return { success: true, items: [...sItems, ...mItems] };
    }
    
    const [seriesHtml, moviesHtml] = await Promise.all([
      fetchPage(`${ANIMESALT_BASE}/series/`),
      fetchPage(`${ANIMESALT_BASE}/movies/`),
    ]);
    const seriesItems = parseListPage(seriesHtml);
    const movieItems = parseListPage(moviesHtml);
    return { success: true, items: [...seriesItems, ...movieItems] };
  },

  async getSeries(slug: string) {
    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'series', slug });
    if (directResult) return { success: true, data: directResult };
    
    const html = await fetchPage(`${ANIMESALT_BASE}/series/${slug}/`);
    return { success: true, data: parseSeriesDetail(html) };
  },

  async getMovie(slug: string) {
    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'movie', slug });
    if (directResult) return { success: true, data: directResult };
    
    const html = await fetchPage(`${ANIMESALT_BASE}/movies/${slug}/`);
    return { success: true, data: parseEpisodePage(html) };
  },

  async getEpisode(slug: string) {
    const proxyUrl = await getAnimeSaltProxyUrl();
    const directResult = await tryDirectApi(proxyUrl, { action: 'episode', slug });
    if (directResult?.embedUrl || directResult?.allEmbeds?.length || directResult?.links?.length) {
      return { success: true, ...directResult };
    }
    
    const html = await fetchPage(`${ANIMESALT_BASE}/episode/${slug}/`);
    return { success: true, ...parseEpisodePage(html) };
  },
};
