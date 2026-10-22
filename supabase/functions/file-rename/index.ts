import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
// File Rename — single upstream streaming connection; HTTP/HTTPS + Range.
// Deploy in Cloudflare Manager, then set EGD Router → file-rename.
const cors = {
  ...corsHeaders,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range, content-type, authorization, apikey, x-client-info",
  "Access-Control-Expose-Headers": "content-length, content-range, content-disposition, accept-ranges",
};
const DEFAULT_FILE_HOSTS = ["fi5.bot-hosting.net", "rahat1102-hanime-tv.hf.space", "rahat1102-video-hosting-bot.hf.space", "filetolinkbot-production-ef8d.up.railway.app", "sized-trigger-totals-gently.trycloudflare.com"];
function allowedTarget(url: URL, hosts: Set<string>) {
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    && !/^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::|fc|fd|fe80)/i.test(h)
    && !h.includes(":") && hosts.has(h);
}
function filename(raw: string | null) {
  const name = String(raw || "video.mp4").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 220) || "video.mp4";
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.mp4`;
}
Deno.serve(async (req: Request) => {
    const hosts = new Set([...DEFAULT_FILE_HOSTS, ...String(Deno.env.get("ALLOWED_FILE_HOSTS") || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)]);
    const reply = (text: string | null, status: number) => new Response(text, { status, headers: cors });
    if (req.method === "OPTIONS") return reply(null, 204);
    if (!["GET", "HEAD"].includes(req.method)) return reply("Method not allowed", 405);
    const origin = req.headers.get("origin") || req.headers.get("referer");
    if (origin) {
      try { if (!/^(rsanime03\.lovable\.app|id-preview--d9496f6f-add2-411c-96f8-fb97b0c234a7\.lovable\.app|localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname)) return reply("Access denied", 403); }
      catch { return reply("Access denied", 403); }
    }
    const params = new URL(req.url).searchParams;
    let target;
    try { target = new URL(params.get("url") || ""); } catch { return reply("Missing or invalid file URL", 400); }
    if (!allowedTarget(target, hosts)) return reply("File host not allowed", 400);
    const range = req.headers.get("range");
    if (range && !/^bytes=\d+-\d*$|^bytes=-\d+$/.test(range)) return reply("Invalid range", 400);
    let upstream;
    try {
      for (let redirects = 0; redirects <= 4; redirects++) {
        if (!allowedTarget(target, hosts)) return reply("Redirect host not allowed", 400);
        upstream = await fetch(target, { method: req.method, headers: { "Accept-Encoding": "identity", "Accept": "*/*", ...(range ? { Range: range } : {}) }, redirect: "manual", signal: req.signal });
        if ([301, 302, 303, 307, 308].includes(upstream.status)) {
          const location = upstream.headers.get("location");
          await upstream.body?.cancel();
          if (!location) return reply("Invalid file redirect", 502);
          target = new URL(location, target);
          upstream = undefined;
          continue;
        }
        break;
      }
    } catch { return reply("File source unavailable", 502); }
    if (!upstream) return reply("Too many file redirects", 502);
    if (!upstream.ok) {
      const headers = new Headers(cors);
      if (upstream.status === 416 && upstream.headers.get("content-range")) headers.set("Content-Range", upstream.headers.get("content-range"));
      await upstream.body?.cancel();
      return new Response("File source refused the request", { status: upstream.status, headers });
    }
    const name = filename(params.get("filename"));
    const ascii = name.replace(/[^\x20-\x7e]/g, " ").trim() || "video.mp4";
    const headers = new Headers(cors);
    headers.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    headers.set("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set("Cache-Control", "no-store");
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
    for (const key of ["content-length", "content-range"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
});