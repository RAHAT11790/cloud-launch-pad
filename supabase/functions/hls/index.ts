// hls — legacy compatibility shim only.
//
// Real AN HLS playback belongs to `/functions/v1/an-playback/hls`.
// This route exists only for old cached links and immediately hands them to the
// playback API so the data API and playback API stay separated.

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "location, content-length, content-range, accept-ranges, content-type, etag, last-modified",
  "Access-Control-Max-Age": "86400",
};

const decode = (value: string) =>
  String(value || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003f/g, "?")
    .replace(/&amp;/g, "&")
    .trim();

const deepDecodeUrl = (value: string) => {
  let out = decode(value || "");
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(out); i++) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = decode(next);
    } catch { break; }
  }
  return out;
};

function getSafeOrigin(value?: string | null) {
  const raw = decode(value || "");
  if (!raw) return "";
  try { return new URL(deepDecodeUrl(raw)).origin; } catch { return ""; }
}

function playbackUrlFor(reqUrl: URL) {
  const target = reqUrl.searchParams.get("url") || "";
  if (!target) return "";
  const protocol = /(?:^|\.)supabase\.co$/i.test(reqUrl.hostname) ? "https:" : reqUrl.protocol;
  const origin = `${protocol}//${reqUrl.host}`;
  const pathPrefix = reqUrl.pathname.includes("/functions/v1/")
    ? reqUrl.pathname.slice(0, reqUrl.pathname.indexOf("/functions/v1/") + "/functions/v1".length)
    : "/functions/v1";
  const playback = new URL(`${origin}${pathPrefix}/an-playback/hls`);
  playback.searchParams.set("url", deepDecodeUrl(target));
  const inheritedOrigin = getSafeOrigin(reqUrl.searchParams.get("origin") || reqUrl.searchParams.get("parent") || reqUrl.searchParams.get("ref"));
  if (inheritedOrigin) playback.searchParams.set("origin", inheritedOrigin);
  return playback.toString();
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });

    const target = playbackUrlFor(new URL(req.url));
    if (!target) return new Response(JSON.stringify({ error: "missing ?url=" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    return new Response(null, { status: 302, headers: { ...cors, Location: target, "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(`Legacy HLS redirect failed: ${(e as Error)?.message || String(e)}`, { status: 502, headers: cors });
  }
});