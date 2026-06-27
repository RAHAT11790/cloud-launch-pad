// ============================================================
// HLS m3u8 downloader — fetches all segments in the browser and
// returns a single concatenated .ts blob the user can save as a
// normal file. No server involvement; works on direct HLS links.
// ============================================================

type ProgressFn = (loaded: number, total: number, bytes: number) => void;

const resolveUrl = (base: string, rel: string) => {
  try { return new URL(rel, base).toString(); } catch { return rel; }
};

interface ParsedPlaylist {
  isMaster: boolean;
  variants: { url: string; bandwidth: number; resolution?: string }[];
  audio: { url: string; name: string; language?: string; default?: boolean }[];
  segments: string[];
}

const parseAttrs = (line: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) attrs[m[1].toUpperCase()] = String(m[2] || "").replace(/^"|"$/g, "");
  return attrs;
};

const parsePlaylist = (text: string, baseUrl: string): ParsedPlaylist => {
  const lines = text.split(/\r?\n/);
  const variants: ParsedPlaylist["variants"] = [];
  const audio: ParsedPlaylist["audio"] = [];
  const segments: string[] = [];
  let isMaster = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      const attrs = parseAttrs(line);
      if (attrs.URI) audio.push({ url: resolveUrl(baseUrl, attrs.URI), name: attrs.NAME || attrs.LANGUAGE || `Audio ${audio.length + 1}`, language: attrs.LANGUAGE, default: /YES/i.test(attrs.DEFAULT || "") });
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      isMaster = true;
      const attrs = parseAttrs(line);
      const bw = Number(attrs.BANDWIDTH || 0);
      const res = attrs.RESOLUTION;
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#")) {
        variants.push({ url: resolveUrl(baseUrl, next), bandwidth: bw, resolution: res });
        i++;
      }
    } else if (!line.startsWith("#")) {
      segments.push(resolveUrl(baseUrl, line));
    }
  }
  return { isMaster, variants, audio, segments };
};

export const isHlsUrl = (url: string) => {
  const value = String(url || "").toLowerCase();
  return /\.m3u8(?:[?#]|$)/i.test(value) || value.includes("/hls/") || /\/an-api\/hls\?/i.test(value);
};

export async function downloadHls(
  playlistUrl: string,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<Blob> {
  let url = playlistUrl;
  let res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HLS playlist fetch failed (${res.status})`);
  let text = await res.text();
  let parsed = parsePlaylist(text, url);

  if (parsed.isMaster && parsed.variants.length) {
    const best = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    url = best.url;
    res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HLS variant fetch failed (${res.status})`);
    text = await res.text();
    parsed = parsePlaylist(text, url);
  }

  if (!parsed.segments.length) throw new Error("No segments in HLS playlist");

  const total = parsed.segments.length;
  const chunks: Uint8Array[] = new Array(total);
  let loaded = 0;
  let bytes = 0;
  let cursor = 0;
  const concurrency = Math.min(6, total);

  const worker = async () => {
    while (cursor < total) {
      const idx = cursor++;
      const segUrl = parsed.segments[idx];
      const r = await fetch(segUrl, { signal });
      if (!r.ok) throw new Error(`Segment ${idx + 1}/${total} failed (${r.status})`);
      const buf = new Uint8Array(await r.arrayBuffer());
      chunks[idx] = buf;
      loaded++;
      bytes += buf.byteLength;
      onProgress?.(loaded, total, bytes);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return new Blob(chunks as unknown as BlobPart[], { type: "video/mp2t" });
}

export function saveBlobAs(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function toHlsFileName(name: string) {
  const cleaned = String(name || "video").trim();
  return cleaned.replace(/\.(mp4|mkv|webm|m4v|mov)$/i, "") + ".ts";
}
