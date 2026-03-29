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
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`AnimeSalt proxy error: ${res.status}`);
  const data = await res.json();
  if (!data.success || !data.html) throw new Error('No HTML returned');
  return data.html;
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

export const animeSaltApi = {
  async browse(page = 1, language?: string, contentType?: string) {
    const type = contentType === 'movies' ? 'movies' : 'series';
    const url = page > 1 ? `${ANIMESALT_BASE}/${type}/page/${page}/` : `${ANIMESALT_BASE}/${type}/`;
    const html = await fetchPage(url);
    return { success: true, items: parseListPage(html) };
  },

  async browseAll() {
    const [seriesHtml, moviesHtml] = await Promise.all([
      fetchPage(`${ANIMESALT_BASE}/series/`),
      fetchPage(`${ANIMESALT_BASE}/movies/`),
    ]);
    const seriesItems = parseListPage(seriesHtml);
    const movieItems = parseListPage(moviesHtml);
    return { success: true, items: [...seriesItems, ...movieItems] };
  },

  async getSeries(slug: string) {
    const html = await fetchPage(`${ANIMESALT_BASE}/series/${slug}/`);
    return { success: true, ...parseSeriesDetail(html) };
  },

  async getMovie(slug: string) {
    const html = await fetchPage(`${ANIMESALT_BASE}/movies/${slug}/`);
    return { success: true, ...parseEpisodePage(html) };
  },

  async getEpisode(slug: string) {
    const html = await fetchPage(`${ANIMESALT_BASE}/episode/${slug}/`);
    return { success: true, ...parseEpisodePage(html) };
  },
};
