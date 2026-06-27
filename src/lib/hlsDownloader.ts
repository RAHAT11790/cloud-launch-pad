// ============================================================
// HLS m3u8 downloader — fetches all segments in the browser and
// returns a single concatenated .ts blob the user can save as a
// normal file. No server involvement; works on direct HLS links.
// ============================================================

type ProgressFn = (loaded: number, total: number, bytes: number) => void;

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
      if (attrs.URI) audio.push({ url: normalizeHlsProxyUrl(resolveUrl(baseUrl, attrs.URI)), name: attrs.NAME || attrs.LANGUAGE || `Audio ${audio.length + 1}`, language: attrs.LANGUAGE, default: /YES/i.test(attrs.DEFAULT || "") });
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
      segments.push(normalizeHlsProxyUrl(resolveUrl(baseUrl, line)));
    }
  }
  return { isMaster, variants, audio, segments };
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
      if (len > 0 && (init.method === "HEAD" || response.status === 206)) return len;
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
  let url = normalizeHlsProxyUrl(playlistUrl);
  let res = await fetch(url, { signal });
  if (!res.ok) return 0;
  let text = await res.text();
  let parsed = parsePlaylist(text, url);

  if (parsed.isMaster && parsed.variants.length) {
    const best = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    url = normalizeHlsProxyUrl(best.url);
    res = await fetch(url, { signal });
    if (!res.ok) return 0;
    text = await res.text();
    parsed = parsePlaylist(text, url);
  }

  if (!parsed.segments.length) return 0;
  const sample = parsed.segments.slice(0, Math.min(sampleCount, parsed.segments.length));
  const lengths = await Promise.all(sample.map((segment) => fetchLength(segment, signal)));
  const known = lengths.filter((n) => n > 0);
  if (!known.length) return 0;
  const avg = known.reduce((sum, n) => sum + n, 0) / known.length;
  return Math.round(avg * parsed.segments.length);
}

export async function downloadHls(
  playlistUrl: string,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<Blob> {
  let url = normalizeHlsProxyUrl(playlistUrl);
  let res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HLS playlist fetch failed (${res.status})`);
  let text = await res.text();
  let parsed = parsePlaylist(text, url);

  if (parsed.isMaster && parsed.variants.length) {
    const best = [...parsed.variants].sort((a, b) => b.bandwidth - a.bandwidth)[0];
    url = normalizeHlsProxyUrl(best.url);
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
      const segUrl = normalizeHlsProxyUrl(parsed.segments[idx]);
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
