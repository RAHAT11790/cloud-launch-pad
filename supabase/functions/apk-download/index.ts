import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const errorResponse = (message: string, status = 400) =>
  new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse("method_not_allowed", 405);
  }

  try {
    const requestUrl = new URL(req.url);
    const target = requestUrl.searchParams.get("url")?.trim() || "";

    if (!target) return errorResponse("missing_url", 400);

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return errorResponse("invalid_url", 400);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return errorResponse("unsupported_protocol", 400);
    }

    const upstream = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 LovableCloud APK Proxy",
        Accept: "application/vnd.android.package-archive,application/octet-stream,*/*",
      },
    });

    if (!upstream.ok || !upstream.body) {
      return errorResponse(`upstream_${upstream.status}`, upstream.status || 502);
    }

    const upstreamType = upstream.headers.get("content-type") || "application/vnd.android.package-archive";
    const upstreamDisposition = upstream.headers.get("content-disposition") || "";
    const defaultName = decodeURIComponent(parsed.pathname.split("/").pop() || "app.apk").replace(/[^\w. -]/g, "") || "app.apk";
    const fileNameMatch = upstreamDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    const finalName = (fileNameMatch?.[1] ? decodeURIComponent(fileNameMatch[1]) : defaultName).replace(/[^\w. -]/g, "") || defaultName;

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": upstreamType,
        "Content-Length": upstream.headers.get("content-length") || "",
        "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${finalName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return errorResponse(message, 500);
  }
});