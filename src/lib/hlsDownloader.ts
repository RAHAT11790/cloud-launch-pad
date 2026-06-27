// ============================================================
// HLS m3u8 downloader — fetches all segments in the browser and
// returns a single concatenated .ts blob the user can save as a
// normal file. No server involvement; works on direct HLS links.
// ============================================================

type ProgressFn = (loaded: number, total: number, bytes: number) => void;

const decodeDataPlaylist = (value: string): { text: string; mime: string } | null => {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith("data:")) return null;
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const meta = raw.slice(0, comma).toLowerCase();
  const payload = raw.slice(comma + 1);
  try {
    const text = meta.includes(";base64") ? decodeURIComponent(escape(atob(payload))) : decodeURIComponent(payload);
    return { text, mime: meta.slice(5).split(";")[0] || "application/vnd.apple.mpegurl" };
  } catch {
    return null;
  }
};

const resolveUrl = (base: string, rel: string) => {
  try { return new URL(rel, base).toString(); } catch { return rel; }
};

export const normalizeHlsProxyUrl = (value: string, anApiBaseUrl?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (/^http:$/i.test(url.protocol) && /\/an-api\/hls\/?$/i.test(url.pathname)) url.protocol = "https:";
    const isBrokenSupabaseAnPath = /\.supabase\.co$/i.test(url.hostname)
      && /\/an-api\/hls\/?$/i.test(url.pathname)
      && !/\/functions\/v1\/an-api\/hls\/?$/i.test(url.pathname);
    if (isBrokenSupabaseAnPath) {
      url.pathname = `/functions/v1${url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`}`;
      return url.toString();
    }
    if (anApiBaseUrl && /\/an-api\/hls\/?$/i.test(url.pathname)) {
      const base = new URL(anApiBaseUrl);
      const expected = base.pathname.replace(/\/+$/, "") + "/hls";
      if (url.host === base.host && url.pathname !== expected) {
        url.protocol = base.protocol;
        url.pathname = expected;
        return url.toString();
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
};

interface ParsedPlaylist {
  isMaster: boolean;
  variants: { url: string; bandwidth: number; resolution?: string }[];
  audio: { url: string; name: string; language?: string; default?: boolean }[];
  segments: { url: string; range?: string; init?: boolean }[];
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
  const parts: ParsedPlaylist["segments"] = [];
  let isMaster = false;
  let currentMap: { url: string; range?: string; key: string } | null = null;
  let lastMapKey = "";
  let pendingByteRange: string | undefined;
  const toRangeHeader = (value?: string) => {
    const raw = String(value || "").replace(/"/g, "").trim();
    const m = /^(\d+)@(\d+)$/.exec(raw);
    if (!m) return undefined;
    const length = Number(m[1]);
    const start = Number(m[2]);
    if (!Number.isFinite(length) || !Number.isFinite(start) || length <= 0) return undefined;
    return `bytes=${start}-${start + length - 1}`;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
      const attrs = parseAttrs(line);
      if (attrs.URI) audio.push({ url: normalizeHlsProxyUrl(resolveUrl(baseUrl, attrs.URI)), name: attrs.NAME || attrs.LANGUAGE || `Audio ${audio.length + 1}`, language: attrs.LANGUAGE, default: /YES/i.test(attrs.DEFAULT || "") });
    } else if (line.startsWith("#EXT-X-MAP")) {
      const attrs = parseAttrs(line);
      if (attrs.URI) {
        const mapUrl = normalizeHlsProxyUrl(resolveUrl(baseUrl, attrs.URI));
        const range = toRangeHeader(attrs.BYTERANGE);
        currentMap = { url: mapUrl, range, key: `${mapUrl}|${range || ""}` };
      }
    } else if (line.startsWith("#EXT-X-BYTERANGE")) {
      pendingByteRange = toRangeHeader(line.slice(line.indexOf(":") + 1));
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      isMaster = true;
      const attrs = parseAttrs(line);
      const bw = Number(attrs.BANDWIDTH || 0);
      const res = attrs.RESOLUTION;
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#")) {
        variants.push({ url: normalizeHlsProxyUrl(resolveUrl(baseUrl, next)), bandwidth: bw, resolution: res });
        i++;
      }
    } else if (!line.startsWith("#")) {
      const segmentUrl = normalizeHlsProxyUrl(resolveUrl(baseUrl, line));
      segments.push(segmentUrl);
      if (currentMap && currentMap.key !== lastMapKey) {
        parts.push({ url: currentMap.url, range: currentMap.range, init: true });
        lastMapKey = currentMap.key;
      }
      parts.push({ url: segmentUrl, range: pendingByteRange });
      pendingByteRange = undefined;
    }
  }
  return { isMaster, variants, audio, segments: parts.length ? parts : segments.map((url) => ({ url })) };
};

const fetchPlaylistText = async (playlistUrl: string, signal?: AbortSignal) => {
  const dataPlaylist = decodeDataPlaylist(playlistUrl);
  if (dataPlaylist) return { text: dataPlaylist.text, url: playlistUrl };
  const url = normalizeHlsProxyUrl(playlistUrl);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HLS playlist fetch failed (${res.status})`);
  return { text: await res.text(), url };
};

export const isHlsUrl = (url: string) => {
  const value = String(url || "").toLowerCase();
  return value.startsWith("data:application/vnd.apple.mpegurl")
    || value.startsWith("data:application/x-mpegurl")
    || /\.m3u8(?:[?#]|$)/i.test(value)
    || value.includes("/hls/")
    || /\/an-api\/hls\?/i.test(value);
};

const fetchLength = async (url: string, signal?: AbortSignal): Promise<number> => {
  const target = normalizeHlsProxyUrl(url);
  const plans: RequestInit[] = [
    { method: "HEAD", signal },
    { method: "GET", headers: { Range: "bytes=0-0" }, signal },
  ];
  for (const init of plans) {
    try {
      const response = await fetch(target, init);
      const contentRange = response.headers.get("content-range") || "";
      const rangeMatch = /\/(\d+)\s*$/.exec(contentRange);
      if (rangeMatch && Number(rangeMatch[1]) > 0) return Number(rangeMatch[1]);
      const len = Number(response.headers.get("content-length") || 0);
      if (len > 0) return len;
      if (init.method === "GET" && response.ok) {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > 0) return buf.byteLength;
      }
      try { await response.body?.cancel(); } catch {}
    } catch {}
  }
  return 0;
};

export async function estimateHlsSize(
  playlistUrl: string,
  sampleCount = 10,
  signal?: AbortSignal,
): Promise<number> {
  let { text, url } = await fetchPlaylistText(playlistUrl, signal);
  let parsed = parsePlaylist(text, url);

  if (parsed.isMaster && parsed.variants.length) {
    const best = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    url = normalizeHlsProxyUrl(best.url);
    const next = await fetchPlaylistText(url, signal);
    text = next.text;
    url = next.url;
    parsed = parsePlaylist(text, url);
  }

  if (!parsed.segments.length) return 0;
  const sample = parsed.segments.filter((segment) => !segment.init).slice(0, Math.min(sampleCount, parsed.segments.length));
  const initParts = parsed.segments.filter((segment) => segment.init).slice(0, 3);
  const [lengths, initLengths] = await Promise.all([
    Promise.all(sample.map((segment) => fetchLength(segment.url, signal))),
    Promise.all(initParts.map((segment) => fetchLength(segment.url, signal))),
  ]);
  const known = lengths.filter((n) => n > 0);
  if (!known.length) return 0;
  const avg = known.reduce((sum, n) => sum + n, 0) / known.length;
  const mediaCount = parsed.segments.filter((segment) => !segment.init).length || parsed.segments.length;
  const initTotal = initLengths.filter((n) => n > 0).reduce((sum, n) => sum + n, 0);
  return Math.round((avg * mediaCount) + initTotal);
}

export async function downloadHls(
  playlistUrl: string,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<Blob> {
  let { text, url } = await fetchPlaylistText(playlistUrl, signal);
  let parsed = parsePlaylist(text, url);

  if (parsed.isMaster && parsed.variants.length) {
    const best = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    url = normalizeHlsProxyUrl(best.url);
    const next = await fetchPlaylistText(url, signal);
    text = next.text;
    url = next.url;
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
      const part = parsed.segments[idx];
      const segUrl = normalizeHlsProxyUrl(part.url);
      const headers = part.range ? { Range: part.range } : undefined;
      const r = await fetch(segUrl, { signal, headers });
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
