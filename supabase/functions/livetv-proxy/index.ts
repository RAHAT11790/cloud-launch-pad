const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type, Cache-Control",
};

const buildProxyTarget = (
  proxyBase: string,
  targetUrl: string,
  referer: string,
  userAgent: string,
) => {
  const params = new URLSearchParams({ url: targetUrl });
  if (referer) params.set("referer", referer);
  if (userAgent) params.set("ua", userAgent);
  return `${proxyBase}?${params.toString()}`;
};

const copyHeader = (responseHeaders: Headers, upstreamHeaders: Headers, key: string) => {
  const value = upstreamHeaders.get(key);
  if (value) responseHeaders.set(key, value);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing ?url= parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsedTargetUrl: URL;
    try {
      parsedTargetUrl = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const referer = requestUrl.searchParams.get("referer") || "";
    const userAgent = requestUrl.searchParams.get("ua") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("User-Agent", userAgent);

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      upstreamHeaders.set("Range", rangeHeader);
    }

    if (referer) {
      upstreamHeaders.set("Referer", referer);
      try {
        upstreamHeaders.set("Origin", new URL(referer).origin);
      } catch {
        // ignore invalid referer origin
      }
    }

    const upstreamResponse = await fetch(parsedTargetUrl.toString(), {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
      redirect: "follow",
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const isM3U8 =
      parsedTargetUrl.pathname.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegurl") ||
      contentType.includes("vnd.apple.mpegurl");

    if (isM3U8 && req.method !== "HEAD") {
      const playlistText = await upstreamResponse.text();
      const proxyBase = `${requestUrl.origin}${requestUrl.pathname}`;

      const rewritten = playlistText
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith("#")) {
            if (trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
                const absoluteUri = new URL(uri, parsedTargetUrl).toString();
                return `URI="${buildProxyTarget(proxyBase, absoluteUri, referer, userAgent)}"`;
              });
            }
            return line;
          }

          const absoluteUrl = new URL(trimmed, parsedTargetUrl).toString();
          return buildProxyTarget(proxyBase, absoluteUrl, referer, userAgent);
        })
        .join("\n");

      return new Response(rewritten, {
        status: upstreamResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    const responseHeaders = new Headers(corsHeaders);
    copyHeader(responseHeaders, upstreamResponse.headers, "content-type");
    copyHeader(responseHeaders, upstreamResponse.headers, "content-length");
    copyHeader(responseHeaders, upstreamResponse.headers, "content-range");
    copyHeader(responseHeaders, upstreamResponse.headers, "etag");
    copyHeader(responseHeaders, upstreamResponse.headers, "last-modified");
    copyHeader(responseHeaders, upstreamResponse.headers, "cache-control");

    if (!responseHeaders.has("Accept-Ranges")) {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    if (!responseHeaders.has("Cache-Control")) {
      responseHeaders.set(
        "Cache-Control",
        parsedTargetUrl.pathname.endsWith(".ts") || contentType.includes("video/")
          ? "public, max-age=180"
          : "no-cache",
      );
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Live TV proxy error:", error);
    return new Response(JSON.stringify({ error: "Proxy fetch failed", detail: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
