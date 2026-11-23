// ============================================================
// apk-download — APK file proxy
// ============================================================
// Streams an APK from any origin (including HTTP-only hosts) to the
// browser with proper Content-Disposition so it downloads as <name>.apk.
// Used by the in-app "Download APK" button when the configured APK URL
// can't be served directly (mixed-content or hotlink protection).
//
// Request: GET /apk-download?url=<encoded apk url>&name=<file name>
// ============================================================


// ---- Live site domain: `settings/siteDomain`, written only by the email-service domain checker ----
const RS_SITE_DB = "https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app";
let rsSiteMemo: { live: string; hosts: string[]; exp: number } = { live: "", hosts: [], exp: 0 };
async function rsSiteDomain() {
  if (rsSiteMemo.exp > Date.now()) return rsSiteMemo;
  rsSiteMemo.exp = Date.now() + 60000;
  try {
    const r = await fetch(`${RS_SITE_DB}/settings/siteDomain.json`, { signal: AbortSignal.timeout(2500) });
    const d = r.ok ? await r.json() : null;
    const hosts = d && d.hosts && typeof d.hosts === "object" ? Object.values(d.hosts).filter((h: any) => h && h.serving && typeof h.host === "string").map((h: any) => String(h.host).toLowerCase()) : [];
    const live = d && typeof d.live === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(d.live) ? d.live : "";
    rsSiteMemo = { live, hosts, exp: Date.now() + 300000 };
  } catch { /* keep the previous answer */ }
  return rsSiteMemo;
}
const rsSiteHostOk = (u: unknown): boolean => { try { const x = new URL(String(u)); return x.protocol === "https:" && rsSiteMemo.hosts.includes(x.hostname.toLowerCase()); } catch { return false; } };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-disposition",
};

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);
const sanitizeName = (raw: string) => {
  const trimmed = String(raw || "").trim().replace(/[^\w.\-]+/g, "_").slice(0, 80) || "app";
  return /\.apk$/i.test(trimmed) ? trimmed : `${trimmed.replace(/\.[^.]+$/, "")}.apk`;
};

const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^lovable\.app$/i,
  /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
const matchesAllowedHost = (urlStr: string | null): boolean => {
  if (!urlStr) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(urlStr).host)) || rsSiteHostOk(urlStr); } catch { return false; }
};

Deno.serve(async (req) => {
  await rsSiteDomain();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Referer/Origin allowlist — APK proxy is only for first-party download
  // buttons, not a generic redistribution endpoint.
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (origin || referer) {
    if (!matchesAllowedHost(origin) && !matchesAllowedHost(referer)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url") || "";
  const name = sanitizeName(searchParams.get("name") || "app.apk");

  if (!target || !isHttpUrl(target)) {
    return new Response(JSON.stringify({ error: "Missing or invalid ?url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        ...(req.headers.get("range") ? { range: req.headers.get("range") as string } : {}),
      },
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", "application/vnd.android.package-archive");
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
    headers.set("Cache-Control", "no-store");
    const len = upstream.headers.get("content-length");
    const range = upstream.headers.get("content-range");
    const accept = upstream.headers.get("accept-ranges");
    if (len) headers.set("Content-Length", len);
    if (range) headers.set("Content-Range", range);
    if (accept) headers.set("Accept-Ranges", accept);

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || "fetch failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
