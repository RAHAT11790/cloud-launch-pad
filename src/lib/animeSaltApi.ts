import { getEdgeFunctionUrl } from '@/lib/edgeFunctionRouter';

const callAnimeSalt = async (body: Record<string, any>) => {
  const url = await getEdgeFunctionUrl('animesalt');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AnimeSalt API error: ${res.status}`);
  return res.json();
};

export const animeSaltApi = {
  async browse(page = 1, language?: string, contentType?: string) {
    return callAnimeSalt({ action: 'browse', page, language, contentType });
  },

  async browseAll() {
    return callAnimeSalt({ action: 'browse_all' });
  },

  async getSeries(slug: string) {
    return callAnimeSalt({ action: 'series', slug });
  },

  async getMovie(slug: string) {
    return callAnimeSalt({ action: 'movie', slug });
  },

  async getEpisode(slug: string) {
    return callAnimeSalt({ action: 'episode', slug });
  },
};
