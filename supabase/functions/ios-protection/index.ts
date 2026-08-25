// ============================================================
// iOS Protection — Safari / iPhone playback gateway
// ============================================================
// Deploy this function and paste its URL into Admin -> EGD Router -> ios-protection.
// The player then routes EVERY video server through it when the viewer is on
// iPhone / iPad / Safari.
//
// WHAT IT FIXES
// 1. Wrong MIME types. Safari never content-sniffs media. Mirrors that answer
//    `application/octet-stream`, `text/html` or nothing at all make the <video>
//    tag stay black on iOS while Chrome plays the same link. We always send a
//    correct media MIME derived from the real container bytes.
// 2. ".mkv" files that are actually MP4. A very large share of mirror links are
//    named `.mkv` but the container is really `ftyp` (MP4/QuickTime). Safari
//    rejects them purely because of the extension + MIME. We read the first
//    bytes of the file, detect `ftyp`, and serve them as `video/mp4` with an
//    `.mp4` filename, so iPhone plays them natively.
// 3. Byte-range correctness. Safari always opens media with `Range: bytes=0-1`
//    and refuses any source that does not answer `206` + `Content-Range` +
//    `Accept-Ranges`. Broken mirrors are normalised here.
// 4. Real Matroska (EBML) files cannot be decoded by Safari at any MIME type.
//    Those are reported with `X-RS-Container: matroska` and status 415 so the
//    player fails over to the next quality / server instantly instead of
//    parking the user on a black screen.
// 5. HLS playlists are rewritten so every segment also flows through here.
//
// Usage:  https://<host>/functions/v1/ios-protection?url=<ENCODED_MEDIA_URL>
//         https://<host>/functions/v1/ios-protection?src=<BASE64URL_MEDIA_URL>
// No secrets required.
// ============================================================

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers":
    "content-length, content-range, accept-ranges, content-type, etag, last-modified, cache-control, x-rs-container, x-rs-mime, x-rs-ios",
  "Access-Control-Max-Age": "86400",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ts: "video/mp2t",
  m4s: "video/iso.segment",
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
};

const HEADER_TIMEOUT_MS = 9000;

const decodeToken = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return "";
  }
};

const extOf = (target: string): string => {
  try {
    const m = new URL(target).pathname.toLowerCase().match(/\.([a-z0-9]{2,4})(?:$|[?#])/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
};

const isUselessContentType = (ct: string): boolean => {
  const v = String(ct || "").toLowerCase();
  return (
    !v ||
    v.includes("octet-stream") ||
    v.startsWith("text/") ||
    v.includes("application/binary") ||
    v.includes("application/download") ||
    v.includes("force-download") ||
    v === "application/json"
  );
};

const isPlaylist = (target: string, ct: string): boolean =>
  /mpegurl|m3u8/i.test(ct || "") || /\.m3u8(?:[?#]|$)/i.test(target);

/** Read the container signature from the first bytes of the file. */
async function detectContainer(target: string, referer: string): Promise<"mp4" | "matroska" | "webm" | "unknown"> {
  try {
    const res = await fetchUpstream(target, referer, { Range: "bytes=0-63" });
    if (!res.ok && res.status !== 206) return "unknown";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 8) return "unknown";
    // ISO-BMFF: [size][ftyp]
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "mp4";
    // EBML magic 1A 45 DF A3 -> Matroska or WebM
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      const head = new TextDecoder().decode(buf.slice(0, 48)).toLowerCase();
      return head.includes("webm") ? "webm" : "matroska";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function fetchUpstream(target: string, referer: string, extra: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
  try {
    return await fetch(target, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        ...(referer ? { Referer: referer, Origin: new URL(referer).origin } : {}),
        ...extra,
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const selfBase = (req: Request): string => {
  const u = new URL(req.url);
  return `${u.origin}${u.pathname}`;
};

function rewritePlaylist(body: string, target: string, base: string): string {
  const wrap = (line: string): string => {
    let abs = line;
    try {
      abs = new URL(line, target).toString();
    } catch {
      return line;
    }
    return `${base}?url=${encodeURIComponent(abs)}`;
  };
  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return t.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${wrap(uri)}"`);
      }
      return wrap(t);
    })
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const target = decodeToken(url.searchParams.get("url") || url.searchParams.get("src") || "");
  const referer = url.searchParams.get("referer") || url.searchParams.get("origin") || "";

  if (!target) {
    return new Response(
      JSON.stringify({ ok: true, service: "ios-protection", usage: "?url=<encoded media url>" }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!/^https?:\/\//i.test(target)) {
    return new Response(JSON.stringify({ error: "Invalid url" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const ext = extOf(target);
  const range = req.headers.get("range") || "";

  try {
    // ---- Playlists: rewrite so segments stay inside this gateway ----
    if (/\.m3u8(?:[?#]|$)/i.test(target)) {
      const res = await fetchUpstream(target, referer);
      const text = await res.text();
      return new Response(rewritePlaylist(text, target, selfBase(req)), {
        status: res.status,
        headers: {
          ...cors,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "X-RS-Container": "hls",
          "X-RS-Ios": "1",
        },
      });
    }

    // ---- Container detection decides the MIME we hand to Safari ----
    let container: "mp4" | "matroska" | "webm" | "unknown" = "unknown";
    if (ext === "mkv" || ext === "webm" || !EXT_MIME[ext]) {
      container = await detectContainer(target, referer);
    }

    if (container === "matroska") {
      // Genuine Matroska cannot be decoded by Safari with ANY mime type.
      // Tell the player immediately so it fails over to the next source.
      return new Response(
        JSON.stringify({ error: "matroska-unsupported", container: "matroska" }),
        {
          status: 415,
          headers: { ...cors, "Content-Type": "application/json", "X-RS-Container": "matroska" },
        },
      );
    }

    const upstream = await fetchUpstream(target, referer, range ? { Range: range } : {});

    const upstreamCt = upstream.headers.get("content-type") || "";
    let mime = "";
    if (container === "mp4") mime = "video/mp4";
    else if (container === "webm") mime = "video/webm";
    else if (isUselessContentType(upstreamCt)) mime = EXT_MIME[ext] || "video/mp4";
    else mime = upstreamCt;
    // Safari refuses matroska mime even when the bytes are fine.
    if (/matroska/i.test(mime) && container === "mp4") mime = "video/mp4";

    const headers = new Headers(cors);
    headers.set("Content-Type", mime);
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-RS-Container", container);
    headers.set("X-RS-Mime", mime);
    headers.set("X-RS-Ios", "1");
    for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
      const v = upstream.headers.get(key);
      if (v) headers.set(key, v);
    }
    headers.set("Cache-Control", isPlaylist(target, mime) ? "no-store" : "public, max-age=86400");

    if (req.method === "HEAD") {
      return new Response(null, { status: upstream.status, headers });
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
