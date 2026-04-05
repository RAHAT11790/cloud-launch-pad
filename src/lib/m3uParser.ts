export interface M3UChannel {
  name: string;
  logo: string;
  group: string;
  url: string;
  tvgId?: string;
}

export function parseM3U(content: string): M3UChannel[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const channels: M3UChannel[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF:')) continue;

    const infoLine = lines[i];
    let streamUrl = '';

    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].startsWith('#')) {
        streamUrl = lines[j];
        i = j;
        break;
      }
    }

    if (!streamUrl || (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://'))) continue;

    const name = infoLine.split(',').pop()?.trim() || 'Unknown';
    const logoMatch = infoLine.match(/tvg-logo="([^"]*)"/);
    const groupMatch = infoLine.match(/group-title="([^"]*)"/);
    const tvgIdMatch = infoLine.match(/tvg-id="([^"]*)"/);

    channels.push({
      name,
      logo: logoMatch?.[1] || '',
      group: groupMatch?.[1] || 'Uncategorized',
      url: streamUrl,
      tvgId: tvgIdMatch?.[1] || '',
    });
  }

  return channels;
}

export async function fetchAndParsePlaylist(url: string): Promise<M3UChannel[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed: ${url}`);
    const text = await response.text();
    return parseM3U(text);
  } catch (error) {
    console.error(`Error fetching playlist ${url}:`, error);
    return [];
  }
}

export async function fetchAllPlaylists(urls: string[]): Promise<M3UChannel[]> {
  const results = await Promise.allSettled(urls.map(fetchAndParsePlaylist));
  const all: M3UChannel[] = [];
  const seen = new Set<string>();

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const ch of r.value) {
        const key = `${ch.name}_${ch.url}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(ch);
        }
      }
    }
  }

  return all;
}
